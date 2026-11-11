import { useEffect, useRef, useState } from 'react'
import { usePS } from './persist'
import { supabase, friendlyError } from './supabase'

const SUGG = ['Qui a réservé un appel aujourd’hui ?', 'Combien de candidatures cette semaine ?', 'Qui dois-je relancer ?', 'Où en est Nawal ?']
const CAPL = { lt500: 'Moins de 500 €', '500-1000': '500 à 1 000 €', '1000-3000': '1 000 à 3 000 €', gt3000: 'Plus de 3 000 €' }
const FIELDS = [['first_name', 'Prénom'], ['last_name', 'Nom'], ['phone', 'WhatsApp'], ['email', 'Email'], ['situation', 'Situation'], ['experience', 'Expérience'], ['capital', 'Budget'], ['source', 'Source']]
const digits = (s) => String(s || '').replace(/\D/g, '')
const okMail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(s)
const normPhone = (raw) => {
  let s = String(raw || '').trim(); if (!s) return ''
  const plus = s.startsWith('+') || s.startsWith('00'); let d = digits(s); if (s.startsWith('00')) d = d.replace(/^00/, '')
  if (!plus) { if (d.startsWith('0')) d = '33' + d.slice(1); else if (d.length === 9 && /^[67]/.test(d)) d = '33' + d }
  if (plus && /^330\d{9}$/.test(d)) d = '33' + d.slice(3)
  return d.length >= 8 ? '+' + d : ''
}
// **gras** très simple, le reste en texte brut
const Rich = ({ t }) => <>{String(t).split(/(\*\*[^*]+\*\*)/g).map((x, i) => /^\*\*[^*]+\*\*$/.test(x) ? <b key={i}>{x.slice(2, -2)}</b> : <span key={i}>{x}</span>)}</>
const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null

function Proposal({ p, state, onCreate, onCancel, onChange }) {
  const [edit, setEdit] = useState(false)
  const val = (k) => k === 'capital' ? (CAPL[p[k]] || '') : (p[k] || '')
  if (state === 'done') return <div className="as-card ok">✓ Contact créé : <b>{[p.first_name, p.last_name].filter(Boolean).join(' ')}</b>{p._id && <button className="as-chip g" onClick={() => onCreate('open')}>Ouvrir la fiche</button>}</div>
  if (state === 'cancel') return <div className="as-card dim">Annulé, rien n’a été créé.</div>
  return <div className="as-card">
    {FIELDS.map(([k, l]) => (val(k) || edit) ? <div key={k} className="as-row"><span>{l}</span>{edit && k !== 'capital' ? <input value={p[k] || ''} onChange={(e) => onChange({ ...p, [k]: e.target.value })} /> : <b>{val(k)}</b>}</div> : null)}
    <div className="as-acts"><button className="as-btn" onClick={() => onCreate('create')}>Créer le contact</button><button className="as-btn ghost" onClick={() => setEdit(!edit)}>{edit ? 'OK' : 'Modifier'}</button><button className="as-btn ghost" onClick={onCancel}>Annuler</button></div>
    <small>Rien n’est enregistré tant que tu n’as pas validé.</small></div>
}

export default function Assistant({ onOpen }) {
  const [open, setOpen] = usePS('as_open', false)
  const [msgs, setMsgs] = usePS('as_msgs', [])
  const [input, setInput] = usePS('as_input', '')
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(null) // la clé Claude est-elle posée ?
  const [key, setKey] = useState(''); const [kerr, setKerr] = useState('')
  const [rec, setRec] = useState(false)
  const end = useRef(null)
  useEffect(() => { if (open && ready === null) supabase.rpc('calio_ai_ready').then(({ data }) => setReady(data === true)).catch(() => setReady(false)) }, [open, ready])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs, busy, open])
  useEffect(() => { if (open) { const o = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = o } } }, [open])

  const send = async (text, base) => {
    const t = String(text ?? input).trim(); if (!t || busy) return
    setInput(''); const next = [...(base || msgs), { role: 'user', text: t }]; setMsgs(next); setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('calio-assistant', { body: { messages: next.map((m) => ({ role: m.role, text: m.text })) } })
      if (error || !data) throw new Error('réseau')
      if (data.error === 'no_key') { setReady(false); setMsgs(next); return }
      if (data.error === 'bad_key') { setReady(false); setKerr('Claude refuse cette clé : colle-en une valide.'); return }
      if (data.error) throw new Error(data.error)
      const add = [{ role: 'assistant', text: data.reply }, ...(data.proposals || []).map((p) => ({ role: 'assistant', proposal: p, pstate: 'ask' }))]
      setMsgs([...next, ...add])
    } catch {
      setMsgs([...next, { role: 'assistant', text: 'Je n’arrive pas à répondre pour le moment. Réessaie dans un instant.', err: true }])
    } finally { setBusy(false) }
  }
  // Si l'app a été fermée par l'iPhone pendant que l'assistant réfléchissait, on relance la dernière question au retour.
  const resumed = useRef(false)
  useEffect(() => {
    if (resumed.current) return; resumed.current = true
    const last = msgs[msgs.length - 1]
    if (open && last && last.role === 'user' && last.text) { const base = msgs.slice(0, -1); setMsgs(base); setTimeout(() => send(last.text, base), 50) }
  }, []) // eslint-disable-line
  const saveKey = async () => {
    setKerr(''); const { error } = await supabase.rpc('calio_ai_set_key', { k: key })
    if (error) return setKerr(friendlyError(error)); setKey(''); setReady(true)
  }
  const upd = (i, patch) => setMsgs((m) => m.map((x, j) => j === i ? { ...x, ...patch } : x))
  const create = async (i, how) => {
    const m = msgs[i]; const p = m.proposal
    if (how === 'open') return onOpen && (setOpen(false), onOpen(p._id))
    const em = String(p.email || '').trim().toLowerCase(), ph = normPhone(p.phone)
    const rec_ = { sid: 'man-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), first_name: String(p.first_name || '').trim() || null, last_name: String(p.last_name || '').trim() || null, phone: ph || null, phone_raw: String(p.phone || '').trim() || null, email: okMail(em) ? em : null, email_raw: em || null, situation: p.situation || null, experience: p.experience || null, capital: p.capital || null, note: p.note || null, source: String(p.source || '').trim() || 'Assistant', step: 'who' }
    if (!rec_.first_name && !rec_.phone_raw && !rec_.email_raw) return upd(i, { err: 'Il faut au moins un prénom, un numéro ou un email.' })
    const { data, error } = await supabase.from('cand_leads').insert(rec_).select('id').single()
    if (error) return upd(i, { err: friendlyError(error) })
    upd(i, { pstate: 'done', err: null, proposal: { ...p, _id: data?.id } })
  }
  // Dictée : touche le micro pour démarrer, touche le carré pour arrêter. Elle continue d'écouter tant que tu n'as pas arrêté (même après un silence).
  const wantRef = useRef(false); const recRef = useRef(null); const baseRef = useRef(''); const inRef = useRef('')
  inRef.current = input
  const stopListen = () => { wantRef.current = false; try { recRef.current?.stop() } catch { /* */ } recRef.current = null; setRec(false) }
  const startOne = () => {
    const r = new SR(); r.lang = 'fr-FR'; r.interimResults = true; r.continuous = true; recRef.current = r
    r.onresult = (e) => { let t = ''; for (const x of e.results) t += x[0].transcript; setInput(baseRef.current + t) }
    r.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { stopListen(); setMsgs((m) => [...m, { role: 'assistant', text: 'Le micro est bloqué : autorise-le dans les réglages du navigateur pour dicter.', err: true }]) } }
    r.onend = () => { if (wantRef.current) { baseRef.current = inRef.current ? inRef.current.trimEnd() + ' ' : ''; try { startOne() } catch { stopListen() } } else setRec(false) }
    r.start()
  }
  const listen = () => {
    if (wantRef.current) return stopListen()
    if (!SR) return setMsgs((m) => [...m, { role: 'assistant', text: 'Le micro intégré n’est pas disponible ici. Utilise le micro de ton clavier pour dicter.', err: true }])
    wantRef.current = true; baseRef.current = input ? input.trimEnd() + ' ' : ''; setRec(true)
    try { startOne() } catch { stopListen() }
  }
  useEffect(() => { if (!open) stopListen() }, [open])
  useEffect(() => () => { wantRef.current = false; try { recRef.current?.stop() } catch { /* */ } }, [])

  return <>
    <button className="as-fab" onClick={() => setOpen(true)} aria-label="Ouvrir l’assistant" title="Assistant"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3z" /><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" /></svg></button>
    {open && <div className="as-wrap" role="dialog" aria-label="Assistant">
      <header><div className="as-logo"><span>C</span><i /></div><h2>Assistant</h2><button className="as-x" onClick={() => setOpen(false)} aria-label="Fermer">✕</button></header>
      <div className="as-body">
        {ready === false && <div className="as-card"><b>Une dernière étape</b><p>Pour répondre, l’assistant a besoin de ta clé Claude. Colle-la une seule fois, elle reste cachée sur le serveur.</p>
          <input type="password" autoComplete="off" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} />
          {kerr && <p className="as-err">{kerr}</p>}<div className="as-acts"><button className="as-btn" disabled={!key.trim()} onClick={saveKey}>Enregistrer la clé</button></div></div>}
        {ready !== false && <>
          <div className="as-bot">Bonjour Clément. Pose-moi une question sur tes <b>appels</b> ou tes <b>prospects</b>, ou donne-moi une info à enregistrer.</div>
          {!msgs.length && <><div className="as-lbl">Essaie</div>{SUGG.map((s) => <button key={s} className="as-sug" onClick={() => send(s)}>{s}</button>)}
            <div className="as-tip"><b>Pour enregistrer un contact, dis-le simplement :</b><br />« Ajoute Karim, 06 12 34 56 78, salarié, budget 1 000 à 3 000 € »</div></>}
          {msgs.map((m, i) => m.proposal ? <Proposal key={i} p={m.proposal} state={m.pstate} onChange={(p) => upd(i, { proposal: p })} onCreate={(how) => create(i, how)} onCancel={() => upd(i, { pstate: 'cancel' })} />
            : <div key={i} className={m.role === 'user' ? 'as-me' : 'as-bot'}><Rich t={m.text} /></div>)}
          {msgs.map((m, i) => m.err && m.proposal ? <p key={'e' + i} className="as-err">{m.err}</p> : null)}
          {busy && <div className="as-bot as-dots"><i /><i /><i /></div>}
        </>}
        <div ref={end} />
      </div>
      {ready !== false && <form className="as-in" onSubmit={(e) => { e.preventDefault(); send() }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={rec ? 'Je t’écoute… touche le carré pour arrêter' : 'Écris ou dicte…'} enterKeyHint="send" />
        <button type="button" className={`as-mic ${rec ? 'on' : ''}`} onClick={listen} aria-label={rec ? 'Arrêter la dictée' : 'Dicter'}>{rec
          ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="3" /></svg>
          : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>}</button>
        <button type="submit" className="as-send" disabled={busy || !input.trim()} aria-label="Envoyer">↑</button></form>}
    </div>}
  </>
}
