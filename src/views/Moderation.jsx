import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ago } from '../lib/ui'
import Rules from './Rules'

export default function Moderation({ me, profiles, settings, toast }) {
  const [reports, setReports] = useState([]); const [deleted, setDeleted] = useState(0)
  const load = async () => {
    const { data } = await supabase.from('reports').select('*').eq('status', 'open').order('created_at', { ascending: false }); setReports(data || [])
    const { count } = await supabase.from('messages').select('*', { count: 'exact', head: true }).eq('deleted', true).gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()); setDeleted(count || 0)
  }
  useEffect(() => { load() }, [])
  const muted = profiles.list.filter(p => p.muted_until && new Date(p.muted_until) > new Date())
  async function resolve(r, status, extra) {
    if (extra === 'delete' && r.message_id) await supabase.from('messages').update({ deleted: true }).eq('id', r.message_id)
    if (extra === 'delete' && r.post_id) await supabase.from('posts').delete().eq('id', r.post_id)
    if (extra === 'delete' && r.target_user_id) await supabase.from('notifications').insert({ user_id: r.target_user_id, title: "Avertissement d'un coach", body: 'Un de tes messages a été supprimé. Merci de respecter les règles du groupe.' })
    await supabase.from('reports').update({ status }).eq('id', r.id); toast(status === 'dismissed' ? 'Signalement ignoré' : 'Traité'); load()
  }
  async function unmute(p) { await supabase.from('profiles').update({ muted_until: null }).eq('id', p.id); toast('Sourdine levée') }
  return <>
    <div className="head"><div style={{ flex: 1 }}><h2>Modération</h2><small>Signalements, sourdines, règles du chat</small></div></div>
    <div className="body">
      <div className="kpis"><div className="kpi"><b>{reports.length}</b><small>Signalement{reports.length > 1 ? 's' : ''} à traiter</small></div><div className="kpi"><b>{muted.length}</b><small>En sourdine</small></div><div className="kpi"><b>{deleted}</b><small>Messages supprimés (7 j)</small></div></div>
      <div className="post"><b>Signalements</b>
        {reports.length === 0 && <div><small className="muted">Rien à traiter</small></div>}
        {reports.map(r => <div key={r.id} className="row"><label>{profiles.map[r.target_user_id]?.name || 'Membre'} · {r.reason}<small>{ago(r.created_at)}{r.reporter_id ? ` · signalé par ${profiles.map[r.reporter_id]?.name || 'un membre'}` : ' · filtre automatique'}</small></label>
          <span style={{ display: 'flex', gap: 6 }}><button className="btn ghost sm" onClick={() => resolve(r, 'dismissed')}>Ignorer</button><button className="btn danger sm" onClick={() => resolve(r, 'actioned', 'delete')}>Supprimer + avertir</button></span></div>)}
      </div>
      <Rules settings={settings} toast={toast} />
      <div className="post"><b>Membres en sourdine</b>
        {muted.length === 0 && <div><small className="muted">Personne</small></div>}
        {muted.map(p => <div key={p.id} className="row"><label>{p.name}<small>Jusqu'à {new Date(p.muted_until).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</small></label><button className="btn ghost sm" onClick={() => unmute(p)}>Lever</button></div>)}
      </div>
    </div>
  </>
}
