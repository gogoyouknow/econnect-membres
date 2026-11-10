import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

const STAGE = { rdv: 'Appel prévu', qualifie: 'Qualifié', potentiel: 'Potentiel', incomplet: 'Incomplet', disqualifie: 'Pas prêt', fait: 'Appel fait', absent: 'Absent', annule: 'Annulé' }
const full = (r) => [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Sans nom'

/** Barre de recherche dans l'en-tête : trouve un prospect par nom, numéro ou email, et ouvre sa fiche. */
export default function Search({ onPick }) {
  const [q, setQ] = useState(''); const [res, setRes] = useState(null); const [open, setOpen] = useState(false)
  const box = useRef(null); const inp = useRef(null)
  useEffect(() => {
    const s = q.trim().replace(/[%,()*\\]/g, ' ').trim()
    if (s.length < 2) { setRes(null); return }
    let dead = false
    const t = setTimeout(async () => {
      const d = s.replace(/\D/g, '')
      const f = [`first_name.ilike.%${s}%`, `last_name.ilike.%${s}%`, `email.ilike.%${s}%`, `email_raw.ilike.%${s}%`]
      if (d.length >= 3) f.push(`phone.ilike.%${d}%`, `phone_raw.ilike.%${d}%`)
      const { data } = await supabase.from('prospects_v').select('id,first_name,last_name,phone,phone_raw,email,email_raw,stage').or(f.join(',')).order('updated_at', { ascending: false }).limit(8)
      if (!dead) setRes(data || [])
    }, 220)
    return () => { dead = true; clearTimeout(t) }
  }, [q])
  useEffect(() => {
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    const key = (e) => { if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) { e.preventDefault(); inp.current?.focus() } if (e.key === 'Escape') { setOpen(false); inp.current?.blur() } }
    document.addEventListener('mousedown', away); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key) }
  }, [])
  const pick = (r) => { setQ(''); setRes(null); setOpen(false); onPick(r.id) }
  return <div className="gs" ref={box}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
    <input ref={inp} type="search" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} placeholder="Chercher un prospect : nom, numéro, email…" aria-label="Chercher un prospect" autoComplete="off" />
    {open && q.trim().length >= 2 && <div className="gs-res">
      {res === null && <div className="gs-none">Recherche…</div>}
      {res && !res.length && <div className="gs-none">Aucun prospect trouvé</div>}
      {res && res.map((r) => <button key={r.id} onClick={() => pick(r)}><span><b>{full(r)}</b><small>{r.phone || r.phone_raw || r.email || r.email_raw || 'Pas de coordonnées'}</small></span><i className={`prb st-${r.stage}`}>{STAGE[r.stage]}</i></button>)}
    </div>}
  </div>
}
