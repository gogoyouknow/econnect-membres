import { useEffect, useState } from 'react'
import { supabase, friendlyError } from './supabase'

const WD = [[1, 'Lundi'], [2, 'Mardi'], [3, 'Mercredi'], [4, 'Jeudi'], [5, 'Vendredi'], [6, 'Samedi'], [0, 'Dimanche']]
const ST = { reserve: ['En attente WhatsApp', ''], confirme: ['Confirmé', 'gold'], fait: ['Fait', ''], absent: ['Absent', ''], annule: ['Annulé', ''] }
const CAPL = { '500-1000': '500 – 1 000 €', '1000-3000': '1 000 – 3 000 €', gt3000: '+ 3 000 €' }
const fmt = (iso) => new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const wa = (p) => { const d = String(p || '').replace(/[^\d]/g, ''); return d ? 'https://wa.me/' + d : '' }
const hm = (t) => String(t || '').slice(0, 5)

/** Candidatures TikTok : appels réservés depuis la page en bio (rdv.theambitiousman.fr), séparés de la Méthode 97 €. */
export default function Candidatures({ toast }) {
  const [rows, setRows] = useState([]); const [tab, setTab] = useState('avenir'); const [open, setOpen] = useState(null)
  const [week, setWeek] = useState(null); const [cfg, setCfg] = useState(null); const [blocked, setBlocked] = useState([]); const [edit, setEdit] = useState(false)
  const load = () => supabase.from('candidatures').select('*').order('starts_at', { ascending: true }).limit(500).then(({ data }) => setRows(data || []))
  const loadCfg = async () => {
    const [h, s, b] = await Promise.all([supabase.from('cand_hours').select('*').order('start_time'), supabase.from('cand_settings').select('*').eq('id', 1).single(), supabase.from('cand_blocked').select('day').order('day')])
    const w = {}; WD.forEach(([d]) => { w[d] = [] }); (h.data || []).forEach(r => w[r.weekday].push([hm(r.start_time), hm(r.end_time)]))
    setWeek(w); setCfg(s.data); setBlocked((b.data || []).map(x => x.day))
  }
  useEffect(() => { load(); loadCfg() }, [])
  const upd = async (c, patch) => { const { error } = await supabase.from('candidatures').update(patch).eq('id', c.id); if (error) return toast(friendlyError(error), true); load() }
  const now = Date.now()
  const live = (c) => ['reserve', 'confirme'].includes(c.status)
  const list = rows.filter(c => tab === 'avenir' ? live(c) && new Date(c.starts_at).getTime() > now - 3600000 : tab === 'passes' ? (live(c) && new Date(c.starts_at).getTime() <= now - 3600000) || ['fait', 'absent'].includes(c.status) : c.status === 'annule')
    .sort((a, b) => tab === 'avenir' ? a.starts_at.localeCompare(b.starts_at) : b.starts_at.localeCompare(a.starts_at))
  const pending = rows.filter(c => c.status === 'reserve').length

  const setRange = (d, i, k, v) => setWeek(w => ({ ...w, [d]: w[d].map((r, j) => j === i ? (k ? [r[0], v] : [v, r[1]]) : r) }))
  const saveHours = async () => {
    for (const [d, rs] of Object.entries(week)) for (const r of rs) if (!r[0] || !r[1] || r[0] >= r[1]) return toast('Vérifie les horaires : le début doit précéder la fin', true)
    const { error: e1 } = await supabase.from('cand_hours').delete().gte('id', 0); if (e1) return toast(friendlyError(e1), true)
    const ins = Object.entries(week).flatMap(([d, rs]) => rs.map(r => ({ weekday: +d, start_time: r[0], end_time: r[1] })))
    if (ins.length) { const { error } = await supabase.from('cand_hours').insert(ins); if (error) return toast(friendlyError(error), true) }
    const { error: e3 } = await supabase.from('cand_settings').update({ slot_min: +cfg.slot_min, step_min: +cfg.step_min, notice_min: Math.round(+(cfg.notice_h ?? cfg.notice_min / 60) * 60), horizon_days: +cfg.horizon_days, release_hours: +cfg.release_hours }).eq('id', 1)
    if (e3) return toast(friendlyError(e3), true)
    toast('Disponibilités enregistrées'); loadCfg()
  }
  const addBlock = async (e) => { e.preventDefault(); const v = e.target.day.value; if (!v) return; const { error } = await supabase.from('cand_blocked').upsert({ day: v }); if (error) return toast(friendlyError(error), true); e.target.reset(); loadCfg() }
  const unblock = async (d) => { await supabase.from('cand_blocked').delete().eq('day', d); loadCfg() }

  return <>
    <div className="head"><div style={{ flex: 1 }}><h2>Mes appels</h2><small>Réservés depuis ta bio · {pending} en attente de message WhatsApp</small></div>
      <button className="btn ghost sm" onClick={() => setEdit(e => !e)}>{edit ? 'Voir les appels' : 'Mes disponibilités'}</button></div>
    <div className="body">
      {!edit && <>
        <div className="chips">{[['avenir', 'À venir'], ['passes', 'Passés'], ['annules', 'Annulés']].map(([k, l]) => <button key={k} className={`chip ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
        {!list.length && <div className="sys">Aucun appel ici pour l'instant</div>}
        {list.map(c => <div key={c.id} className={`post lead ${c.status === 'confirme' ? 'hot' : ''}`}>
          <div className="leadtop" onClick={() => setOpen(open === c.id ? null : c.id)}>
            <div style={{ flex: 1, minWidth: 0 }}><b>{c.first_name}</b><small className="muted" style={{ display: 'block' }}>{fmt(c.starts_at)} · {c.minutes} min</small></div>
            <span className={`pill ${ST[c.status][1]}`}>{ST[c.status][0]}</span>
          </div>
          {open === c.id && <div className="leaddet">
            <div className="row"><label>WhatsApp</label><a className="btn sm" href={wa(c.phone)} target="_blank" rel="noreferrer">💬 {c.phone}</a></div>
            <div className="row"><label>Email</label><a href={`mailto:${c.email}`}>{c.email}</a></div>
            <div className="row"><label>Situation</label><span>{c.situation || '—'}</span></div>
            <div className="row"><label>Budget annoncé</label><span>{CAPL[c.capital] || c.capital} · confirmé dispo</span></div>
            <div className="row"><label>Réservé</label><span>{new Date(c.created_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
            <div className="bkact" style={{ flexWrap: 'wrap' }}>
              {c.status === 'reserve' && <button className="btn sm" onClick={() => upd(c, { status: 'confirme' })}>✓ Message WhatsApp reçu</button>}
              {['reserve', 'confirme'].includes(c.status) && <>
                <button className="btn ghost sm" onClick={() => upd(c, { status: 'fait' })}>Appel fait</button>
                <button className="btn ghost sm" onClick={() => upd(c, { status: 'absent' })}>Absent</button>
                <button className="btn ghost sm" onClick={() => confirm('Annuler et libérer ce créneau ?') && upd(c, { status: 'annule' })}>Annuler / libérer</button></>}
              {c.status === 'annule' && <button className="btn ghost sm" onClick={() => upd(c, { status: 'reserve' })}>Rétablir</button>}
            </div>
            <textarea rows={2} defaultValue={c.note} placeholder="Note (objection, suite à donner…)" onBlur={e => e.target.value !== c.note && upd(c, { note: e.target.value })} />
          </div>}
        </div>)}
        <small className="muted">Sans message WhatsApp reçu dans le délai réglé, le créneau est libéré automatiquement. Les événements de ton Google Agenda bloquent déjà les créneaux (réglage dans L'Accélérateur → Prospects → Mon Google Agenda).</small>
      </>}
      {edit && week && cfg && <div className="post">
        <b>Mes disponibilités</b>
        <small className="muted" style={{ display: 'block', marginBottom: 8 }}>Heure de Paris. Ce que tu règles ici est exactement ce que les candidats voient.</small>
        <div className="hours">{WD.map(([d, name]) => <div key={d} style={{ display: 'block', borderTop: '1px solid var(--line)', padding: '8px 0' }}>
          <label><input type="checkbox" checked={week[d].length > 0} onChange={e => setWeek(w => ({ ...w, [d]: e.target.checked ? [['10:00', '11:00']] : [] }))} /> {name}</label>
          {week[d].map((r, i) => <div key={i} style={{ display: 'flex', gap: 6, margin: '6px 0 0 24px', alignItems: 'center' }}>
            <input type="time" value={r[0]} onChange={e => setRange(d, i, 0, e.target.value)} /> – <input type="time" value={r[1]} onChange={e => setRange(d, i, 1, e.target.value)} />
            <button type="button" className="btn ghost sm" aria-label="Supprimer la plage" onClick={() => setWeek(w => ({ ...w, [d]: w[d].filter((_, j) => j !== i) }))}>✕</button></div>)}
          {week[d].length > 0 && week[d].length < 4 && <button type="button" className="linkbtn" style={{ marginLeft: 24 }} onClick={() => setWeek(w => ({ ...w, [d]: [...w[d], ['17:00', '18:00']] }))}>+ Ajouter une plage</button>}
        </div>)}</div>
        <div className="grid2" style={{ marginTop: 10 }}>
          <div><label className="lq">Durée de l'appel (min)</label><input type="number" min="15" max="120" value={cfg.slot_min} onChange={e => setCfg({ ...cfg, slot_min: e.target.value })} /></div>
          <div><label className="lq">Un créneau toutes les (min)</label><input type="number" min="5" max="120" value={cfg.step_min} onChange={e => setCfg({ ...cfg, step_min: e.target.value })} /></div>
          <div><label className="lq">Délai minimum (heures)</label><input type="number" min="0" max="72" value={cfg.notice_h ?? Math.round(cfg.notice_min / 60)} onChange={e => setCfg({ ...cfg, notice_h: e.target.value })} /></div>
          <div><label className="lq">Réservable sur (jours)</label><input type="number" min="1" max="60" value={cfg.horizon_days} onChange={e => setCfg({ ...cfg, horizon_days: e.target.value })} /></div>
          <div><label className="lq">Libérer sans message après (h)</label><input type="number" min="1" max="48" value={cfg.release_hours} onChange={e => setCfg({ ...cfg, release_hours: e.target.value })} /></div>
        </div>
        <button className="btn big" style={{ marginTop: 12 }} onClick={saveHours}>Enregistrer mes disponibilités</button>
        <label className="lq">Bloquer un jour (congé, déplacement)</label>
        <form onSubmit={addBlock} style={{ display: 'flex', gap: 6 }}><input name="day" type="date" style={{ flex: 1 }} /><button className="btn ghost sm">Bloquer</button></form>
        <div className="chips" style={{ marginTop: 8 }}>{blocked.map(d => <button key={d} className="chip" onClick={() => unblock(d)}>{d.split('-').reverse().join('/')} ✕</button>)}</div>
      </div>}
    </div>
  </>
}
