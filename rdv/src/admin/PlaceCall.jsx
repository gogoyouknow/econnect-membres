import { useEffect, useState } from 'react'
import { supabase, friendlyError } from './supabase'
import Portal from './Portal'
import { parisISO, dayKey, timeOf, dayLabel, dayShort } from './Candidatures'

/** Place un appel à la main pour un prospect : créneau libre ou horaire de ton choix, et qui prend l'appel. */
export default function PlaceCall({ p, onClose, onDone, toast }) {
  const [slots, setSlots] = useState(null); const [day, setDay] = useState(''); const [pick, setPick] = useState(''); const [custom, setCustom] = useState('')
  const [closers, setClosers] = useState([]); const [closer, setCloser] = useState('clement')
  const [min, setMin] = useState(45); const [busy, setBusy] = useState(false); const [done, setDone] = useState('')
  useEffect(() => {
    supabase.rpc('cand_slots', { p_delai: '0' }).then(({ data }) => { setSlots(data || []); if (data && data[0]) setDay(dayKey(data[0])) }).catch(() => setSlots([]))
    supabase.from('cand_closers').select('key,name,active').order('key').then(({ data }) => { const L = (data || []).filter((c) => c.active !== false); setClosers(L); const w = String(p.closer || '').trim().toLowerCase(); const m = L.find((c) => c.key === w || String(c.name).toLowerCase() === w); if (m) setCloser(m.key) })
    supabase.from('cand_settings').select('slot_min').eq('id', 1).maybeSingle().then(({ data }) => data?.slot_min && setMin(data.slot_min))
  }, [])
  const iso = pick || (custom ? parisISO(custom) : '')
  const go = async () => {
    if (!iso) return
    if (new Date(iso).getTime() < Date.now() - 60000) return toast('Choisis un horaire à venir', true)
    if (!p.phone && !p.email) return toast('Il faut un numéro ou un email pour rattacher l’appel à la fiche', true)
    setBusy(true)
    const rec = { first_name: p.first_name || p.phone || p.email, phone: p.phone || null, email: p.email || null, situation: p.situation || null, capital: p.capital || null, budget_confirmed: p.budget_confirmed || 'yes', starts_at: iso, minutes: min, status: 'confirme', closer, route_note: 'Placé à la main' }
    const { error } = await supabase.from('candidatures').insert(rec)
    setBusy(false)
    if (error) return toast(error.code === '23505' ? 'Ce créneau est déjà pris, choisis-en un autre' : friendlyError(error), true)
    setDone(iso); toast('Appel placé'); onDone && onDone()
  }
  const name = p.first_name || 'ce prospect'
  return <Portal><div className="pr-modal" style={{ zIndex: 300 }} onClick={onClose}><div className="pr-mb" onClick={(e) => e.stopPropagation()}>
    {done ? <>
      <h3>✓ Appel placé</h3>
      <p>{name} : {dayLabel(done)} à {timeOf(done)}.</p>
      <p className="muted" style={{ fontSize: 13 }}>Il apparaît dans « Appels ». Aucun message n’est envoyé automatiquement : préviens-le toi-même.</p>
      <div className="acts"><button className="btn" onClick={onClose}>Fermer</button></div>
    </> : <>
      <h3>Placer un appel pour {name}</h3>
      {slots === null && <p className="muted">Je regarde les disponibilités…</p>}
      {!!(slots && slots.length) && <>
        <div className="lq">Jour</div>
        <div className="chips rp-days">{[...new Set(slots.map(dayKey))].slice(0, 21).map((k) => <button type="button" key={k} className={`chip ${day === k && !custom ? 'sel' : ''}`} onClick={() => { setDay(k); setPick(''); setCustom('') }}>{dayShort(slots.find((x) => dayKey(x) === k))}</button>)}</div>
        <div className="lq">Heure</div>
        <div className="chips rp-slots">{slots.filter((x) => dayKey(x) === day).map((x) => <button type="button" key={x} className={`chip ${pick === x ? 'sel' : ''}`} onClick={() => { setPick(x); setCustom('') }}>{timeOf(x)}</button>)}</div>
      </>}
      {slots && !slots.length && <p className="muted">Aucun créneau libre dans tes horaires. Choisis un horaire ci-dessous.</p>}
      <label className="lq">Ou n’importe quel horaire (heure de Paris)<input type="datetime-local" value={custom} onChange={(e) => { setCustom(e.target.value); setPick('') }} /></label>
      {closers.length > 1 && <><div className="lq">Qui prend l’appel ?</div>
        <div className="chips">{closers.map((c) => <button type="button" key={c.key} className={`chip ${closer === c.key ? 'sel' : ''}`} onClick={() => setCloser(c.key)}>{c.name}</button>)}</div></>}
      <div className="acts"><button className="btn" disabled={busy || !iso} onClick={go}>{busy ? 'Ajout…' : 'Placer l’appel'}</button><button type="button" className="btn ghost" onClick={onClose}>Annuler</button></div>
    </>}
  </div></div></Portal>
}
