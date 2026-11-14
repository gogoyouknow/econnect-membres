import { useEffect, useRef, useState } from 'react'
import { usePS } from './persist'
import { supabase, friendlyError } from './supabase'

const SUGG = ['Qui a réservé un appel aujourd’hui ?', 'Combien de candidatures cette semaine ?', 'Qui dois-je relancer ?', 'Où en est Nawal ?', 'Mets Karim demain à 14h']
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

const fmtRdv = (iso) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
// Carte « rendez-vous » : un tap pour poser l'appel, même hors des disponibilités.
function RdvCard({ p, state, err, onConfirm, onCancel }) {
  if (state === 'done') return <div className="as-card ok">✓ Rendez-vous posé : <b>{p.first_name}</b>, {fmtRdv(p.starts_at)} (avec {p.closer_name}). Le créneau est ouvert, il apparaît dans « Appels ».</div>
  if (state === 'cancel') return <div className="as-card dim">Annulé, aucun rendez-vous posé.</div>
  return <div className="as-card">
    <div className="as-row"><span>Prospect</span><b>{p.first_name}</b></div>
    <div className="as-row"><span>Quand</span><b>{fmtRdv(p.starts_at)}</b></div>
    <div className="as-row"><span>Durée</span><b>{p.minutes} min</b></div>
    <div className="as-row"><span>Avec</span><b>{p.closer_name}</b></div>
    {(p.phone || p.email) && <div className="as-row"><span>Contact</span><b>{p.phone || p.email}</b></div>}
    <div className="as-acts"><button className="as-btn" onClick={onConfirm}>Prendre le rendez-vous</button><button className="as-btn ghost" onClick={onCancel}>Annuler</button></div>
    <small>Posé même si l’horaire est hors de tes disponibilités. Aucun message n’est envoyé au prospect.</small>
    {err && <p className="as-err">{err}</p>}</div>
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
  const book = async (i) => {
    const p = msgs[i].proposal
    const rec_ = { first_name: p.first_name, phone: p.phone || null, email: p.email || null, situation: p.situation || null, capital: p.capital || null, budget_confirmed: p.budget_confirmed || 'yes', starts_at: p.starts_at, minutes: p.minutes, status: 'confirme', closer: p.closer, route_note: 'Placé à la main (assistant)' }
    const { error } = await supabase.from('candidatures').insert(rec_)
    if (error) return upd(i, { err: error.code === '23505' ? 'Ce créneau vient d’être pris : demande-moi une autre heure.' : friendlyError(error) })
    upd(i, { pstate: 'done', err: null })
  }
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
  // wantRef = ce que tu veux (écouter ou non) ; runRef = ce que le navigateur fait vraiment. Les deux peuvent différer quelques instants
  // (le navigateur met du temps à s'arrêter) : c'est là que se logeaient les bugs d'arrêt et de relance.
  const wantRef = useRef(false); const runRef = useRef(false); const recRef = useRef(null); const baseRef = useRef(''); const inRef = useRef('')
  const usedMicRef = useRef(false); const hiddenAtRef = useRef(0); const busyRef = useRef(false); const wdRef = useRef(null); const audioRef = useRef(false); const finalRef = useRef(''); const gotRef = useRef(false); const t0Ref = useRef(0); const failRef = useRef(0); const dropRef = useRef(false)
  inRef.current = input; busyRef.current = busy
  const ta = useRef(null)
  // Le champ s'agrandit pendant que tu écris ou dictes (jusqu'à 8 lignes) : tu vois tout ce que tu as écrit.
  useEffect(() => { const t = ta.current; if (!t) return; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 190) + 'px'; t.scrollTop = t.scrollHeight }, [input, open])
  // Journal des derniers événements du micro, envoyé au journal d'erreurs seulement quand le micro échoue : ça permet de voir ce qui se passe vraiment sur l'iPhone.
  const evs = useRef([]); const hiddenRef = useRef(false)
  const ev = (t) => { evs.current = [...evs.current.slice(-24), new Date().toISOString().slice(11, 19) + ' ' + t] }
  const logMic = (why) => { try { supabase.from('client_errors').insert({ message: 'micro: ' + why, url: location.pathname, ua: String(navigator.userAgent).slice(0, 200), extra: { events: evs.current, standalone: !!navigator.standalone } }).then(() => {}, () => {}) } catch { /* */ } }
  const say = (text) => setMsgs((m) => [...m, { role: 'assistant', text, err: true }])
  const startRec = (r) => { try { r.start() } catch (e) { if (e && e.name === 'InvalidStateError') { try { r.abort() } catch { /* */ } } else { wantRef.current = false; setRec(false); say('Je n’arrive pas à lancer le micro. Touche-le encore une fois, ou utilise le micro de ton clavier.') } } }
  // Arrêt : on laisse le navigateur finir la phrase en cours ; s'il traîne (plus de 1,5 s), on le coupe de force pour pouvoir relancer tout de suite.
  const stopListen = (hard) => {
    wantRef.current = false; setRec(false)
    const r = recRef.current; if (!r) return
    try { hard ? r.abort() : r.stop() } catch { /* */ }
    setTimeout(() => { if (!wantRef.current && runRef.current) { try { r.abort() } catch { /* */ } } }, 1500)
  }
  const getRec = () => {
    if (recRef.current) return recRef.current
    const r = new SR(); r.lang = 'fr-FR'; r.interimResults = true; r.continuous = true; recRef.current = r
    r.onaudiostart = () => { ev('onaudiostart'); audioRef.current = true; hiddenRef.current = false; clearTimeout(wdRef.current) }
    r.onstart = () => { ev('onstart'); runRef.current = true; t0Ref.current = Date.now(); gotRef.current = false; finalRef.current = '' }
    // On ne recopie que ce qui est nouveau (resultIndex) : plus de phrases répétées, et un résultat tardif ne revient pas remplir le champ après l'envoi.
    r.onresult = (e) => {
      if (dropRef.current) return
      audioRef.current = true; clearTimeout(wdRef.current); hiddenRef.current = false
      gotRef.current = true; failRef.current = 0
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) { const x = e.results[i]; if (x.isFinal) finalRef.current += x[0].transcript; else interim += x[0].transcript }
      setInput(baseRef.current + finalRef.current + interim)
    }
    r.onerror = (e) => {
      ev('onerror:' + e.error); if (!['no-speech', 'aborted'].includes(e.error)) logMic('erreur ' + e.error)
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { stopListen(true); recRef.current = null; say('Le micro est bloqué. Sur iPhone : Réglages → Apps → Safari → Micro, puis choisis « Autoriser » (ou touche « aA » dans la barre d’adresse → Réglages du site → Micro → Autoriser). Ensuite, rouvre l’assistant.') }
      else if (e.error === 'audio-capture') { stopListen(true); say('Je n’entends aucun micro. Vérifie qu’un autre appli ne l’utilise pas, puis réessaie.') }
    }
    r.onend = () => {
      ev('onend' + (r !== recRef.current ? ' (ancienne)' : ''))
      if (r !== recRef.current) return // ancienne instance remplacée : on ne la relance pas
      runRef.current = false
      if (!wantRef.current) return setRec(false)
      // La dictée se coupe toute seule après un silence : on relance, sauf si le navigateur échoue en boucle.
      if (!gotRef.current && Date.now() - t0Ref.current < 1500) failRef.current += 1; else failRef.current = 0
      if (failRef.current >= 4) { stopListen(true); recRef.current = null; return say('La dictée se coupe sans arrêt. Touche le micro pour réessayer, ou utilise le micro de ton clavier.') }
      baseRef.current = inRef.current ? inRef.current.trimEnd() + ' ' : ''; finalRef.current = ''
      setTimeout(() => { if (wantRef.current && !runRef.current) startRec(r) }, 250)
    }
    return r
  }
  // Démarre l'écoute. Après un passage en arrière-plan, iPhone laisse parfois l'ancienne reconnaissance morte (elle ne démarre plus et ne signale rien) :
  // si rien ne démarre en 1,2 s, on jette cette instance et on en crée une neuve.
  const begin = (fresh) => {
    ev('begin' + (fresh ? ' neuve' : ''))
    if (fresh) { try { recRef.current?.abort() } catch { /* */ } recRef.current = null; runRef.current = false }
    clearTimeout(wdRef.current); audioRef.current = false
    startRec(getRec())
    wdRef.current = setTimeout(() => {
      if (!wantRef.current || audioRef.current) return
      if (!fresh) return begin(true)
      // Même une instance neuve ne démarre pas : iPhone a laissé le micro de la page bloqué. Seul un rechargement le débloque (ton texte est gardé).
      ev('watchdog : pas de son capté'); logMic('le micro ne repart pas')
      wantRef.current = false; setRec(false)
      let last = 0; try { last = Number(localStorage.getItem('calio_mic_reload') || 0) } catch { /* */ }
      if (Date.now() - last > 120000) { try { localStorage.setItem('calio_mic_reload', String(Date.now())) } catch { /* */ } location.reload() }
      else say('Le micro ne repart pas. Ferme complètement Calio (balaye-la vers le haut), rouvre-la, puis touche le micro.')
    }, 3500)
  }
  const listen = () => {
    if (wantRef.current) return stopListen()
    if (!SR) return say('Le micro intégré n’est pas disponible ici. Utilise le micro de ton clavier pour dicter.')
    usedMicRef.current = true; dropRef.current = false; failRef.current = 0
    wantRef.current = true; baseRef.current = input ? input.trimEnd() + ' ' : ''; finalRef.current = ''; setRec(true)
    // Après un passage en arrière-plan, ou si le navigateur croit encore l'ancienne écoute active, on repart sur une instance neuve.
    begin(runRef.current || hiddenRef.current)
  }
  // Si tu écris au clavier pendant la dictée, ton texte devient la nouvelle base : la dictée n'efface plus ce que tu viens de taper.
  const onType = (v) => { setInput(v); if (wantRef.current) { baseRef.current = v ? v.trimEnd() + ' ' : ''; finalRef.current = '' } }
  // Envoi : on coupe la dictée et on jette ce qui arrive encore, sinon le texte revient dans le champ juste après l'envoi.
  const sendNow = () => { if (wantRef.current || runRef.current) { dropRef.current = true; stopListen(true) } send() }
  useEffect(() => { if (!open) stopListen(true) }, [open])
  useEffect(() => { try { const t = Math.max(Number(localStorage.getItem('calio_mic_reload') || 0), Number(localStorage.getItem('calio_mic_back') || 0)); if (t && Date.now() - t < 20000) { setOpen(true); setMsgs((m) => [...m, { role: 'assistant', text: 'Micro remis à zéro. Touche-le pour reprendre ta dictée : ton texte est toujours là.' }]) } } catch { /* */ } }, []) // eslint-disable-line
  // iPhone : quand l'app passe en arrière-plan, le système coupe le micro. On remet l'écran dans un état clair (le texte reste), et au retour
  // on oublie l'ancienne écoute pour que le prochain toucher sur le micro reparte bien.
  useEffect(() => {
    const f = () => {
      if (document.hidden) { ev('app en arrière-plan'); hiddenRef.current = true; hiddenAtRef.current = Date.now(); if (wantRef.current) stopListen(true) }
      else {
        ev('retour dans l’app')
        // Après un passage dans une autre appli, iPhone laisse souvent le micro de la page muet (il « écoute » mais n'entend plus). Seule une page rechargée le retrouve :
        // si tu avais utilisé la dictée, on recharge au retour. Ton texte et ta conversation sont gardés, il te reste à retoucher le micro.
        if (usedMicRef.current && hiddenAtRef.current && Date.now() - hiddenAtRef.current > 2000 && !busyRef.current) {
          try { localStorage.setItem('calio_mic_back', String(Date.now())) } catch { /* */ }
          location.reload(); return
        }
        hiddenAtRef.current = 0
        if (!wantRef.current) { runRef.current = false; setRec(false) } }
    }
    document.addEventListener('visibilitychange', f); window.addEventListener('pageshow', f)
    return () => { document.removeEventListener('visibilitychange', f); window.removeEventListener('pageshow', f) }
  }, [])
  useEffect(() => () => { wantRef.current = false; try { recRef.current?.abort() } catch { /* */ } }, [])

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
          {msgs.map((m, i) => m.proposal?.kind === 'rdv' ? <RdvCard key={i} p={m.proposal} state={m.pstate} err={m.err} onConfirm={() => book(i)} onCancel={() => upd(i, { pstate: 'cancel' })} />
            : m.proposal ? <Proposal key={i} p={m.proposal} state={m.pstate} onChange={(p) => upd(i, { proposal: p })} onCreate={(how) => create(i, how)} onCancel={() => upd(i, { pstate: 'cancel' })} />
            : <div key={i} className={m.role === 'user' ? 'as-me' : 'as-bot'}><Rich t={m.text} /></div>)}
          {msgs.map((m, i) => m.err && m.proposal && m.proposal.kind !== 'rdv' ? <p key={'e' + i} className="as-err">{m.err}</p> : null)}
          {busy && <div className="as-bot as-dots"><i /><i /><i /></div>}
        </>}
        <div ref={end} />
      </div>
      {ready !== false && <form className="as-in" onSubmit={(e) => { e.preventDefault(); sendNow() }}>
        <textarea ref={ta} rows={1} value={input} onChange={(e) => onType(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !window.matchMedia('(pointer: coarse)').matches) { e.preventDefault(); if (!busy && input.trim()) sendNow() } }} placeholder={rec ? 'Je t’écoute… touche le carré pour arrêter' : 'Écris ou dicte…'} />
        <button type="button" className={`as-mic ${rec ? 'on' : ''}`} onClick={listen} aria-label={rec ? 'Arrêter la dictée' : 'Dicter'}>{rec
          ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="3" /></svg>
          : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>}</button>
        <button type="submit" className="as-send" disabled={busy || !input.trim()} aria-label="Envoyer">↑</button></form>}
    </div>}
  </>
}
