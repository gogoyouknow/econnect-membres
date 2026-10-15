import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Avatar, NameTag, ROLE_LABEL, TIER_LABEL } from '../lib/ui'
import { enablePush, pushSupported } from '../lib/push'

export default function Side({ me, profiles, settings, isStaff, go, toast }) {
  const [next, setNext] = useState(null); const [open, setOpen] = useState(0)
  useEffect(() => {
    supabase.from('lives').select('*').gte('starts_at', new Date(Date.now() - 3600000).toISOString()).order('starts_at').limit(1).then(({ data }) => setNext(data?.[0] || null))
    if (isStaff) supabase.from('reports').select('*', { count: 'exact', head: true }).eq('status', 'open').then(({ count }) => setOpen(count || 0))
  }, [isStaff])
  const online = profiles.list.filter(p => p.active && p.last_seen && Date.now() - new Date(p.last_seen) < 10 * 60000)
  const canPush = pushSupported() && Notification.permission !== 'granted'
  return <aside className="side">
    <div className="box gold"><h3>Prochain live</h3>
      {next ? (<>
        <b>{next.title}</b>
        <div className="muted small" style={{ margin: '2px 0 8px' }}>{new Date(next.starts_at).toLocaleString('fr-FR', { weekday: 'long', hour: '2-digit', minute: '2-digit' })} · avec {next.host}</div>
        {next.link
          ? <a className="btn" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }} href={next.link} target="_blank" rel="noreferrer">Rejoindre</a>
          : <button className="btn" style={{ width: '100%' }} onClick={() => go('lives')}>Voir les lives</button>}
      </>) : (<>
        <div className="muted small">Aucun live programmé</div>
        {isStaff && <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => go('lives')}>Programmer</button>}
      </>)}
    </div>
    {canPush && <div className="box"><h3>Notifications</h3><div className="small muted" style={{ marginBottom: 8 }}>Sois prévenu des lives et des réponses des coachs.</div><button className="btn ghost" style={{ width: '100%' }} onClick={() => enablePush(me.id).then(() => toast('Notifications activées')).catch(e => toast(e.message, true))}>Activer</button></div>}
    <div className="box"><h3>En ligne · {online.length}</h3>
      {online.slice(0, 8).map(p => <div key={p.id} className="mem"><Avatar p={p} /><div><b><NameTag p={p} /></b><small>{p.role === 'member' ? p.status : ROLE_LABEL[p.role]}</small></div><span className="dot" style={{ marginLeft: 'auto' }} /></div>)}
      {online.length === 0 && <small className="muted">Personne pour l'instant</small>}
    </div>
    <div className="box"><h3>{me.role === 'member' ? 'Ton avancement' : 'Équipe'}</h3>
      {me.role === 'member' ? <><b>{me.status || 'Module 1'}</b><div className="muted small">Groupe {TIER_LABEL[me.tier]} · membre depuis le {new Date(me.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</div></>
        : <><b>Équipe E-Connect</b><div className="muted small">{open} signalement{open > 1 ? 's' : ''} à traiter</div></>}
    </div>
    {settings.welcome_message && <div className="box"><h3>Règle du groupe</h3><div className="small">{settings.welcome_message}</div></div>}
  </aside>
}
