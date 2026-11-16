import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, friendlyError } from './supabase'
import { useClosers } from './Routage'

const OUT = [['signe', 'Signé'], ['perdu', 'Pas signé'], ['reflechit', 'Il réfléchit'], ['absent', 'Absent']]
const OUT_L = Object.fromEntries(OUT)
const LIST_COLS = 'id,created_at,closer,candidature_id,title,call_date,outcome,status,score,audio_path,err,user_id'
const fmtDate = (d) => (d ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' }) : '')
const scoreCls = (s) => (s == null ? '' : s >= 7.5 ? 'hi' : s >= 5.5 ? 'mid' : 'lo')
const num = (x) => (x == null || x === '' || Number.isNaN(Number(x)) ? null : Math.round(Number(x) * 10) / 10)
const safeName = (n) => String(n || 'appel').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-60)
const arr = (x) => (Array.isArray(x) ? x.filter((v) => typeof v === 'string' || typeof v === 'object') : [])
const txt = (v) => (typeof v === 'string' ? v : v == null ? '' : typeof v === 'object' ? Object.values(v).filter((z) => typeof z === 'string').join(' — ') : String(v))

// Découpe une transcription en répliques (Zoom, Meet, Loom…). Renvoie null si on ne reconnaît pas de dialogue.
function parseDialogue(t) {
  const lines = String(t || '').split(/\r?\n/)
  const out = []; let cur = null; let named = 0; let total = 0
  const A = /^\s*(?:[\[(]?\d{1,2}:\d{2}(?::\d{2})?[\])]?\s*[-–]?\s*)?([^:\n\[\]]{2,32}?)\s*:\s+(.+)$/
  const B = /^\s*\[?([^\]\n:]{2,32}?)\]?\s+[\[(]?(\d{1,2}:\d{2}(?::\d{2})?)[\])]?\s*$/
  for (const raw of lines) {
    const l = raw.trim(); if (!l) continue
    total++
    let m = l.match(B)
    if (m) { cur = { who: m[1].trim(), at: m[2], text: '' }; out.push(cur); named++; continue }
    m = l.match(A)
    if (m && !/^(http|https)$/i.test(m[1])) { cur = { who: m[1].trim(), at: '', text: m[2] }; out.push(cur); named++; continue }
    if (cur) cur.text += (cur.text ? ' ' : '') + l
    else out.push({ who: '', at: '', text: l })
  }
  const who = [...new Set(out.map((o) => o.who).filter(Boolean))]
  if (who.length < 2 || who.length > 6 || named < 4) return null
  return { turns: out.filter((o) => o.text), who }
}
const ini = (n) => (String(n || '?').trim()[0] || '?').toUpperCase()

/** Coach d'appels : on colle (ou dépose) un appel, l'IA donne un retour de coach. Ordinateur uniquement. */
export default function Coach({ toast, role }) {
  const isCloser = role === 'closer'
  const closers = useClosers()
  const [rows, setRows] = useState(null); const [sel, setSel] = useState(null); const [me, setMe] = useState(null); const [filt, setFilt] = useState('all')
  const [calls, setCalls] = useState([])
  const load = async () => {
    const { data, error } = await supabase.from('call_reviews').select(LIST_COLS).order('created_at', { ascending: false }).limit(300)
    if (error) { setRows([]); return toast(error.message?.includes('call_reviews') ? 'Le Coach d’appels arrive dans quelques minutes : la mise à jour est en cours.' : friendlyError(error), true) }
    setRows(data || [])
  }
  useEffect(() => {
    load()
    supabase.rpc('calio_my_closer').then(({ data }) => setMe(data || null)).catch(() => {})
    supabase.from('candidatures').select('id,first_name,starts_at,closer,outcome,situation,capital').order('starts_at', { ascending: false }).limit(120).then(({ data }) => setCalls(data || []))
  }, [])
  const patchRow = (r) => setRows((rs) => (rs || []).map((x) => (x.id === r.id ? { ...x, status: r.status, score: r.score, err: r.err, audio_path: r.audio_path } : x)))
  const shown = useMemo(() => (rows || []).filter((r) => filt === 'all' || r.closer === filt), [rows, filt])
  const cname = (k) => closers?.find((c) => c.key === k)?.name || k || '—'
  const done = (rows || []).filter((r) => r.status === 'ok').length

  if (rows === null || !closers) return <p className="muted">Chargement…</p>
  return <div className="cc">
    <div className="ev-head"><div><h2 className="sh">Coach d’appels</h2>
      <p className="muted">Colle l’appel (transcription Loom, Zoom, Meet…) : le coach te dit ce qui était bien, ce qu’il faut améliorer et ce que tu aurais pu dire. {isCloser ? 'Tu ne vois que tes appels.' : 'Chaque closer voit ses appels, toi tu vois tout.'}</p></div></div>
    <div className="cc-grid">
      <div className="cc-left">
        <NewCall toast={toast} closers={closers} me={me} isCloser={isCloser} calls={calls} onCreated={(r) => { setRows((rs) => [r, ...(rs || [])]); setSel(r.id) }} />
        <section className="rt-card">
          <h3 className="rt-h">{isCloser ? 'Mes appels' : 'Appels analysés'} <small>{done} analysé{done > 1 ? 's' : ''} · plus il y en a, plus les retours sont précis</small></h3>
          {!isCloser && closers.length > 1 && <div className="chips"><button type="button" className={`chip ${filt === 'all' ? 'sel' : ''}`} onClick={() => setFilt('all')}>Tous</button>{closers.map((c) => <button type="button" key={c.key} className={`chip ${filt === c.key ? 'sel' : ''}`} onClick={() => setFilt(c.key)}>{c.name}</button>)}</div>}
          {!shown.length && <p className="muted s12">Aucun appel pour l’instant. Ajoute le premier ci-dessus.</p>}
          <div className="cc-list">{shown.map((r) => <button type="button" key={r.id} className={`cc-row ${sel === r.id ? 'on' : ''}`} onClick={() => setSel(r.id)}>
            <span className={`cc-sc ${scoreCls(r.score)}`}>{r.status === 'ok' && r.score != null ? <>{num(r.score)}<small>/10</small></> : r.status === 'analyse' ? '…' : r.status === 'erreur' ? '!' : '–'}</span>
            <span className="cc-t"><b>{r.title || 'Appel sans titre'}</b><small>{cname(r.closer)}{r.call_date || r.created_at ? ' · ' + fmtDate(r.call_date || r.created_at) : ''}</small></span>
            {r.outcome && <span className={`badge ${r.outcome === 'signe' ? 'ok' : r.outcome === 'reflechit' ? 'wait' : 'done'}`}>{OUT_L[r.outcome]}</span>}
            {r.status === 'analyse' && <span className="badge wait">Analyse…</span>}{r.status === 'nouveau' && <span className="badge done">À analyser</span>}
          </button>)}</div>
        </section>
      </div>
      <div className="cc-right">
        {sel ? <Detail key={sel} id={sel} toast={toast} cname={cname} onPatch={patchRow} onDeleted={() => { setRows((rs) => rs.filter((x) => x.id !== sel)); setSel(null) }} />
          : <section className="rt-card cc-empty"><h3 className="rt-h">Retour du coach</h3><p className="muted">Choisis un appel dans la liste, ou ajoute-en un : son analyse s’affiche ici.</p></section>}
      </div>
    </div>
  </div>
}

function NewCall({ toast, closers, me, isCloser, calls, onCreated }) {
  const [f, setF] = useState({ cand: '', title: '', closer: '', date: '', outcome: '', transcript: '' }); const [file, setFile] = useState(null); const [busy, setBusy] = useState(''); const fileRef = useRef(null)
  const closer = f.closer || (isCloser ? me : '') || (closers.find((c) => c.key === 'clement') || closers[0])?.key || ''
  const pickCall = (id) => {
    const c = calls.find((x) => String(x.id) === String(id))
    if (!c) return setF({ ...f, cand: '' })
    const d = c.starts_at ? new Date(c.starts_at).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' }) : ''
    setF({ ...f, cand: String(c.id), title: f.title || c.first_name || '', closer: c.closer && !isCloser ? c.closer : f.closer, date: d || f.date, outcome: OUT_L[c.outcome] ? c.outcome : f.outcome })
  }
  const enough = f.transcript.trim().length >= 300
  const submit = async (analyse) => {
    if (!closer) return toast('Choisis le closer.', true)
    if (!f.title.trim() && !f.cand) return toast('Donne un nom à l’appel (ex. le prénom du prospect).', true)
    if (analyse && !enough) return toast('Colle la transcription complète de l’appel (au moins quelques minutes de conversation).', true)
    if (!f.transcript.trim() && !file) return toast('Colle la transcription ou ajoute l’audio.', true)
    if (file && file.size > 50 * 1024 * 1024) return toast('Ce fichier dépasse 50 Mo. Colle plutôt la transcription (ou compresse l’audio).', true)
    setBusy(analyse ? 'analyse' : 'save')
    try {
      let audio_path = null
      if (file) {
        const { data: s } = await supabase.auth.getSession(); const uid = s?.session?.user?.id
        const path = `${uid}/${Date.now()}-${safeName(file.name)}`
        const up = await supabase.storage.from('call-audio').upload(path, file, { contentType: file.type || undefined })
        if (up.error) throw up.error
        audio_path = path
      }
      const { data, error } = await supabase.from('call_reviews').insert({ closer, candidature_id: f.cand ? Number(f.cand) : null, title: f.title.trim() || calls.find((x) => String(x.id) === f.cand)?.first_name || 'Appel', call_date: f.date || null, outcome: f.outcome || null, transcript: f.transcript.trim(), audio_path }).select(LIST_COLS).single()
      if (error) throw error
      let row = data
      if (analyse) { const r = await supabase.rpc('call_review_run', { p_id: data.id }); if (r.error) { toast(friendlyError(r.error), true) } else row = { ...data, status: 'analyse' } }
      onCreated(row); setF({ cand: '', title: '', closer: '', date: '', outcome: '', transcript: '' }); setFile(null); if (fileRef.current) fileRef.current.value = ''
      toast(analyse ? 'Appel ajouté : l’analyse démarre (environ une minute)' : 'Appel enregistré')
    } catch (e) { toast(friendlyError(e), true) }
    setBusy('')
  }
  return <section className="rt-card">
    <h3 className="rt-h">Ajouter un appel</h3>
    <div className="cc-f">
      <label>Appel lié <small className="muted">(facultatif)</small>
        <select className="rt-sel" value={f.cand} onChange={(e) => pickCall(e.target.value)}><option value="">— Aucun —</option>{calls.map((c) => <option key={c.id} value={c.id}>{c.first_name} · {fmtDate(c.starts_at)}</option>)}</select></label>
      <label>Nom de l’appel<input className="ti" placeholder="ex. Agnès" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
      {!isCloser && <label>Closer<select className="rt-sel" value={closer} onChange={(e) => setF({ ...f, closer: e.target.value })}>{closers.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}</select></label>}
      <label>Date de l’appel<input className="ti" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
    </div>
    <div className="rt-if"><span>Résultat de l’appel</span><div className="chips">{OUT.map(([v, l]) => <button type="button" key={v} className={`chip ${f.outcome === v ? 'sel' : ''}`} onClick={() => setF({ ...f, outcome: f.outcome === v ? '' : v })}>{l}</button>)}</div></div>
    <label className="cc-l">Transcription de l’appel
      <textarea className="ti cc-ta" rows={7} placeholder="Colle ici la transcription (Loom, Zoom, Meet, Fathom…). Idéal : « Prénom : ce qui est dit » à chaque réplique, pour que Calio affiche la conversation avec les avatars." value={f.transcript} onChange={(e) => setF({ ...f, transcript: e.target.value })} /></label>
    <label className="cc-l">Audio ou vidéo <small className="muted">(facultatif, pour la réécouter · 50 Mo max)</small>
      <input ref={fileRef} type="file" accept="audio/*,video/mp4,video/quicktime,video/webm" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
    <p className="muted s12">L’analyse est faite par l’IA et reste visible seulement par le closer concerné et par toi.</p>
    <div className="acts"><span style={{ flex: 1 }} />
      <button type="button" className="btn ghost" disabled={!!busy} onClick={() => submit(false)}>{busy === 'save' ? '…' : 'Enregistrer sans analyser'}</button>
      <button type="button" className="btn" disabled={!!busy} onClick={() => submit(true)}>{busy === 'analyse' ? 'Envoi…' : 'Analyser avec le coach'}</button></div>
  </section>
}

function Detail({ id, toast, cname, onPatch, onDeleted }) {
  const [r, setR] = useState(null); const [url, setUrl] = useState(''); const [busy, setBusy] = useState(false); const [showT, setShowT] = useState(false)
  const load = async () => {
    const { data, error } = await supabase.from('call_reviews').select('*').eq('id', id).single()
    if (error) return toast(friendlyError(error), true)
    setR(data)
    if (data.audio_path) { const s = await supabase.storage.from('call-audio').createSignedUrl(data.audio_path, 3600); if (!s.error) setUrl(s.data.signedUrl) }
  }
  useEffect(() => { load() }, [id])
  // Tant que l'IA travaille, on regarde toutes les 4 secondes si sa réponse est arrivée.
  useEffect(() => {
    if (r?.status !== 'analyse') return undefined
    const t = setInterval(async () => {
      const { data, error } = await supabase.rpc('call_review_poll', { p_id: id })
      if (error || !data) return
      setR((x) => ({ ...x, ...data })); onPatch(data)
      if (data.status === 'erreur') toast(data.err || 'L’analyse a échoué.', true)
    }, 4000)
    return () => clearInterval(t)
  }, [r?.status, id])
  const run = async () => {
    setBusy(true); const { error } = await supabase.rpc('call_review_run', { p_id: id }); setBusy(false)
    if (error) return toast(friendlyError(error), true)
    const n = { ...r, status: 'analyse', err: null }; setR(n); onPatch(n); toast('Analyse relancée (environ une minute)')
  }
  const del = async () => {
    if (!window.confirm('Supprimer cet appel, sa transcription et son analyse ? C’est définitif.')) return
    if (r.audio_path) await supabase.storage.from('call-audio').remove([r.audio_path])
    const { error } = await supabase.from('call_reviews').delete().eq('id', id); if (error) return toast(friendlyError(error), true)
    toast('Appel supprimé'); onDeleted()
  }
  const delAudio = async () => {
    if (!window.confirm('Supprimer l’audio ? La transcription et l’analyse restent.')) return
    await supabase.storage.from('call-audio').remove([r.audio_path])
    const { error } = await supabase.from('call_reviews').update({ audio_path: null }).eq('id', id); if (error) return toast(friendlyError(error), true)
    setUrl(''); setR({ ...r, audio_path: null }); onPatch({ ...r, audio_path: null }); toast('Audio supprimé')
  }
  const dlg = useMemo(() => (r ? parseDialogue(r.transcript) : null), [r?.transcript])
  if (!r) return <section className="rt-card"><p className="muted">Chargement…</p></section>
  const a = r.analysis || null; const d = a?.notes_detail || {}; const sc = num(r.score ?? a?.note)
  return <section className="rt-card cc-det">
    <div className="ev-top"><h3 className="rt-h" style={{ margin: 0 }}>{r.title || 'Appel'} <small>{cname(r.closer)}{r.call_date ? ' · ' + fmtDate(r.call_date) : ''}{r.outcome ? ' · ' + OUT_L[r.outcome] : ''}</small></h3>
      <span className="cc-acts">{r.transcript?.trim().length >= 300 && r.status !== 'analyse' && <button type="button" className="btn ghost sm" disabled={busy} onClick={run}>{r.status === 'ok' ? 'Relancer l’analyse' : 'Analyser'}</button>}<button type="button" className="btn danger sm" onClick={del}>Supprimer</button></span></div>

    {url && <div className="cc-audio"><audio controls preload="none" src={url} />{r.audio_path && <button type="button" className="btn ghost sm" onClick={delAudio}>Supprimer l’audio</button>}</div>}

    {r.status === 'analyse' && <p className="rt-warn" style={{ background: '#FFFAEB' }}>Le coach analyse l’appel… cela prend environ une minute. Tu peux rester ici.</p>}
    {r.status === 'erreur' && <p className="rt-warn">{r.err || 'L’analyse a échoué.'} Tu peux la relancer.</p>}
    {r.status === 'nouveau' && !a && <p className="muted s12">Cet appel n’a pas encore été analysé.{r.transcript?.trim().length < 300 ? ' Il faut coller la transcription complète pour que le coach puisse le faire.' : ''}</p>}

    {a && <div className="cc-an">
      <div className="cc-top"><div className={`cc-big ${scoreCls(sc)}`}>{sc ?? '–'}<small>/10</small></div>
        <div className="cc-sub">{[['decouverte', 'Découverte'], ['objections', 'Objections'], ['closing', 'Closing'], ['ecoute', 'Écoute']].filter(([k]) => num(d[k]) != null).map(([k, l]) => <div key={k}><span>{l}</span><div className="cc-bar"><i className={scoreCls(num(d[k]))} style={{ width: Math.max(4, Math.min(100, num(d[k]) * 10)) + '%' }} /></div><b>{num(d[k])}</b></div>)}</div></div>
      {a.resume && <p className="cc-res">{txt(a.resume)}</p>}
      {!!arr(a.points_forts).length && <div className="cc-sec ok"><h4>Ce qui était bien</h4><ul>{arr(a.points_forts).map((x, i) => <li key={i}>{txt(x)}</li>)}</ul></div>}
      {!!arr(a.a_ameliorer).length && <div className="cc-sec warn"><h4>À améliorer</h4><ul>{arr(a.a_ameliorer).map((x, i) => <li key={i}>{txt(x)}</li>)}</ul></div>}
      {!!arr(a.objections).length && <div className="cc-sec"><h4>Objections rencontrées</h4>{arr(a.objections).map((o, i) => <div key={i} className="cc-obj">
        <div className="cc-q">« {txt(o.objection)} » {o.traitement && <span className={`badge ${/bien/i.test(o.traitement) ? 'ok' : /partiel/i.test(o.traitement) ? 'wait' : 'dq'}`}>{/bien/i.test(o.traitement) ? 'Bien traitée' : /partiel/i.test(o.traitement) ? 'Traitée en partie' : 'Mal traitée'}</span>}</div>
        {o.commentaire && <p className="muted s12">{txt(o.commentaire)}</p>}{o.meilleure_reponse && <p className="cc-say"><b>Ce que j’aurais dit :</b> {txt(o.meilleure_reponse)}</p>}</div>)}</div>}
      {!!arr(a.moments_cles).length && <div className="cc-sec"><h4>Moments clés</h4>{arr(a.moments_cles).map((m, i) => <div key={i} className="cc-quote">« {txt(m.extrait)} »<small>{txt(m.commentaire)}</small></div>)}</div>}
      {!!arr(a.a_dire_la_prochaine_fois).length && <div className="cc-sec"><h4>À dire la prochaine fois</h4>{arr(a.a_dire_la_prochaine_fois).map((x, i) => <div key={i} className="cc-quote say">« {txt(x)} »</div>)}</div>}
      {a.prochaine_action && <div className="cc-next"><b>À travailler en priorité</b>{txt(a.prochaine_action)}</div>}
    </div>}

    {r.transcript?.trim() && <div className="cc-tr">
      <button type="button" className="btn ghost sm" onClick={() => setShowT(!showT)}>{showT ? 'Masquer la transcription' : 'Voir la transcription'}</button>
      {showT && (dlg ? <div className="cc-chat">{dlg.turns.map((t, i) => { const side = dlg.who.indexOf(t.who) % 2; return <div key={i} className={`cc-msg s${side}`}><span className={`rt-av cc-av s${side}`}>{ini(t.who)}</span><div><small>{t.who || '—'}{t.at ? ' · ' + t.at : ''}</small><p>{t.text}</p></div></div> })}</div>
        : <pre className="cc-raw">{r.transcript}</pre>)}
    </div>}
  </section>
}
