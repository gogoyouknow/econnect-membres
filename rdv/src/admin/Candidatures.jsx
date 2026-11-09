import { useEffect, useState } from 'react'
import { supabase, friendlyError } from './supabase'

const WD = [[1, 'Lundi'], [2, 'Mardi'], [3, 'Mercredi'], [4, 'Jeudi'], [5, 'Vendredi'], [6, 'Samedi'], [0, 'Dimanche']]
const ST = { reserve: ['À confirmer', 'wait'], confirme: ['Confirmé', 'ok'], fait: ['Fait', 'done'], absent: ['Absent', 'done'], annule: ['Annulé', 'done'] }
const CAPL = { '500-1000': '500–1 000 €', '1000-3000': '1 000–3 000 €', gt3000: '+ 3 000 €' }
const TZ = 'Europe/Paris'
const hm = (t) => String(t || '').slice(0, 5)
const timeOf = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
const dayKey = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso))
const dayLabel = (iso) => {
  const k = dayKey(iso), today = dayKey(new Date().toISOString()), tom = dayKey(new Date(Date.now() + 864e5).toISOString())
  if (k === today) return "Aujourd'hui"
  if (k === tom) return 'Demain'
  const s = new Date(iso).toLocaleDateString('fr-FR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
const wa = (p) => { const d = String(p || '').replace(/[^\d]/g, ''); return d ? 'https://wa.me/' + d : '' }
const countdown = (iso) => {
  const m = Math.round((new Date(iso).getTime() - Date.now()) / 60000)
  if (m <= 0) return 'maintenant'
  if (m < 60) return `dans ${m} min`
  const h = Math.floor(m / 60), r = m % 60
  if (h < 24) return `dans ${h} h${r ? ' ' + String(r).padStart(2, '0') : ''}`
  const d = Math.floor(h / 24); return `dans ${d} jour${d > 1 ? 's' : ''}`
}

/** Mes appels : accueil (prochain appel + liste) et disponibilités. `tab` = 'appels' | 'dispos'. */
export default function Candidatures({ toast, tab: main }) {
  const [rows, setRows] = useState([]); const [tab, setTab] = useState('avenir'); const [open, setOpen] = useState(null)
  const [week, setWeek] = useState(null); const [cfg, setCfg] = useState(null); const [blocked, setBlocked] = useState([])
  const load = () => supabase.from('candidatures').select('*').order('starts_at', { ascending: true }).limit(500).then(({ data }) => setRows(data || []))
  const loadCfg = async () => {
    const [h, s, b] = await Promise.all([supabase.from('cand_hours').select('*').order('start_time'), supabase.from('cand_settings').select('*').eq('id', 1).single(), supabase.from('cand_blocked').select('day').order('day')])
    const w = {}; WD.forEach(([d]) => { w[d] = [] }); (h.data || []).forEach(r => w[r.weekday].push([hm(r.start_time), hm(r.end_time)]))
    setWeek(w); setCfg(s.data); setBlocked((b.data || []).map(x => x.day))
  }
  useEffect(() => { load(); loadCfg(); const i = setInterval(load, 60000); return () => clearInterval(i) }, [])
  const upd = async (c, patch) => { const { error } = await supabase.from('candidatures').update(patch).eq('id', c.id); if (error) return toast(friendlyError(error), true); load() }

  const now = Date.now()
  const live = (c) => ['reserve', 'confirme'].includes(c.status)
  const upcoming = rows.filter(c => live(c) && new Date(c.starts_at).getTime() > now - 3600000).sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  const next = upcoming.find(c => new Date(c.starts_at).getTime() > now - 15 * 60000)
  const nToConfirm = rows.filter(c => c.status === 'reserve').length
  const nWeek = upcoming.filter(c => new Date(c.starts_at).getTime() < now + 7 * 864e5).length
  const nDone = rows.filter(c => c.status === 'fait').length
  const list = tab === 'avenir' ? upcoming
    : tab === 'passes' ? rows.filter(c => (live(c) && new Date(c.starts_at).getTime() <= now - 3600000) || ['fait', 'absent'].includes(c.status)).sort((a, b) => b.starts_at.localeCompare(a.starts_at))
    : rows.filter(c => c.status === 'annule').sort((a, b) => b.starts_at.localeCompare(a.starts_at))
  const groups = []; list.forEach(c => { const k = dayKey(c.starts_at); let g = groups.find(x => x.k === k); if (!g) { g = { k, label: dayLabel(c.starts_at), items: [] }; groups.push(g) } g.items.push(c) })

  const setRange = (d, i, k, v) => setWeek(w => ({ ...w, [d]: w[d].map((r, j) => j === i ? (k ? [r[0], v] : [v, r[1]]) : r) }))
  const saveHours = async () => {
    for (const [, rs] of Object.entries(week)) for (const r of rs) if (!r[0] || !r[1] || r[0] >= r[1]) return toast('Vérifie les horaires : le début doit précéder la fin', true)
    const { error: e1 } = await supabase.from('cand_hours').delete().gte('id', 0); if (e1) return toast(friendlyError(e1), true)
    const ins = Object.entries(week).flatMap(([d, rs]) => rs.map(r => ({ weekday: +d, start_time: r[0], end_time: r[1] })))
    if (ins.length) { const { error } = await supabase.from('cand_hours').insert(ins); if (error) return toast(friendlyError(error), true) }
    const { error: e3 } = await supabase.from('cand_settings').update({ slot_min: +cfg.slot_min, step_min: +cfg.step_min, notice_min: Math.round(+(cfg.notice_h ?? cfg.notice_min / 60) * 60), horizon_days: +cfg.horizon_days, release_hours: +cfg.release_hours }).eq('id', 1)
    if (e3) return toast(friendlyError(e3), true)
    toast('Disponibilités enregistrées'); loadCfg()
  }
  const addBlock = async (e) => { e.preventDefault(); const v = e.target.day.value; if (!v) return; const { error } = await supabase.from('cand_blocked').upsert({ day: v }); if (error) return toast(friendlyError(error), true); e.target.reset(); loadCfg() }
  const unblock = async (d) => { await supabase.from('cand_blocked').delete().eq('day', d); loadCfg() }

  if (main === 'dispos') return <div className="sheet-body">
    <h2 className="sh">Mes disponibilités</h2>
    <p className="muted">Heure de Paris. Ce que tu règles ici est exactement ce que les candidats voient.</p>
    {week && cfg ? <>
      <div className="hours">{WD.map(([d, name]) => <div key={d} className="hday">
        <label className="hname"><input type="checkbox" checked={week[d].length > 0} onChange={e => setWeek(w => ({ ...w, [d]: e.target.checked ? [['10:00', '11:00']] : [] }))} /> {name}</label>
        {week[d].map((r, i) => <div key={i} className="hrange">
          <input type="time" value={r[0]} onChange={e => setRange(d, i, 0, e.target.value)} /><span>–</span><input type="time" value={r[1]} onChange={e => setRange(d, i, 1, e.target.value)} />
          <button type="button" className="btn ghost sm" aria-label="Supprimer la plage" onClick={() => setWeek(w => ({ ...w, [d]: w[d].filter((_, j) => j !== i) }))}>✕</button></div>)}
        {week[d].length > 0 && week[d].length < 4 && <button type="button" className="linkbtn" onClick={() => setWeek(w => ({ ...w, [d]: [...w[d], ['17:00', '18:00']] }))}>+ Ajouter une plage</button>}
      </div>)}</div>
      <div className="grid2">
        <div><label className="lq">Durée de l'appel (min)</label><input type="number" min="15" max="120" value={cfg.slot_min} onChange={e => setCfg({ ...cfg, slot_min: e.target.value })} /></div>
        <div><label className="lq">Un créneau toutes les (min)</label><input type="number" min="5" max="120" value={cfg.step_min} onChange={e => setCfg({ ...cfg, step_min: e.target.value })} /></div>
        <div><label className="lq">Délai minimum (heures)</label><input type="number" min="0" max="72" value={cfg.notice_h ?? Math.round(cfg.notice_min / 60)} onChange={e => setCfg({ ...cfg, notice_h: e.target.value })} /></div>
        <div><label className="lq">Réservable sur (jours)</label><input type="number" min="1" max="60" value={cfg.horizon_days} onChange={e => setCfg({ ...cfg, horizon_days: e.target.value })} /></div>
        <div><label className="lq">Libérer sans message après (h)</label><input type="number" min="1" max="48" value={cfg.release_hours} onChange={e => setCfg({ ...cfg, release_hours: e.target.value })} /></div>
      </div>
      <button className="btn big" onClick={saveHours}>Enregistrer mes disponibilités</button>
      <label className="lq" style={{ marginTop: 18 }}>Bloquer un jour (congé, déplacement)</label>
      <form onSubmit={addBlock} className="blockform"><input name="day" type="date" /><button className="btn ghost sm">Bloquer</button></form>
      <div className="chips">{blocked.map(d => <button key={d} className="chip" onClick={() => unblock(d)}>{d.split('-').reverse().join('/')} ✕</button>)}</div>
    </> : <p className="muted">Chargement…</p>}
  </div>

  return <>
    <div className="top-hero">
      <div className="hero">
        {next ? <>
          <div className="hk">Prochain appel · {countdown(next.starts_at)}</div>
          <div className="hrow">
            <div className="htime">{timeOf(next.starts_at)}</div>
            <div className="hwho"><b>{next.first_name}</b><small>{[next.situation, CAPL[next.capital] || next.capital].filter(Boolean).join(' · ')}</small></div>
            <a className="wabtn" href={wa(next.phone)} target="_blank" rel="noreferrer">WhatsApp</a>
          </div>
        </> : <><div className="hk">Aucun appel à venir</div><div className="hempty">Dès qu'une personne réserve depuis ta bio, elle apparaît ici.</div></>}
      </div>
      <div className="stats"><span><b className="y">{nToConfirm}</b> à confirmer</span><span><b>{nWeek}</b> cette semaine</span><span><b className="g">{nDone}</b> faits</span></div>
    </div>
    <div className="sheet-body">
      <div className="pills">{[['avenir', 'À venir'], ['passes', 'Passés'], ['annules', 'Annulés']].map(([k, l]) => <button key={k} className={`pill ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      {!groups.length && <div className="sys">Aucun appel ici pour l'instant</div>}
      {groups.map(g => <div key={g.k} className="dgroup"><div className="dlabel">{g.label}</div>
        {g.items.map(c => <div key={c.id} className={`call ${open === c.id ? 'open' : ''}`}>
          <div className="crow" onClick={() => setOpen(open === c.id ? null : c.id)}>
            <div className="ctime">{timeOf(c.starts_at)}</div>
            <div className="cmain"><b>{c.first_name}</b><small>{[c.situation, CAPL[c.capital] || c.capital].filter(Boolean).join(' · ')}</small></div>
            <span className={`badge ${ST[c.status][1]}`}>{ST[c.status][0]}</span>
          </div>
          {open === c.id && <div className="cdet">
            <div className="drow"><label>WhatsApp</label><a href={wa(c.phone)} target="_blank" rel="noreferrer">{c.phone}</a></div>
            <div className="drow"><label>Email</label><a href={`mailto:${c.email}`}>{c.email}</a></div>
            <div className="drow"><label>Budget</label><span>{CAPL[c.capital] || c.capital} · confirmé disponible</span></div>
            <div className="drow"><label>Réservé le</label><span>{new Date(c.created_at).toLocaleString('fr-FR', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
            <div className="acts">
              {c.status === 'reserve' && <button className="btn sm" onClick={() => upd(c, { status: 'confirme' })}>✓ Message WhatsApp reçu</button>}
              {live(c) && <>
                <button className="btn ghost sm" onClick={() => upd(c, { status: 'fait' })}>Appel fait</button>
                <button className="btn ghost sm" onClick={() => upd(c, { status: 'absent' })}>Absent</button>
                <button className="btn ghost sm" onClick={() => confirm('Annuler et libérer ce créneau ?') && upd(c, { status: 'annule' })}>Annuler</button></>}
              {c.status === 'annule' && <button className="btn ghost sm" onClick={() => upd(c, { status: 'reserve' })}>Rétablir</button>}
            </div>
            <textarea rows={2} defaultValue={c.note} placeholder="Note (objection, suite à donner…)" onBlur={e => e.target.value !== c.note && upd(c, { note: e.target.value })} />
          </div>}
        </div>)}
      </div>)}
      <p className="muted small">Sans message WhatsApp reçu dans le délai réglé, le créneau est libéré automatiquement.</p>
    </div>
  </>
}
