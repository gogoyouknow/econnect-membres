import { useEffect, useState, useCallback } from 'react'
import { supabase, configured } from './lib/supabase'
import { loadProfiles, loadSettings } from './lib/data'
import { Avatar, ROLE_LABEL, useToast } from './lib/ui'
import { isIOS, isStandalone } from './lib/push'
import Login from './views/Login'
import Chat from './views/Chat'
import Feed from './views/Feed'
import Lives from './views/Lives'
import Members from './views/Members'
import Notifs from './views/Notifs'
import Moderation from './views/Moderation'
import Admin from './views/Admin'
import Side from './views/Side'
import Logo from './lib/Logo'
import Onboarding from './views/Onboarding'
import Profile from './views/Profile'

const VIEWS = [
  { id: 'general', k: '💬', label: 'Chat général', group: 'Espaces' },
  { id: 'feed', k: '📰', label: 'Fil & questions', group: 'Espaces' },
  { id: 'lives', k: '🔴', label: 'Lives & replays', group: 'Espaces' },
  { id: 'wins', k: '🏆', label: 'Résultats', group: 'Espaces' },
  { id: 'demarrage', k: '🚀', label: 'Démarrage', group: 'Groupes' },
  { id: 'acceleration', k: '⚡', label: 'Accélération', group: 'Groupes', tier: 2 },
  { id: 'members', k: '👥', label: 'Membres', group: 'Communauté' },
  { id: 'notifs', k: '🔔', label: 'Notifications', group: 'Communauté' },
  { id: 'profile', k: '👤', label: 'Mon profil', group: 'Communauté' },
  { id: 'moderation', k: '🛡️', label: 'Modération', group: 'Gestion', staff: true },
  { id: 'admin', k: '⚙️', label: 'Administration', group: 'Gestion', admin: true },
]

export default function App() {
  const [session, setSession] = useState(undefined)
  const [me, setMe] = useState(null)
  const [profiles, setProfiles] = useState({ list: [], map: {} })
  const [settings, setSettings] = useState(null)
  const [view, setView] = useState(() => (location.hash || '#general').slice(1))
  const [rail, setRail] = useState(false)
  const [unread, setUnread] = useState(0)
  const [guide, setGuide] = useState(false)
  const toast = useToast()

  useEffect(() => {
    if (!configured) { setSession(null); return }
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const refresh = useCallback(async () => {
    const [p, s] = await Promise.all([loadProfiles(), loadSettings()])
    setProfiles(p); setSettings(s)
    const mine = p.map[session.user.id]; setMe(mine || null)
    const { count } = await supabase.from('notifications').select('*', { count: 'exact', head: true }).eq('user_id', session.user.id).eq('read', false)
    setUnread(count || 0)
  }, [session])

  useEffect(() => { if (session) refresh() }, [session, refresh])

  useEffect(() => {
    if (!session) return
    const ch = supabase.channel('global')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, () => loadSettings().then(setSettings))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => loadProfiles().then(p => { setProfiles(p); setMe(p.map[session.user.id] || null) }))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${session.user.id}` }, () => setUnread(u => u + 1))
      .subscribe()
    supabase.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', session.user.id).then(() => {})
    return () => supabase.removeChannel(ch)
  }, [session])

  useEffect(() => { location.hash = view; setRail(false) }, [view])
  useEffect(() => { try { if (isIOS() && !isStandalone() && !localStorage.getItem('guideSeen')) setGuide(true) } catch {} }, [])

  if (session === undefined) return <div className="center">Chargement…</div>
  if (!session) return <Login />
  if (!me || !settings) return <div className="center">Chargement de ton espace…</div>
  if (!me.active) return <section className="login"><div className="card"><Logo size={34} /><h1>Ton accès est en pause</h1><p>Ton abonnement n'est plus actif. Relance-le pour retrouver le groupe, ou écris-nous à contact@theambitiousman.fr.</p><button className="btn ghost" onClick={() => supabase.auth.signOut()}>Se déconnecter</button></div></section>
  if (!me.onboarded) return <Onboarding me={me} toast={toast} onDone={refresh} />

  const isStaff = me.role !== 'member', isAdmin = me.role === 'admin'
  const ctx = { me, profiles, settings, isStaff, isAdmin, refresh, go: setView, toast }
  const go = (v) => {
    const d = VIEWS.find(x => x.id === v)
    if (d?.tier && me.tier < d.tier && !isStaff) return toast('Groupe Accélération : réservé aux membres avec un produit validé')
    setView(v)
  }
  const visible = VIEWS.filter(v => (!v.staff || isStaff) && (!v.admin || isAdmin))
  const groups = [...new Set(visible.map(v => v.group))]

  let main
  if (['general', 'demarrage', 'acceleration'].includes(view)) main = <Chat key={view} space={view} {...ctx} />
  else if (view === 'feed') main = <Feed key="feed" space="feed" {...ctx} />
  else if (view === 'wins') main = <Feed key="wins" space="wins" {...ctx} />
  else if (view === 'lives') main = <Lives {...ctx} />
  else if (view === 'members') main = <Members {...ctx} />
  else if (view === 'profile') main = <Profile {...ctx} />
  else if (view === 'notifs') main = <Notifs {...ctx} onRead={() => setUnread(0)} />
  else if (view === 'moderation' && isStaff) main = <Moderation {...ctx} />
  else if (view === 'admin' && isAdmin) main = <Admin {...ctx} />
  else main = <Chat key="general" space="general" {...ctx} />

  return (
    <div className="app">
      <header className="topbar">
        <button className="ic" aria-label="Menu" onClick={() => setRail(r => !r)}>☰</button>
        <Logo size={26} />
        <div className="sp" />
        <button className="ic" aria-label="Notifications" onClick={() => go('notifs')}>🔔{unread > 0 && <span className="n">{unread}</span>}</button>
        <div className="me" style={{ cursor: 'pointer' }} onClick={() => go('profile')}><Avatar p={me} /><div><b>{me.name}</b><small>{ROLE_LABEL[me.role]}</small></div></div>
        <button className="ic" aria-label="Se déconnecter" title="Se déconnecter" onClick={() => supabase.auth.signOut()}>⎋</button>
      </header>

      {rail && <div className="scrim" onClick={() => setRail(false)} />}
      <nav className={`rail ${rail ? 'open' : ''}`}>
        {groups.map(g => <div key={g}>
          <h3>{g}</h3>
          {visible.filter(v => v.group === g).map(v => {
            const locked = v.tier && me.tier < v.tier && !isStaff
            return <button key={v.id} className={`nav ${view === v.id ? 'on' : ''} ${locked ? 'lock' : ''}`} onClick={() => go(v.id)}><span className="k">{locked ? '🔒' : v.k}</span>{v.label}</button>
          })}
        </div>)}
      </nav>

      <main className="main">{main}</main>
      <Side {...ctx} />

      <nav className="tabbar">
        {[['general', '💬', 'Chat'], ['feed', '📰', 'Fil'], ['lives', '🔴', 'Lives'], ['members', '👥', 'Membres']].map(([id, k, l]) =>
          <button key={id} className={view === id ? 'on' : ''} onClick={() => go(id)}><span>{k}</span>{l}</button>)}
        <button className={rail ? 'on' : ''} onClick={() => setRail(r => !r)}><span>☰</span>Plus</button>
      </nav>

      {guide && <div className="guide">
        <button className="x" aria-label="Fermer" onClick={() => { setGuide(false); try { localStorage.setItem('guideSeen', '1') } catch {} }}>✕</button>
        <b>📲 Installe l'app sur ton iPhone</b>
        Appuie sur le bouton Partager <span style={{ color: 'var(--gold)' }}>⬆︎</span> en bas de Safari, puis « Sur l'écran d'accueil ». Tu auras l'icône E-Connect et les notifications.
      </div>}
    </div>
  )
}
