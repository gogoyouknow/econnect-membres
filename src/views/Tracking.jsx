import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/data'
import { Avatar, ago, fmtDay, TIER_LABEL } from '../lib/ui'
import { loadSteps, loadMemberSteps, progressOf } from './Journey'

/** Côté coach : où en est chaque élève, prochaine action, validation, notes */
export default function Tracking({ me, profiles, isAdmin, toast }) {
  const [steps, setSteps] = useState([])
  const [all, setAll] = useState([])          // member_steps de tout le monde
  const [filter, setFilter] = useState('all')
  const [open, setOpen] = useState(null)      // user id ouvert
  const [notes, setNotes] = useState([])
  const [note, setNote] = useState('')
  const [edit, setEdit] = useState(false)

  const reload = async () => { const [s, m] = await Promise.all([loadSteps(), loadMemberSteps()]); setSteps(s); setAll(m) }
  useEffect(() => { reload()
    const ch = supabase.channel('tracking').on('postgres_changes', { event: '*', schema: 'public', table: 'member_steps' }, reload).on('postgres_changes', { event: '*', schema: 'public', table: 'steps' }, reload).subscribe()
    return () => supabase.removeChannel(ch) }, [])
  useEffect(() => { if (!open) return; supabase.from('coach_notes').select('*').eq('user_id', open).order('created_at', { ascending: false }).then(({ data }) => setNotes(data || [])) }, [open])

  const byUser = useMemo(() => { const m = {}; all.forEach(x => { (m[x.user_id] ||= {})[x.step_id] = x }); return m }, [all])
  const members = profiles.list.filter(p => p.role === 'member' && p.active)
  const rows = members.map(p => { const mine = byUser[p.id] || {}; const prog = progressOf(steps, mine)
    const pending = steps.find(s => mine[s.id]?.status === 'pending')
    const idle = p.last_seen ? (Date.now() - new Date(p.last_seen)) / 86400000 : 99
    return { p, mine, prog, pending, idle } })
  const filtered = rows.filter(r => filter === 'all' ? true : filter === 'blocked' ? r.idle >= 7 : filter === 'pending' ? !!r.pending : r.prog.current?.id === +filter)
    .sort((a, b) => (b.pending ? 1 : 0) - (a.pending ? 1 : 0) || b.idle - a.idle)

  const kpi = {
    total: members.length,
    shop: rows.filter(r => steps[0] && r.mine[steps[0].id]?.status === 'done').length,
    product: rows.filter(r => steps[2] && r.mine[steps[2].id]?.status === 'done').length,
    blocked: rows.filter(r => r.idle >= 7).length,
    pending: rows.filter(r => r.pending).length,
  }

  async function setStatus(userId, step, status) {
    const { error } = await supabase.from('member_steps').upsert({ user_id: userId, step_id: step.id, status })
    if (error) return toast(friendlyError(error), true)
    toast(status === 'done' ? `« ${step.title} » validée` : status === 'todo' ? 'Étape rouverte' : 'Mise en attente')
  }
  async function addNote() {
    if (!note.trim()) return
    const { error } = await supabase.from('coach_notes').insert({ user_id: open, author: me.id, body: note.trim() })
    if (error) return toast(friendlyError(error), true)
    setNote(''); const { data } = await supabase.from('coach_notes').select('*').eq('user_id', open).order('created_at', { ascending: false }); setNotes(data || [])
  }
  async function saveStep(s, patch) { const { error } = await supabase.from('steps').update(patch).eq('id', s.id); if (error) toast(friendlyError(error), true) }
  async function addStep() { const { error } = await supabase.from('steps').insert({ position: steps.length + 1, title: 'Nouvelle étape', description: '', lessons: '' }); if (error) toast(friendlyError(error), true) }
  async function delStep(s) { if (!confirm(`Supprimer l'étape « ${s.title} » ? Les validations liées seront perdues.`)) return; const { error } = await supabase.from('steps').delete().eq('id', s.id); if (error) toast(friendlyError(error), true) }
  const nextAction = (r) => { if (r.pending) return { t: `Toi : valider « ${r.pending.title} »`, s: 'Il/elle attend ton retour', hot: true }
    if (!r.prog.current) return { t: 'Parcours terminé', s: 'Candidat Accélération ⭐' }
    return { t: r.prog.current.title, s: r.prog.current.lessons || '' } }

  const openRow = rows.find(r => r.p.id === open)

  return <>
    <div className="head"><div style={{ flex: 1 }}><h2>Suivi des élèves</h2><small>{kpi.total} élèves actifs · {kpi.pending} en attente de validation</small></div>{isAdmin && <button className="btn ghost sm" onClick={() => setEdit(v => !v)}>{edit ? 'Fermer' : '⚙︎ Modifier les étapes'}</button>}</div>
    <div className="body">
      {edit && <div className="post"><b>Les étapes du parcours</b><small className="muted">Dans l'ordre. « Coach » = c'est toi qui valides ; « Élève » = il coche lui-même.</small>
        {steps.map(s => <div key={s.id} className="steprow">
          <input defaultValue={s.title} onBlur={e => e.target.value !== s.title && saveStep(s, { title: e.target.value })} />
          <select defaultValue={s.validated_by} onChange={e => saveStep(s, { validated_by: e.target.value })}><option value="coach">Validée par le coach</option><option value="member">Cochée par l'élève</option></select>
          <textarea defaultValue={s.description} rows={2} placeholder="Consigne pour l'élève" onBlur={e => e.target.value !== s.description && saveStep(s, { description: e.target.value })} />
          <input defaultValue={s.lessons} placeholder="Leçons à suivre (ex. Module 2, leçons 4 à 9)" onBlur={e => e.target.value !== s.lessons && saveStep(s, { lessons: e.target.value })} />
          <div className="acts2"><input type="number" defaultValue={s.position} style={{ width: 70 }} title="Ordre" onBlur={e => +e.target.value !== s.position && saveStep(s, { position: +e.target.value })} /><button className="btn ghost sm danger" onClick={() => delStep(s)}>Supprimer</button></div>
        </div>)}
        <button className="btn ghost sm" onClick={addStep}>+ Ajouter une étape</button>
      </div>}

      <div className="kpis">
        <div className="kpi"><small>Élèves actifs</small><b>{kpi.total}</b></div>
        <div className="kpi"><small>Boutique validée</small><b>{kpi.shop}</b><span>/ {kpi.total}</span></div>
        <div className="kpi"><small>Produit validé</small><b>{kpi.product}</b><span>/ {kpi.total}</span></div>
        <div className="kpi"><small>À valider</small><b className={kpi.pending ? 'gold' : ''}>{kpi.pending}</b></div>
        <div className="kpi"><small>Silencieux &gt; 7 j</small><b className={kpi.blocked ? 'red' : ''}>{kpi.blocked}</b></div>
      </div>
      <div className="chips">
        <button className={`chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>Tous</button>
        <button className={`chip ${filter === 'pending' ? 'on' : ''}`} onClick={() => setFilter('pending')}>À valider</button>
        {steps.map(s => <button key={s.id} className={`chip ${filter === String(s.id) ? 'on' : ''}`} onClick={() => setFilter(String(s.id))}>{s.position} · {s.title}</button>)}
        <button className={`chip ${filter === 'blocked' ? 'on' : ''}`} onClick={() => setFilter('blocked')}>Silencieux</button>
      </div>

      <div className="cards">
        {filtered.map(r => { const na = nextAction(r); return <div key={r.p.id} className={`post mcard trow ${r.pending ? 'hot' : ''}`} onClick={() => setOpen(open === r.p.id ? null : r.p.id)}>
          <div className="mem"><Avatar p={r.p} /><div style={{ minWidth: 0, flex: 1 }}><b>{r.p.name}</b><small>entré le {fmtDay(r.p.created_at)} · {TIER_LABEL[r.p.tier]}</small></div>
            <div className="steps">{steps.map(s => <i key={s.id} className={r.mine[s.id]?.status === 'done' ? 'd' : r.prog.current?.id === s.id ? 'c' : ''} />)}</div></div>
          <div className="meta"><span>{r.prog.current ? `Étape ${r.prog.current.position} · ${r.prog.current.title}` : 'Terminé'}</span><span>·</span><span className={r.idle >= 7 ? 'red' : ''}>{r.p.last_seen ? 'actif ' + ago(r.p.last_seen) : 'jamais connecté'}</span></div>
          <div className={`next ${na.hot ? 'hot' : ''}`}><b>{na.t}</b>{na.s && <small>{na.s}</small>}</div>

          {open === r.p.id && <div className="drawer" onClick={e => e.stopPropagation()}>
            {r.p.shop_url && <div className="row"><label>Boutique</label><a href={r.p.shop_url} target="_blank" rel="noreferrer">{r.p.shop_url.replace(/^https?:\/\//, '')}</a></div>}
            {steps.map(s => { const st = r.mine[s.id]?.status || 'todo'; return <div key={s.id} className="row"><label>{s.position} · {s.title}<small>{st === 'done' ? `Validée ${fmtDay(r.mine[s.id].done_at)}` : st === 'pending' ? 'En attente de ta validation' : 'À faire'}</small></label>
              <div className="acts2">{st !== 'done' && <button className="btn sm" onClick={() => setStatus(r.p.id, s, 'done')}>Valider</button>}{st === 'done' && <button className="btn ghost sm" onClick={() => setStatus(r.p.id, s, 'todo')}>Rouvrir</button>}</div></div> })}
            <div className="notes"><b>Notes privées (équipe)</b>
              {notes.map(n => <div key={n.id} className="note"><small>{profiles.map[n.author]?.first_name || 'Coach'} · {fmtDay(n.created_at)}</small>{n.body}</div>)}
              <div className="replybox"><input placeholder="Ex. : produit validé par tel, relancer jeudi…" value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => e.key === 'Enter' && addNote()} /><button className="btn sm" onClick={addNote}>Ajouter</button></div>
            </div>
          </div>}
        </div> })}
        {filtered.length === 0 && <div className="post muted">Personne dans ce filtre.</div>}
      </div>
    </div>
  </>
}
