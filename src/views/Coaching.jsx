import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/data'

/* ───────── icônes (traits fins, style pro) ───────── */
const I = {
  mic: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" /></svg>,
  camera: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>,
  clip: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5 12.5 20a5.5 5.5 0 0 1-7.8-7.8L13 4a3.7 3.7 0 0 1 5.2 5.2L10 17.4a1.8 1.8 0 0 1-2.6-2.6L15 7.3" /></svg>,
  send: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12 20 4l-4 16-4-7z" /></svg>,
  play: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z" /></svg>,
  pause: <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>,
  stop: <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>,
  trash: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>,
  clock: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>,
  back: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m14.5 5-7 7 7 7" /></svg>,
  check: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7" /></svg>,
  checks: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m2 12.5 4.5 4.5L15 8.5M9 17l1.5 1.5L22 7" /></svg>,
  moon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" /></svg>,
  spark: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" /></svg>,
  users: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-5-6.3" /></svg>,
  x: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>,
  info: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></svg>,
}
export const CoIcon = ({ n, className }) => <span className={`coi ${className || ''}`}>{I[n]}</span>

const KIND = { coach: { label: 'Ton coach', sub: 'Ton accompagnement au quotidien' }, clement: { label: 'Clément', sub: 'Le fondateur · pour les grandes étapes' }, team: { label: 'Mon équipe', sub: 'Toi, ton coach, Clément et Jérémy' }, ai: { label: 'Coach IA', sub: 'Réponse immédiate, 24 h/24' } }
const fmtTime = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
const fmtDay = (d) => { const x = new Date(d), t = new Date(); const diff = Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()) - new Date(x.getFullYear(), x.getMonth(), x.getDate())) / 864e5); return diff === 0 ? "Aujourd'hui" : diff === 1 ? 'Hier' : x.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) }
const ago = (d) => { if (!d) return ''; const s = (Date.now() - new Date(d)) / 1000; if (s < 60) return "à l'instant"; if (s < 3600) return `${Math.floor(s / 60)} min`; if (s < 86400) return `${Math.floor(s / 3600)} h`; return `${Math.floor(s / 86400)} j` }
const dur = (s) => `${Math.floor((s || 0) / 60)}:${String((s || 0) % 60).padStart(2, '0')}`
const initials = (n) => (n || '?').split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase()

/* ───────── média (liens signés, cache) ───────── */
const urlCache = new Map()
async function signed(path) {
  if (!path) return null
  if (path.startsWith('http')) return path
  if (urlCache.has(path)) return urlCache.get(path)
  const { data } = await supabase.storage.from('coaching').createSignedUrl(path, 3600 * 6)
  if (data?.signedUrl) urlCache.set(path, data.signedUrl)
  return data?.signedUrl || null
}
function useSigned(path) { const [u, setU] = useState(() => urlCache.get(path) || null); useEffect(() => { let ok = true; signed(path).then(x => ok && setU(x)); return () => { ok = false } }, [path]); return u }

function Voice({ m, mine }) {
  const url = useSigned(m.media_url)
  const a = useRef(null); const [on, setOn] = useState(false); const [p, setP] = useState(0); const [rate, setRate] = useState(1)
  const bars = useMemo(() => Array.from({ length: 28 }, (_, i) => 6 + Math.abs(Math.sin(i * 1.7 + (m.id % 7))) * 14), [m.id])
  const toggle = () => { const el = a.current; if (!el) return; if (on) el.pause(); else { el.playbackRate = rate; el.play() } }
  const cycle = () => { const r = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1; setRate(r); if (a.current) a.current.playbackRate = r }
  return <div className={`covoice ${mine ? 'mine' : ''}`}>
    {url && <audio ref={a} src={url} preload="metadata" onPlay={() => setOn(true)} onPause={() => setOn(false)} onEnded={() => { setOn(false); setP(0) }} onTimeUpdate={e => setP(e.target.duration ? e.target.currentTime / e.target.duration : 0)} />}
    <button type="button" className="pl" onClick={toggle} disabled={!url}>{on ? I.pause : I.play}</button>
    <div className="wf" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); const f = (e.clientX - r.left) / r.width; if (a.current?.duration) a.current.currentTime = f * a.current.duration }}>{bars.map((h, i) => <i key={i} style={{ height: h, opacity: i / bars.length <= p ? 1 : .4 }} />)}</div>
    <span className="d">{dur(m.duration_s)}</span>
    <button type="button" className="sp" onClick={cycle}>{rate}×</button>
    {m.transcript && <div className="tr">{m.transcript}</div>}
  </div>
}
function Pic({ m }) { const url = useSigned(m.media_url); return url ? <a href={url} target="_blank" rel="noreferrer"><img className="copic" src={url} alt="" loading="lazy" /></a> : <div className="copic ph" /> }
function Vid({ m }) { const url = useSigned(m.media_url); return url ? <video className="copic" src={url} controls playsInline preload="metadata" /> : <div className="copic ph" /> }

/* ───────── enregistreur vocal ───────── */
function useRecorder() {
  const rec = useRef(null); const chunks = useRef([]); const t0 = useRef(0); const timer = useRef(null)
  const [state, setState] = useState('idle'); const [sec, setSec] = useState(0)
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || ''
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunks.current = []; r.ondataavailable = e => e.data.size && chunks.current.push(e.data)
      r.start(250); rec.current = r; t0.current = Date.now(); setSec(0); setState('rec')
      timer.current = setInterval(() => { const s = Math.round((Date.now() - t0.current) / 1000); setSec(s); if (s >= 120) stop() }, 250)
    } catch (e) { alert('Micro indisponible : autorise le micro pour L\'Accélérateur dans les réglages de ton téléphone.') }
  }
  const stop = () => new Promise(res => { const r = rec.current; if (!r || r.state === 'inactive') return res(null); clearInterval(timer.current); r.onstop = () => { r.stream.getTracks().forEach(t => t.stop()); const type = r.mimeType || 'audio/webm'; const blob = new Blob(chunks.current, { type }); setState('idle'); res({ blob, type, seconds: Math.max(1, Math.round((Date.now() - t0.current) / 1000)) }) }; r.stop() })
  const cancel = async () => { const r = rec.current; clearInterval(timer.current); if (r && r.state !== 'inactive') { r.onstop = () => r.stream.getTracks().forEach(t => t.stop()); r.stop() } setState('idle') }
  return { state, sec, start, stop, cancel }
}

async function upload(threadId, blob, type, ext) {
  const path = `${threadId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from('coaching').upload(path, blob, { contentType: type, upsert: false })
  if (error) throw error
  return path
}
const compress = (file) => new Promise((res) => { if (!file.type.startsWith('image/')) return res(file); const img = new Image(); const u = URL.createObjectURL(file); img.onload = () => { const max = 1600; const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); c.toBlob(b => { URL.revokeObjectURL(u); res(b || file) }, 'image/jpeg', .85) }; img.onerror = () => res(file); img.src = u })

/* ───────── fil de conversation ───────── */
export function CoThread({ me, thread, profiles, onBack, toast, isStaff }) {
  const [msgs, setMsgs] = useState([]); const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [sched, setSched] = useState(null)
  const [status, setStatus] = useState(null)
  const end = useRef(null); const fileIn = useRef(null); const R = useRecorder()
  const student = profiles.map?.[thread.student_id] || {}
  const coach = student.coach_id ? profiles.map?.[student.coach_id] : null
  const mineThread = thread.student_id === me.id
  const title = mineThread ? (thread.kind === 'coach' ? (coach?.name || 'Ton coach') : KIND[thread.kind].label) : `${student.name || 'Élève'}${thread.kind !== 'coach' ? ' · ' + KIND[thread.kind].label : ''}`
  const load = async () => { const { data } = await supabase.from('co_messages').select('*').eq('thread_id', thread.id).order('created_at').limit(400); setMsgs(data || []); markRead() }
  const markRead = () => supabase.from('co_reads').upsert({ thread_id: thread.id, user_id: me.id, last_read_at: new Date().toISOString() })
  useEffect(() => {
    load()
    if (coach?.id) supabase.from('coach_status').select('*').eq('user_id', coach.id).maybeSingle().then(({ data }) => setStatus(data))
    const ch = supabase.channel('co:' + thread.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'co_messages', filter: `thread_id=eq.${thread.id}` }, ({ new: m }) => { setMsgs(l => l.find(x => x.id === m.id) ? l : [...l, m]); markRead() })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'co_messages', filter: `thread_id=eq.${thread.id}` }, ({ new: m }) => setMsgs(l => l.map(x => x.id === m.id ? m : x)))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'co_messages' }, ({ old }) => setMsgs(l => l.filter(x => x.id !== old.id)))
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [thread.id])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs.length])
  useEffect(() => { document.body.classList.add('co-thread-open'); return () => document.body.classList.remove('co-thread-open') }, [])

  const send = async (payload) => {
    setBusy(true)
    const row = { thread_id: thread.id, sender_id: me.id, ...payload }
    if (sched) { row.scheduled_at = sched; row.sent_at = null }
    const { error } = await supabase.from('co_messages').insert(row)
    setBusy(false)
    if (error) return toast(friendlyError(error), true)
    if (sched) { toast(`Programmé pour ${new Date(sched).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`); setSched(null) }
  }
  const sendText = async (e) => { e?.preventDefault(); const t = text.trim(); if (!t) return; setText(''); await send({ kind: 'text', body: t }) }
  const onFile = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return
    if (f.size > 100 * 1024 * 1024) return toast('Fichier trop lourd (100 Mo max)', true)
    setBusy(true)
    try {
      const isVid = f.type.startsWith('video/'); const blob = isVid ? f : await compress(f)
      const ext = isVid ? (f.name.split('.').pop() || 'mp4') : 'jpg'
      const path = await upload(thread.id, blob, isVid ? f.type : 'image/jpeg', ext)
      await send({ kind: isVid ? 'video' : 'image', media_url: path, media_type: isVid ? f.type : 'image/jpeg', media_size: blob.size })
    } catch (err) { toast(friendlyError(err), true) }
    setBusy(false)
  }
  const stopAndSend = async () => {
    const r = await R.stop(); if (!r) return
    setBusy(true)
    try { const ext = r.type.includes('mp4') ? 'm4a' : r.type.includes('ogg') ? 'ogg' : 'webm'; const path = await upload(thread.id, r.blob, r.type.split(';')[0], ext); await send({ kind: 'voice', media_url: path, media_type: r.type.split(';')[0], media_size: r.blob.size, duration_s: r.seconds }) }
    catch (err) { toast(friendlyError(err), true) }
    setBusy(false)
  }
  const cancelScheduled = async (m) => { const { error } = await supabase.from('co_messages').delete().eq('id', m.id); if (error) toast(friendlyError(error), true) }

  const away = status && (!status.available || (status.away_until && new Date(status.away_until) > new Date()))
  const sub = mineThread && thread.kind === 'coach' ? (!coach ? 'Un coach va t\'être attribué' : away ? `indisponible · reprend ${status.away_until ? 'à ' + fmtTime(status.away_until) : 'bientôt'}` : 'disponible') : mineThread ? KIND[thread.kind].sub : `${student.email || ''}`
  let lastDay = ''
  const canSchedule = isStaff && !mineThread
  return <div className="co cothread">
    <div className="cohead">
      <button className="coic" onClick={onBack}>{I.back}</button>
      <div className={`coav ${!away && coach ? 'ring' : ''}`}>{thread.kind === 'ai' && mineThread ? <span className="ai">{I.spark}</span> : (mineThread ? (coach?.avatar_url ? <img src={coach.avatar_url} alt="" /> : initials(coach?.name || KIND[thread.kind].label)) : (student.avatar_url ? <img src={student.avatar_url} alt="" /> : initials(student.name)))}</div>
      <div className="t"><b>{title}</b><small className={away ? 'away' : ''}>{sub}</small></div>
      {!mineThread && <button className="coic" title="Fiche élève" onClick={() => toast(`${student.name} · ${student.email}`)}>{I.info}</button>}
    </div>
    <div className="cobody">
      {thread.kind === 'ai' && <div className="cosys ai">Coach IA arrive dans l'étape suivante : pour l'instant, ce fil garde tes questions, ton coach les voit.</div>}
      {msgs.map(m => {
        const day = fmtDay(m.sent_at || m.created_at); const showDay = day !== lastDay; lastDay = day
        const mine = m.sender_id === me.id; const who = m.sender_id ? profiles.map?.[m.sender_id] : null
        const scheduled = !m.sent_at && m.scheduled_at
        return <div key={m.id} className="cowrap">
          {showDay && <div className="coday"><span>{day}</span></div>}
          {m.kind === 'system' ? <div className="cosys gold">{m.body}</div> :
            <div className={`cobub ${mine ? 'me' : ''} ${m.ai ? 'ai' : ''} ${m.kind === 'image' || m.kind === 'video' ? 'media' : ''} ${scheduled ? 'sched' : ''}`}>
              {!mine && (thread.kind !== 'coach' || !mineThread) && <span className="who">{m.ai ? 'Coach IA' : who?.name || 'Membre'}</span>}
              {m.kind === 'voice' ? <Voice m={m} mine={mine} /> : m.kind === 'image' ? <Pic m={m} /> : m.kind === 'video' ? <Vid m={m} /> : <span className="txt">{m.body}</span>}
              <small>{scheduled ? <>{I.clock} programmé {new Date(m.scheduled_at).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} <button type="button" onClick={() => cancelScheduled(m)}>annuler</button></> : <>{fmtTime(m.sent_at)} {mine && <span className="ck">{I.checks}</span>}</>}</small>
            </div>}
        </div>
      })}
      {!msgs.length && <div className="coempty"><div className="coav big">{mineThread ? initials(coach?.name || KIND[thread.kind].label) : initials(student.name)}</div><b>{title}</b><p>{mineThread ? (thread.kind === 'coach' ? 'Pose ta question, envoie une capture ou un vocal : ton coach te répond dans la journée.' : KIND[thread.kind].sub) : 'Démarre la conversation.'}</p></div>}
      <div ref={end} />
    </div>
    {sched && <div className="cosched">{I.clock}<span>Sera envoyé <b>{new Date(sched).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</b></span><button type="button" onClick={() => setSched(null)}>{I.x}</button></div>}
    {R.state === 'rec' ? <div className="coinput rec">
      <button type="button" className="coic danger" onClick={R.cancel}>{I.trash}</button>
      <div className="recbar"><i className="dot" /><span>Enregistrement · {dur(R.sec)}</span><em>2:00 max</em></div>
      <button type="button" className="cosend" onClick={stopAndSend} disabled={busy}>{I.send}</button>
    </div> : <form className="coinput" onSubmit={sendText}>
      <button type="button" className="coic" onClick={() => fileIn.current?.click()} disabled={busy}>{I.camera}</button>
      <input ref={fileIn} type="file" accept="image/*,video/*" hidden onChange={onFile} />
      <div className="cofield"><input value={text} onChange={e => setText(e.target.value)} placeholder={busy ? 'Envoi…' : 'Message'} disabled={busy} />
        {canSchedule && <button type="button" className={`inic ${sched ? 'on' : ''}`} title="Programmer" onClick={() => { const d = new Date(Date.now() + 3600e3); d.setMinutes(0, 0, 0); const v = prompt('Envoyer quand ? (JJ/MM HH:MM)', `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`); if (!v) return; const m = v.match(/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/); if (!m) return toast('Format : JJ/MM HH:MM', true); const t = new Date(); const dt = new Date(t.getFullYear(), +m[2] - 1, +m[1], +m[3], +m[4]); if (dt < t) dt.setFullYear(dt.getFullYear() + 1); setSched(dt.toISOString()) }}>{I.clock}</button>}
      </div>
      {text.trim() ? <button type="submit" className="cosend" disabled={busy}>{I.send}</button> : <button type="button" className="cosend mic" onClick={R.start} disabled={busy}>{I.mic}</button>}
    </form>}
  </div>
}

/* ───────── liste élève ───────── */
export function CoStudentHome({ me, profiles, toast, go, isStaff, viewStudent }) {
  const sid = viewStudent || me.id
  const [threads, setThreads] = useState(null); const [cur, setCur] = useState(null); const [unread, setUnread] = useState({})
  const coach = me.coach_id ? profiles.map?.[me.coach_id] : null
  const [status, setStatus] = useState(null)
  const load = async () => {
    const { data, error } = await supabase.rpc('co_my_threads', { p_student: sid })
    if (error) { toast(friendlyError(error), true); return }
    const order = ['coach', 'clement', 'ai', 'team']; setThreads((data || []).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind)))
    const ids = (data || []).map(t => t.id)
    if (ids.length) { const { data: last } = await supabase.from('co_messages').select('thread_id,kind,body,sent_at,sender_id').in('thread_id', ids).not('sent_at', 'is', null).neq('kind', 'system').order('sent_at', { ascending: false }).limit(200); const m = {}; (last || []).forEach(x => { if (!m[x.thread_id]) m[x.thread_id] = x }); setUnread(m) }
  }
  useEffect(() => { load(); if (coach?.id) supabase.from('coach_status').select('*').eq('user_id', coach.id).maybeSingle().then(({ data }) => setStatus(data)) }, [sid])
  useEffect(() => { const h = () => { const m = location.hash.match(/^#co\/(\d+)/); if (m && threads) { const t = threads.find(x => String(x.id) === m[1]); if (t) setCur(t) } }; h(); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h) }, [threads])
  if (cur) return <CoThread me={me} thread={cur} profiles={profiles} toast={toast} isStaff={isStaff} onBack={() => { setCur(null); load(); if (location.hash.startsWith('#co/')) history.replaceState(null, '', '#co') }} />
  const away = status && (!status.available || (status.away_until && new Date(status.away_until) > new Date()))
  return <div className="co">
    <div className="cohead main"><div className="t"><b>Messages</b><small>Ton accompagnement, au même endroit</small></div></div>
    <div className="cobody list">
      {coach && away && <div className="cobanner">{I.moon}<span>Ton coach <b>{coach.name}</b> est indisponible{status.away_until ? <> et te répond à partir de <b>{fmtTime(status.away_until)}</b></> : ''}. Laisse ton message, il le verra.</span></div>}
      {!coach && <div className="cobanner">{I.users}<span>Ton coach va t'être attribué par l'équipe. En attendant, écris à Clément ou au Coach IA.</span></div>}
      {threads === null ? <div className="coempty"><p>Chargement…</p></div> : threads.map(t => {
        const last = unread[t.id]; const k = KIND[t.kind]
        const name = t.kind === 'coach' ? (coach?.name ? `${coach.name} · ton coach` : 'Ton coach') : k.label
        const av = t.kind === 'coach' ? coach : t.kind === 'clement' ? profiles.list?.find(p => p.role === 'admin' && /cl[eé]ment/i.test(p.name)) : null
        return <button key={t.id} className="coconv" onClick={() => { setCur(t); history.replaceState(null, '', '#co/' + t.id) }}>
          <div className={`coav ${t.kind === 'coach' && coach && !away ? 'ring' : ''} ${t.kind === 'ai' ? 'aiav' : ''}`}>{t.kind === 'ai' ? I.spark : t.kind === 'team' ? I.users : av?.avatar_url ? <img src={av.avatar_url} alt="" /> : initials(av?.name || k.label)}</div>
          <div className="t"><b>{name}</b><small>{last ? (last.kind === 'voice' ? '🎤 Message vocal' : last.kind === 'image' ? '📷 Photo' : last.kind === 'video' ? '🎬 Vidéo' : last.body) : k.sub}</small></div>
          <div className="m">{last ? ago(last.sent_at) : ''}</div>
        </button>
      })}
    </div>
  </div>
}

/* ───────── réception coach / admin ───────── */
export function CoInbox({ me, profiles, toast, isAdmin, mode, refresh }) {
  if (mode === 'students') return <CoStudents me={me} profiles={profiles} toast={toast} isAdmin={isAdmin} refresh={refresh} />
  const [rows, setRows] = useState(null); const [cur, setCur] = useState(null); const [f, setF] = useState('todo'); const [status, setStatus] = useState(null); const [q, setQ] = useState('')
  const load = async () => { await supabase.rpc('co_ensure_threads'); const { data, error } = await supabase.rpc('co_inbox'); if (error) return toast(friendlyError(error), true); setRows(data || []) }
  const loadStatus = () => supabase.from('coach_status').select('*').eq('user_id', me.id).maybeSingle().then(({ data }) => setStatus(data || { user_id: me.id, available: true, hours: { start: '09:00', end: '20:00', days: [1, 2, 3, 4, 5, 6] }, sla_min: 120 }))
  useEffect(() => { load(); loadStatus(); const ch = supabase.channel('co:inbox').on('postgres_changes', { event: '*', schema: 'public', table: 'co_messages' }, () => load()).subscribe(); return () => supabase.removeChannel(ch) }, [])
  useEffect(() => { const h = () => { const m = location.hash.match(/^#co\/(\d+)/); if (m && rows) { const t = rows.find(x => String(x.id) === m[1]); if (t) setCur(t) } }; h(); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h) }, [rows])
  const saveStatus = async (patch) => { const next = { ...status, ...patch, user_id: me.id, updated_at: new Date().toISOString() }; setStatus(next); const { error } = await supabase.from('coach_status').upsert(next); if (error) toast(friendlyError(error), true) }
  if (cur) return <CoThread me={me} thread={cur} profiles={profiles} toast={toast} isStaff onBack={() => { setCur(null); load(); if (location.hash.startsWith('#co/')) history.replaceState(null, '', '#co') }} />
  const list = (rows || []).filter(r => r.kind === 'coach' || r.kind === 'team' || r.kind === 'clement').filter(r => !q || (r.student_name || '').toLowerCase().includes(q.toLowerCase()))
  const todo = list.filter(r => r.waiting_since), inactive = list.filter(r => r.kind === 'coach' && (!r.last_student_at || Date.now() - new Date(r.last_student_at) > 864e5))
  const shown = f === 'todo' ? todo : f === 'inactive' ? inactive : list
  const away = status && (!status.available || (status.away_until && new Date(status.away_until) > new Date()))
  const sla = (status?.sla_min || 120) * 60e3
  return <div className="co">
    <div className="cohead main"><div className="t"><b>Réception</b><small>{todo.length} à répondre · {list.length} conversations</small></div></div>
    <div className="cobody list">
      {status && <div className={`costatus ${away ? 'off' : ''}`}>
        <div className="t"><b>{away ? `Indisponible${status.away_until && new Date(status.away_until) > new Date() ? ` jusqu'à ${fmtTime(status.away_until)}` : ''}` : 'Je suis disponible'}</b><small>{away ? 'Tes élèves sont prévenus automatiquement dans le fil' : `Heures de réponse ${status.hours?.start?.replace(':', 'h')} – ${status.hours?.end?.replace(':', 'h')} · objectif ${status.sla_min} min`}</small></div>
        <button type="button" className={`cosw ${away ? '' : 'on'}`} onClick={() => { if (away) saveStatus({ available: true, away_until: null, away_note: '' }); else { const v = prompt("Indisponible jusqu'à quelle heure ? (HH:MM, vide = jusqu'à nouvel ordre)", '14:00'); if (v === null) return; let until = null; const m = v.match(/(\d{1,2})[:h](\d{2})?/); if (m) { until = new Date(); until.setHours(+m[1], +(m[2] || 0), 0, 0); if (until < new Date()) until.setDate(until.getDate() + 1) } saveStatus({ available: false, away_until: until ? until.toISOString() : null }) } }} aria-label="Disponibilité" />
      </div>}
      <div className="cokp"><div><small>À répondre</small><b className="g">{todo.length}</b></div><div><small>Inactifs 24 h</small><b>{inactive.length}</b></div></div>
      <div className="cochips"><button className={f === 'todo' ? 'on' : ''} onClick={() => setF('todo')}>À répondre · {todo.length}</button><button className={f === 'inactive' ? 'on' : ''} onClick={() => setF('inactive')}>Inactifs 24 h · {inactive.length}</button><button className={f === 'all' ? 'on' : ''} onClick={() => setF('all')}>Tous · {list.length}</button></div>
      <input className="cosearch" placeholder="Rechercher un élève" value={q} onChange={e => setQ(e.target.value)} />
      {rows === null ? <div className="coempty"><p>Chargement…</p></div> : !shown.length ? <div className="coempty"><p>{f === 'todo' ? 'Tout est répondu ✓' : 'Rien ici.'}</p></div> : shown.map(r => {
        const wait = r.waiting_since ? Date.now() - new Date(r.waiting_since) : 0
        const tag = r.waiting_since ? { cls: wait > sla ? 'warn' : 'gold', txt: `attend depuis ${ago(r.waiting_since)}` } : r.last && r.last.sender_id !== r.student_id ? { cls: 'ok', txt: 'répondu' } : null
        const inact = r.kind === 'coach' && r.last_student_at && Date.now() - new Date(r.last_student_at) > 864e5
        return <button key={r.id} className={`coconv ${wait > sla ? 'hot' : ''}`} onClick={() => { setCur(r); history.replaceState(null, '', '#co/' + r.id) }}>
          <div className="coav">{r.student_avatar ? <img src={r.student_avatar} alt="" /> : initials(r.student_name)}</div>
          <div className="t"><b>{r.student_name}{r.kind !== 'coach' && <span className="kind"> · {KIND[r.kind].label}</span>}</b><small>{r.last ? (r.last.kind === 'voice' ? '🎤 Vocal' : r.last.kind === 'image' ? '📷 Photo' : r.last.kind === 'video' ? '🎬 Vidéo' : r.last.body) : 'Pas encore de message'}</small>
            <span className="tags">{tag && <em className={`cotag ${tag.cls}`}>{tag.txt}</em>}{inact && <em className="cotag warn">inactif {ago(r.last_student_at)}</em>}{r.msgs7 >= 10 && <em className="cotag ok">très actif · {r.msgs7} msg / 7 j</em>}</span></div>
          <div className="m">{r.last ? ago(r.last.sent_at) : ''}{r.unread > 0 && <span className="n">{r.unread}</span>}</div>
        </button>
      })}
    </div>
  </div>
}

/* ───────── élèves : tous les membres, démarrer une conversation, attribuer un coach ───────── */
export function CoStudents({ me, profiles, toast, isAdmin, refresh }) {
  const [q, setQ] = useState(''); const [cur, setCur] = useState(null); const [busy, setBusy] = useState(false)
  const members = (profiles.list || []).filter(p => p.role === 'member' && p.active !== false && (!q || (p.name || '').toLowerCase().includes(q.toLowerCase()) || (p.email || '').toLowerCase().includes(q.toLowerCase())))
  const coaches = (profiles.list || []).filter(p => p.role === 'coach' || p.role === 'admin')
  const openWith = async (p, kind) => {
    setBusy(true)
    const { data, error } = await supabase.rpc('co_my_threads', { p_student: p.id }); setBusy(false)
    if (error) return toast(friendlyError(error), true)
    const t = (data || []).find(x => x.kind === kind) || (data || [])[0]
    if (!t) return toast('Impossible d\'ouvrir la conversation', true)
    setCur(t); history.replaceState(null, '', '#co/' + t.id)
  }
  const setCoach = async (p, coach_id) => { const { error } = await supabase.from('profiles').update({ coach_id: coach_id || null }).eq('id', p.id); if (error) return toast(friendlyError(error), true); toast('Coach attribué'); refresh?.() }
  if (cur) return <CoThread me={me} thread={cur} profiles={profiles} toast={toast} isStaff onBack={() => { setCur(null); if (location.hash.startsWith('#co/')) history.replaceState(null, '', '#coeleves') }} />
  return <div className="co">
    <div className="cohead main"><div className="t"><b>Élèves</b><small>{members.length} membre{members.length > 1 ? 's' : ''} · touche un nom pour lui écrire</small></div></div>
    <div className="cobody list">
      <button type="button" className="coconv" disabled={busy} onClick={async () => { setBusy(true); const { data, error } = await supabase.rpc('co_my_threads'); setBusy(false); if (error) return toast(friendlyError(error), true); const t = (data || []).find(x => x.kind === 'coach') || (data || [])[0]; if (t) { setCur(t); history.replaceState(null, '', '#co/' + t.id) } }}>
        <div className="coav ring">{initials(me.name)}</div><div className="t"><b>Tester avec moi-même</b><small>Une conversation d'essai où tu es l'élève : vocaux, photos, programmation…</small></div><div className="m">›</div>
      </button>
      <input className="cosearch" placeholder="Rechercher un élève" value={q} onChange={e => setQ(e.target.value)} />
      {members.map(p => <div key={p.id} className="coconv static">
        <div className="coav">{p.avatar_url ? <img src={p.avatar_url} alt="" /> : initials(p.name)}</div>
        <div className="t"><b>{p.name}</b><small>{p.accel ? (p.tier >= 2 ? 'Accompagnement personnalisé' : 'Accompagnement') : p.methode ? 'Méthode 97 €' : 'Membre'}{p.coach_id ? ` · coach ${profiles.map?.[p.coach_id]?.name || ''}` : ''}</small>
          <span className="tags">
            <button type="button" className="cotag gold" disabled={busy} onClick={() => openWith(p, me.role === 'coach' ? 'coach' : 'clement')}>Écrire</button>
            <button type="button" className="cotag" disabled={busy} onClick={() => openWith(p, 'team')}>Groupe équipe</button>
            {isAdmin && <select className="cotag" value={p.coach_id || ''} onChange={e => setCoach(p, e.target.value)}><option value="">Coach : aucun</option>{coaches.map(c => <option key={c.id} value={c.id}>Coach : {c.name}</option>)}</select>}
          </span></div>
      </div>)}
      {!members.length && <div className="coempty"><p>Aucun membre trouvé.</p></div>}
    </div>
  </div>
}
