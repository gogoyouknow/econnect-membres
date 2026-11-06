import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import Logo from '../lib/Logo'

export const agenda = async (body) => {
  const { data, error } = await supabase.functions.invoke('agenda', { body })
  if (error) { let m = 'Erreur, réessaie dans un instant'; try { m = (await error.context.json()).error || m } catch { /* */ } throw new Error(m) }
  return data
}
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
export const fmtDay = (d) => new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
export const fmtHour = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

/** Choix d'un créneau : jours en haut, heures en dessous (dans le fuseau du prospect) */
export function SlotPicker({ onBook, busyLabel = 'Réserver ce créneau' }) {
  const [data, setData] = useState(null); const [err, setErr] = useState('')
  const [day, setDay] = useState(null); const [pick, setPick] = useState(null); const [busy, setBusy] = useState(false)
  const load = () => agenda({ action: 'slots' }).then(d => { setData(d); setErr('') }).catch(e => setErr(e.message))
  useEffect(() => { load() }, [])
  const days = useMemo(() => {
    const m = new Map(); (data?.slots || []).forEach(s => { const k = new Date(s).toLocaleDateString('fr-CA', { timeZone: tz }); if (!m.has(k)) m.set(k, []); m.get(k).push(s) }); return [...m.entries()]
  }, [data])
  useEffect(() => { if (days.length && !day) setDay(days[0][0]) }, [days])
  if (err) return <div className="err">{err}</div>
  if (!data) return <div className="muted">Chargement des disponibilités…</div>
  if (!days.length) return <div className="muted">Aucun créneau libre pour le moment. On te recontacte très vite par email ou WhatsApp.</div>
  const cur = (days.find(d => d[0] === day) || days[0])[1]
  async function go() { setBusy(true); try { await onBook(pick) } catch (e) { setErr(e.message); setPick(null); load() } finally { setBusy(false) } }
  return <div className="slots">
    <div className="sdays">{days.map(([k, list]) => { const d = new Date(list[0]); return <button key={k} type="button" className={`sday ${k === day ? 'on' : ''}`} onClick={() => { setDay(k); setPick(null) }}>
      <small>{d.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '')}</small><b>{d.getDate()}</b><small>{d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '')}</small></button> })}</div>
    <div className="stimes">{cur.map(s => <button key={s} type="button" className={`stime ${pick === s ? 'on' : ''}`} onClick={() => setPick(s)}>{fmtHour(s)}</button>)}</div>
    <small className="muted">Heures affichées dans ton fuseau ({tz.replace('_', ' ')}) · appel de {data.duration} min en visio</small>
    {pick && <button type="button" className="btn big" disabled={busy} onClick={go}>{busy ? 'Réservation…' : <>{busyLabel}<small style={{ display: 'block', fontWeight: 500, fontSize: 13, marginTop: 2 }}>{fmtDay(pick)} à {fmtHour(pick)}</small></>}</button>}
  </div>
}

/** Page publique /rdv?t=… : voir, déplacer ou annuler son rendez-vous */
export function RdvPage() {
  const t = new URLSearchParams(location.search).get('t') || ''
  const [b, setB] = useState(null); const [err, setErr] = useState(''); const [mode, setMode] = useState('view'); const [msg, setMsg] = useState('')
  const load = () => agenda({ action: 'get', token: t }).then(setB).catch(e => setErr(e.message))
  useEffect(() => { load() }, [])
  async function cancel() { if (!confirm('Annuler ton rendez-vous ?')) return; try { await agenda({ action: 'cancel', token: t }); setMsg('Ton rendez-vous est annulé.'); load() } catch (e) { setErr(e.message) } }
  return <section className="leadpage"><div className="leadcard">
    <div className="leadhead"><Logo size={26} /></div>
    {err && <div className="err">{err}</div>}
    {b && <div className="lstep">
      <h1>{b.status === 'annule' ? 'Rendez-vous annulé' : 'Ton rendez-vous'}</h1>
      {msg && <p>{msg}</p>}
      {b.status !== 'annule' && mode === 'view' && <>
        <p><b>{fmtDay(b.starts_at)} à {fmtHour(b.starts_at)}</b>{b.host ? ` avec ${b.host}` : ''}, en visio.</p>
        {b.meet_url && <a className="btn big" href={b.meet_url} target="_blank" rel="noreferrer">Lien de l'appel</a>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="btn ghost" onClick={() => setMode('move')}>Déplacer</button><button className="btn ghost danger" onClick={cancel}>Annuler</button></div>
      </>}
      {mode === 'move' && <><p>Choisis un nouveau créneau. L'ancien sera libéré automatiquement.</p>
        <SlotPicker busyLabel="Déplacer à" onBook={async (s) => { const r = await agenda({ action: 'book', token: t, start: s }); location.replace('/rdv?t=' + r.token) }} />
        <button className="lback" onClick={() => setMode('view')}>‹ Retour</button></>}
      {b.status === 'annule' && <p>Tu veux reprendre un créneau ? Écris-nous à contact@theambitiousman.fr.</p>}
    </div>}
  </div></section>
}
