import { useEffect, useMemo, useState } from 'react'
import { supabase, friendlyError } from './supabase'

const TZ = 'Europe/Paris'
const DOW = [[1, 'Lundi'], [2, 'Mardi'], [3, 'Mercredi'], [4, 'Jeudi'], [5, 'Vendredi'], [6, 'Samedi'], [0, 'Dimanche']]
const DNAME = { 0: 'dimanche', 1: 'lundi', 2: 'mardi', 3: 'mercredi', 4: 'jeudi', 5: 'vendredi', 6: 'samedi' }
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']
const hm = (t) => String(t || '').slice(0, 5)
const pad = (n) => String(n).padStart(2, '0')
const key = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`
const parisKey = (iso) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map(x => [x.type, x.value])); return [`${p.year}-${p.month}-${p.day}`, `${p.hour}:${p.minute}`] }
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
const fromMin = (n) => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`
const dowOf = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay() }
const addDays = (k, n) => { const [y, m, d] = k.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return key(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) }
const longDay = (k) => { const [y, m, d] = k.split('-').map(Number); const s = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }); return s.charAt(0).toUpperCase() + s.slice(1) }

/** Disponibilités : calendrier du mois. Toucher une date = voir ses créneaux, la fermer, ou changer les horaires de ce jour de la semaine. */
export default function Dispos({ toast }) {
  const todayK = parisKey(new Date().toISOString())[0]
  const [ty, tm] = todayK.split('-').map(Number)
  const [ym, setYm] = useState({ y: ty, m: tm - 1 })
  const [sel, setSel] = useState(todayK)
  const [week, setWeek] = useState(null); const [cfg, setCfg] = useState(null); const [blocked, setBlocked] = useState([])
  const [free, setFree] = useState(new Set()); const [taken, setTaken] = useState(new Set())
  const [edit, setEdit] = useState(false)

  const load = async () => {
    const [h, s, b, sl, cd] = await Promise.all([
      supabase.from('cand_hours').select('*').order('start_time'), supabase.from('cand_settings').select('*').eq('id', 1).single(),
      supabase.from('cand_blocked').select('day').order('day'), supabase.rpc('cand_slots'),
      supabase.from('candidatures').select('starts_at,status').in('status', ['reserve', 'confirme']).gte('starts_at', new Date(Date.now() - 864e5).toISOString())])
    const w = {}; DOW.forEach(([d]) => { w[d] = [] }); (h.data || []).forEach(r => w[r.weekday].push([hm(r.start_time), hm(r.end_time)]))
    setWeek(w); setCfg(s.data); setBlocked((b.data || []).map(x => x.day))
    setFree(new Set((sl.data || []).map(i => parisKey(i).join('|')))); setTaken(new Set((cd.data || []).map(c => parisKey(c.starts_at).join('|'))))
  }
  useEffect(() => { load() }, [])

  const slotsFor = (k) => {
    if (!week || !cfg) return []
    const out = []; const dur = +cfg.slot_min, step = +cfg.step_min
    for (const [a, b] of week[dowOf(k)] || []) for (let t = toMin(a); t + dur <= toMin(b); t += step) out.push(fromMin(t))
    return out
  }
  const horizonK = cfg ? addDays(todayK, +cfg.horizon_days) : todayK
  const cells = useMemo(() => {
    if (!week || !cfg) return []
    const first = key(ym.y, ym.m, 1); const lead = (dowOf(first) + 6) % 7; const start = addDays(first, -lead)
    return Array.from({ length: 42 }, (_, i) => {
      const k = addDays(start, i); const inMonth = +k.slice(5, 7) - 1 === ym.m
      const n = slotsFor(k).length; const isBlocked = blocked.includes(k)
      let st = 'open'
      if (k < todayK) st = 'past'; else if (isBlocked) st = 'closed'; else if (!n) st = 'off'; else if (k > horizonK) st = 'far'
      const nFree = st === 'open' ? slotsFor(k).filter(t => free.has(k + '|' + t)).length : 0
      return { k, d: +k.slice(8), inMonth, st, n: nFree }
    })
  }, [week, cfg, blocked, free, ym])

  const saveWeek = async () => {
    for (const rs of Object.values(week)) for (const r of rs) if (!r[0] || !r[1] || r[0] >= r[1]) return toast('Vérifie les horaires : le début doit précéder la fin', true)
    const { error: e1 } = await supabase.from('cand_hours').delete().gte('id', 0); if (e1) return toast(friendlyError(e1), true)
    const ins = Object.entries(week).flatMap(([d, rs]) => rs.map(r => ({ weekday: +d, start_time: r[0], end_time: r[1] })))
    if (ins.length) { const { error } = await supabase.from('cand_hours').insert(ins); if (error) return toast(friendlyError(error), true) }
    toast('Horaires enregistrés'); setEdit(false); load()
  }
  const saveCfg = async () => {
    const { error } = await supabase.from('cand_settings').update({ slot_min: +cfg.slot_min, step_min: +cfg.step_min, notice_min: Math.round(+(cfg.notice_h ?? cfg.notice_min / 60) * 60), horizon_days: +cfg.horizon_days, release_hours: +cfg.release_hours }).eq('id', 1)
    if (error) return toast(friendlyError(error), true); toast('Réglages enregistrés'); load()
  }
  const toggleBlock = async () => {
    if (blocked.includes(sel)) await supabase.from('cand_blocked').delete().eq('day', sel)
    else { const { error } = await supabase.from('cand_blocked').upsert({ day: sel }); if (error) return toast(friendlyError(error), true) }
    load()
  }
  const setRange = (d, i, k, v) => setWeek(w => ({ ...w, [d]: w[d].map((r, j) => j === i ? (k ? [r[0], v] : [v, r[1]]) : r) }))
  const nav = (n) => setYm(({ y, m }) => { const t = new Date(Date.UTC(y, m + n, 1)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() } })

  if (!week || !cfg) return <div className="sheet-body"><p className="muted">Chargement…</p></div>
  const d = dowOf(sel); const sl = slotsFor(sel); const isBlocked = blocked.includes(sel); const past = sel < todayK
  const nFreeSel = sl.filter(t => free.has(sel + '|' + t)).length

  return <div className="sheet-body">
    <div className="mhead"><h2 className="sh">{MONTHS[ym.m]} {ym.y}</h2><div className="mnav"><button onClick={() => nav(-1)} aria-label="Mois précédent">‹</button><button onClick={() => nav(1)} aria-label="Mois suivant">›</button></div></div>
    <div className="mcal">
      {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((w, i) => <div key={i} className="mw">{w}</div>)}
      {cells.map(c => <button key={c.k} className={`mc ${c.st} ${c.inMonth ? '' : 'out'} ${c.k === sel ? 'sel' : ''} ${c.k === todayK ? 'today' : ''}`} onClick={() => { setSel(c.k); setEdit(false); if (!c.inMonth) setYm({ y: +c.k.slice(0, 4), m: +c.k.slice(5, 7) - 1 }) }}>
        <b>{c.d}</b><i>{c.st === 'open' ? c.n : c.st === 'closed' ? 'fermé' : c.st === 'far' ? '—' : ''}</i></button>)}
    </div>
    <div className="mleg"><span><u className="g" /> Ouvert (créneaux libres)</span><span><u className="r" /> Fermé</span><span><u className="x" /> Hors délai</span></div>

    <div className="daycard">
      <div className="dchead"><b>{longDay(sel)}</b><span>{past ? 'Passé' : isBlocked ? 'Fermé' : sl.length ? `${nFreeSel} libre${nFreeSel > 1 ? 's' : ''} sur ${sl.length}` : 'Aucun horaire'}</span></div>
      {!isBlocked && !past && sl.length > 0 && <div className="slotchips">{sl.map(t => { const k = sel + '|' + t; const st = free.has(k) ? 'ok' : taken.has(k) ? 'res' : 'off'; return <span key={t} className={`sc ${st}`}>{t}{st === 'res' ? ' · réservé' : ''}</span> })}</div>}
      {!isBlocked && !past && !sl.length && <p className="muted small" style={{ margin: '8px 0 0' }}>Pas d'horaire le {DNAME[d]}. Ajoute une plage ci-dessous.</p>}
      {isBlocked && <p className="muted small" style={{ margin: '8px 0 0' }}>Ce jour est fermé : personne ne peut réserver.</p>}
      <div className="dcbtns">
        <button className="btn ghost sm" onClick={() => setEdit(!edit)}>{edit ? 'Fermer l’éditeur' : `Horaires du ${DNAME[d]}`}</button>
        {!past && <button className={`btn sm ${isBlocked ? '' : 'danger'}`} onClick={toggleBlock}>{isBlocked ? 'Rouvrir ce jour' : 'Fermer ce jour'}</button>}
      </div>
      {edit && <div className="editor">
        <p className="muted small" style={{ margin: '0 0 6px' }}>Ces horaires valent pour <b>tous les {DNAME[d]}s</b>. Pour une seule date, utilise « Fermer ce jour ».</p>
        {week[d].map((r, i) => <div key={i} className="hrange" style={{ marginLeft: 0 }}>
          <input type="time" value={r[0]} onChange={e => setRange(d, i, 0, e.target.value)} /><span>–</span><input type="time" value={r[1]} onChange={e => setRange(d, i, 1, e.target.value)} />
          <button type="button" className="btn ghost sm" aria-label="Supprimer la plage" onClick={() => setWeek(w => ({ ...w, [d]: w[d].filter((_, j) => j !== i) }))}>✕</button></div>)}
        {week[d].length < 4 && <button type="button" className="linkbtn" style={{ paddingLeft: 0 }} onClick={() => setWeek(w => ({ ...w, [d]: [...w[d], [w[d].length ? '17:00' : '10:00', w[d].length ? '18:00' : '11:00']] }))}>+ Ajouter une plage</button>}
        <button className="btn big" onClick={saveWeek}>Enregistrer les horaires du {DNAME[d]}</button>
      </div>}
    </div>

    <details className="settings"><summary>Réglages des appels</summary>
      <div className="grid2">
        <div><label className="lq">Durée de l'appel (min)</label><input type="number" min="15" max="120" value={cfg.slot_min} onChange={e => setCfg({ ...cfg, slot_min: e.target.value })} /></div>
        <div><label className="lq">Un créneau toutes les (min)</label><input type="number" min="5" max="120" value={cfg.step_min} onChange={e => setCfg({ ...cfg, step_min: e.target.value })} /></div>
        <div><label className="lq">Délai minimum (heures)</label><input type="number" min="0" max="72" value={cfg.notice_h ?? Math.round(cfg.notice_min / 60)} onChange={e => setCfg({ ...cfg, notice_h: e.target.value })} /></div>
        <div><label className="lq">Réservable sur (jours)</label><input type="number" min="1" max="60" value={cfg.horizon_days} onChange={e => setCfg({ ...cfg, horizon_days: e.target.value })} /></div>
        <div><label className="lq">Libérer sans message après (h)</label><input type="number" min="1" max="48" value={cfg.release_hours} onChange={e => setCfg({ ...cfg, release_hours: e.target.value })} /></div>
      </div>
      <button className="btn big" onClick={saveCfg}>Enregistrer les réglages</button>
    </details>
  </div>
}
