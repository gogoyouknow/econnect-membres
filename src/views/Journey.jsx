import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/data'
import { fmtDay } from '../lib/ui'

export async function loadSteps() {
  const { data } = await supabase.from('steps').select('*').order('position'); return data || []
}
export async function loadMemberSteps(userId) {
  let q = supabase.from('member_steps').select('*'); if (userId) q = q.eq('user_id', userId)
  const { data } = await q; return data || []
}
export function progressOf(steps, mine) {
  const done = steps.filter(s => mine[s.id]?.status === 'done').length
  const current = steps.find(s => mine[s.id]?.status !== 'done') || null
  return { done, total: steps.length, pct: steps.length ? Math.round(done / steps.length * 100) : 0, current }
}

/** Côté élève : où j'en suis, ce que je dois faire maintenant */
export default function Journey({ me, toast, profiles, settings }) {
  const [steps, setSteps] = useState([])
  const [mine, setMine] = useState({})
  const [shop, setShop] = useState(me.shop_url || '')
  const reload = async () => { const [s, m] = await Promise.all([loadSteps(), loadMemberSteps(me.id)]); setSteps(s); const map = {}; m.forEach(x => { map[x.step_id] = x }); setMine(map) }
  useEffect(() => { reload()
    const ch = supabase.channel('journey-' + me.id).on('postgres_changes', { event: '*', schema: 'public', table: 'member_steps', filter: `user_id=eq.${me.id}` }, reload).subscribe()
    return () => supabase.removeChannel(ch) }, [me.id])

  const prog = progressOf(steps, mine)
  async function mark(step, status) {
    const { error } = await supabase.from('member_steps').upsert({ user_id: me.id, step_id: step.id, status })
    if (error) return toast(friendlyError(error), true)
    toast(status === 'todo' ? 'Étape rouverte' : step.validated_by === 'coach' ? 'Envoyé au coach pour validation' : 'Étape validée ✅')
  }
  async function saveShop() {
    const { error } = await supabase.from('profiles').update({ shop_url: shop.trim() }).eq('id', me.id)
    toast(error ? friendlyError(error) : 'Lien de boutique enregistré', !!error)
  }
  const coachName = profiles.list.find(p => p.role === 'admin')?.first_name || 'le coach'

  return <>
    <div className="head"><div style={{ flex: 1 }}><h2>Mon parcours</h2><small>Entré le {fmtDay(me.created_at)} · étape {Math.min(prog.done + 1, prog.total)} sur {prog.total}</small></div></div>
    <div className="body">
      <div className="post prog"><div className="row" style={{ padding: 0, border: 0 }}><label>{prog.current ? <>Maintenant : <b>{prog.current.title}</b></> : <b>Parcours terminé 🎉</b>}</label><b className="pct">{prog.pct} %</b></div><div className="barp"><i style={{ width: prog.pct + '%' }} /></div></div>
      {steps.map((s, i) => {
        const st = mine[s.id]?.status || 'todo'
        const isCurrent = prog.current?.id === s.id
        const locked = !isCurrent && st === 'todo'
        return <div key={s.id} className={`post step ${st} ${isCurrent ? 'cur' : ''} ${locked ? 'locked' : ''}`}>
          <div className="ck">{st === 'done' ? '✓' : st === 'pending' ? '⏳' : i + 1}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>{i + 1} · {s.title}</b>
            <small>{s.description}</small>
            {s.lessons && <small className="les">📚 {s.lessons}</small>}
            {st === 'done' && mine[s.id]?.done_at && <small className="by">Validé{mine[s.id]?.validated_by && mine[s.id].validated_by !== me.id ? ` par ${profiles.map[mine[s.id].validated_by]?.first_name || coachName}` : ''} · {fmtDay(mine[s.id].done_at)}</small>}
            {st === 'pending' && <small className="by wait">En attente de validation par {coachName}</small>}
            {isCurrent && s.position === 1 && <div className="shoprow"><input placeholder="https://ta-boutique.myshopify.com" value={shop} onChange={e => setShop(e.target.value)} /><button className="btn ghost sm" onClick={saveShop}>Enregistrer</button></div>}
            {isCurrent && st === 'todo' && <button className="btn sm" style={{ marginTop: 8 }} onClick={() => mark(s, 'done')}>{s.validated_by === 'coach' ? `C'est fait, demander la validation à ${coachName}` : "C'est fait ✓"}</button>}
            {isCurrent && st === 'pending' && <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => mark(s, 'todo')}>Annuler la demande</button>}
          </div>
        </div>
      })}
    </div>
  </>
}
