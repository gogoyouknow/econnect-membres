import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi']
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
const paris = (iso) => new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'Europe/Paris' }))
const dayKey = (iso) => { const d = paris(iso); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` }
const hhmm = (iso) => { const d = paris(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
const dayLabel = (iso) => { const d = paris(iso); const today = paris(new Date().toISOString()); const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000); return { top: diff === 0 ? "Aujourd'hui" : diff === 1 ? 'Demain' : DAYS[d.getDay()], sub: `${d.getDate()} ${MONTHS[d.getMonth()]}` } }

/** Calendrier 48 h : jours en onglets, créneaux en boutons, confirmation en un clic. */
export default function Booking({ lead, onBooked }) {
  const [slots, setSlots] = useState(null)
  const [day, setDay] = useState(null)
  const [pick, setPick] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const load = async () => { const { data, error } = await supabase.rpc('booking_slots'); if (error) setErr(error.message); else setSlots(data || []) }
  useEffect(() => { load() }, [])
  const days = useMemo(() => { const m = new Map(); (slots || []).forEach(s => { const k = dayKey(s); if (!m.has(k)) m.set(k, []); m.get(k).push(s) }); return [...m.entries()] }, [slots])
  useEffect(() => { if (days.length && (day === null || !days.find(d => d[0] === day))) setDay(days[0][0]) }, [days])
  const confirm = async () => {
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('book_slot', { p: { ...lead, starts_at: pick } })
    setBusy(false)
    if (error) { setErr(error.message.replace(/^.*?: /, '')); setPick(null); load(); return }
    onBooked?.(data)
  }
  if (slots === null) return <p className="muted">Je regarde mes disponibilités…</p>
  if (!days.length) return <div className="err">Plus aucun créneau dans les 48 h. Écris-moi sur WhatsApp et on cale ça : contact@theambitiousman.fr</div>
  const cur = days.find(d => d[0] === day)
  return <div className="bk">
    <div className="bk-days">{days.map(([k, list]) => { const l = dayLabel(list[0]); return <button key={k} type="button" className={k === day ? 'on' : ''} onClick={() => { setDay(k); setPick(null) }}><b>{l.top}</b><small>{l.sub} · {list.length} créneau{list.length > 1 ? 'x' : ''}</small></button> })}</div>
    <div className="bk-slots">{(cur?.[1] || []).map(s => <button key={s} type="button" className={pick === s ? 'on' : ''} onClick={() => setPick(s)}>{hhmm(s)}</button>)}</div>
    {pick && <div className="bk-confirm">
      <p>Appel de 30 min · <b>{dayLabel(pick).top} {dayLabel(pick).sub} à {hhmm(pick)}</b> (heure de Paris)<br /><span className="muted">Sur WhatsApp{lead.phone ? ` au ${lead.phone}` : ''} · confirmation envoyée à {lead.email}</span></p>
      <button type="button" className="btn big" disabled={busy} onClick={confirm}>{busy ? 'Réservation…' : 'Confirmer mon appel'}</button>
    </div>}
    {err && <div className="err">{err}</div>}
  </div>
}
