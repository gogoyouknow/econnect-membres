import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ago } from '../lib/ui'
import { enablePush, pushSupported } from '../lib/push'

export default function Notifs({ me, go, toast, onRead }) {
  const [list, setList] = useState([])
  useEffect(() => {
    supabase.from('notifications').select('*').eq('user_id', me.id).order('created_at', { ascending: false }).limit(50).then(async ({ data }) => {
      setList(data || []); await supabase.from('notifications').update({ read: true }).eq('user_id', me.id).eq('read', false); onRead()
    })
  }, [me.id])
  async function push() { try { await enablePush(me.id); toast('Notifications activées sur cet appareil') } catch (e) { toast(e.message, true) } }
  return <>
    <div className="head"><div style={{ flex: 1 }}><h2>Notifications</h2></div>{pushSupported() && Notification.permission !== 'granted' && <button className="btn" onClick={push}>Activer les notifs</button>}</div>
    <div className="body"><div className="post">
      {list.length === 0 && <small className="muted">Rien pour l'instant</small>}
      {list.map(n => <div key={n.id} className={`notif ${n.read ? '' : 'unread'}`} style={{ cursor: n.url ? 'pointer' : 'default' }} onClick={() => n.url && n.url.startsWith('#') && go(n.url.slice(1))}><div><b style={{ fontWeight: 600 }}>{n.title}</b>{n.body && <div>{n.body}</div>}<small>{ago(n.created_at)}</small></div></div>)}
    </div></div>
  </>
}
