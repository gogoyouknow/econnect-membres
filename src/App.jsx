import { useEffect, useState, useCallback } from 'react'
import { supabase, configured } from './lib/supabase'
import { loadProfiles, loadSettings } from './lib/data'
import { Avatar, ROLE_LABEL, useToast } from './lib/ui'
import { isIOS, isStandalone, pushSupported, enablePush } from './lib/push'
import Login from './views/Login'
import Chat from './views/Chat'
import Feed from './views/Feed'
import Lives from './views/Lives'
import Members from './views/Members'
import Notifs from './views/Notifs'
import Moderation from './views/Moderation'
import Admin from './views/Admin'
import Side from './views/Side'
import Upsell, { AccelOffer } from './views/Upsell'
import Journey from './views/Journey'
import Courses from './views/Courses'
import Tracking from './views/Tracking'
import { Mark } from './lib/Logo'
import Onboarding from './views/Onboarding'
import Profile from './views/Profile'
import Messages from './views/Messages'
import Leads from './views/Leads'
import Agenda from './views/Agenda'
import { agenda } from './views/Booking'

// Espaces de l'app : chacun a ses propres accès (profiles.methode / profiles.accel)
const SPACES = {
  methode: { name: 'Méthode E-Connect', short: 'Méthode', sub: 'Ta formation', home: 'mcours' },
  accel: { name: "L'Accélérateur", short: 'Accélérateur', sub: 'Le groupe et l\'accompagnement', home: 'general' },
}

const VIEWS = [
  { id: 'mcours', k: '🎓', label: 'Ma formation', group: 'Méthode E-Connect', sp: 'methode' },
  { id: 'messages', k: '💬', label: 'Élèves & messages', group: 'Méthode E-Connect', sp: 'methode', staff: true },
  { id: 'messages', k: '✉️', label: 'Messages', group: 'Méthode E-Connect', sp: 'methode', needDm: true, memberOnly: true },
  { id: 'mwins', k: '🏆', label: 'Résultats', group: 'Méthode E-Connect', sp: 'methode' },
  { id: 'mlives', k: '🔴', label: 'Lives & replays', group: 'Méthode E-Connect', sp: 'methode' },
  { id: 'mchat', k: '💬', label: 'Chat', group: 'Méthode E-Connect', sp: 'methode', needAccel: true },
  { id: 'offre', k: '⚡', label: "L'Accélérateur", group: 'Méthode E-Connect', sp: 'methode', noAccel: true },
  { id: 'journey', k: '🧭', label: 'Mon parcours', group: 'Espaces', memberOnly: true },
  { id: 'courses', k: '🎓', label: 'Cours', group: 'Espaces' },
  { id: 'messages', k: '💬', label: 'Élèves & messages', group: 'Espaces', sp: 'accel', staff: true },
  { id: 'messages', k: '✉️', label: 'Messages', group: 'Espaces', sp: 'accel', needDm: true, memberOnly: true },
  { id: 'general', k: '💬', label: 'Chat général', group: 'Espaces' },
  { id: 'feed', k: '📰', label: 'Fil & questions', group: 'Espaces' },
  { id: 'lives', k: '🔴', label: 'Lives & replays', group: 'Espaces' },
  { id: 'wins', k: '🏆', label: 'Résultats', group: 'Espaces' },
  { id: 'demarrage', k: '🚀', label: 'Démarrage', group: 'Groupes' },
  { id: 'acceleration', k: '⚡', label: 'Accélération', group: 'Groupes', tier: 2 },
  { id: 'members', k: '👥', label: 'Membres', group: 'Communauté' },
  { id: 'notifs', k: '🔔', label: 'Notifications', group: 'Communauté', sp: 'both' },
  { id: 'profile', k: '👤', label: 'Mon profil', group: 'Communauté', sp: 'both' },
  { id: 'agenda', k: '📅', label: 'Agenda', group: 'Gestion', staff: true },
  { id: 'leads', k: '🎯', label: 'Prospects', group: 'Gestion', staff: true },
  { id: 'tracking', k: '📊', label: 'Suivi des élèves', group: 'Gestion', staff: true },
  { id: 'moderation', k: '🛡️', label: 'Modération', group: 'Gestion', staff: true },
  { id: 'admin', k: '⚙️', label: 'Administration', group: 'Gestion', admin: true, sp: 'both' },
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
  const [live, setLive] = useState(null)
  const [spacePref, setSpacePref] = useState(() => { try { return localStorage.getItem('space') } catch { return null } })
  const [spaceMenu, setSpaceMenu] = useState(false)
  const [pushAsk, setPushAsk] = useState(() => { try { return pushSupported() && Notification.permission === 'default' && !localStorage.getItem('pushAsked') } catch { return false } })
  const [folded, setFolded] = useState(() => { try { return JSON.parse(localStorage.getItem('railFolded') || '{}') } catch { return {} } })
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
  // retour de Google après « Connecter Google Agenda »
  useEffect(() => {
    if (!session || location.pathname !== '/agenda-google') return
    const code = new URLSearchParams(location.search).get('code')
    history.replaceState(null, '', '/#agenda'); setView('agenda')
    if (!code) return toast('Connexion Google annulée', true)
    agenda({ action: 'oauth_exchange', code, redirect_uri: location.origin + '/agenda-google' })
      .then(r => toast(`Google Agenda connecté (${r.email}) ✓`)).catch(e => toast(e.message, true))
  }, [session])

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
  useEffect(() => {
    if (!session) return
    const check = async () => {
      const now = new Date(); const { data } = await supabase.from('lives').select('*').lte('starts_at', now.toISOString()).gte('starts_at', new Date(now - 4 * 3600000).toISOString()).order('starts_at', { ascending: false }).limit(1)
      const l = data?.[0]; setLive(l && new Date(l.starts_at).getTime() + (l.duration_min || 45) * 60000 > now.getTime() ? l : null)
    }
    check(); const i = setInterval(check, 60000); return () => clearInterval(i)
  }, [session])
  useEffect(() => { try { if (isIOS() && !isStandalone() && !localStorage.getItem('guideSeen')) setGuide(true) } catch {} }, [])

  if (session === undefined) return <div className="center">Chargement…</div>
  if (!session) return <Login />
  if (!me || !settings) return <div className="center">Chargement de ton espace…</div>
  if (!me.active) return <section className="login"><div className="card"><div className="logo"><Mark size={34} /><b>E-CONNECT</b></div><h1>Ton accès est en pause</h1><p>Ton abonnement n'est plus actif. Relance-le pour retrouver le groupe, ou écris-nous à {settings.cancel_email || 'contact@theambitiousman.fr'}.</p><button className="btn ghost" onClick={() => supabase.auth.signOut()}>Se déconnecter</button></div></section>
  if (!me.onboarded) return <Onboarding me={me} toast={toast} onDone={refresh} />

  const isStaff = me.role !== 'member', isAdmin = me.role === 'admin'
  const ctx = { me, profiles, settings, isStaff, isAdmin, refresh, go: setView, toast }
  // quels espaces ce membre possède, et lequel est affiché
  const owns = { methode: isStaff || !!me.methode, accel: isStaff || me.accel !== false }
  const inSpace = (v, s) => (v.sp || 'accel') === s || v.sp === 'both'
  const viewSp = view === 'messages' ? 'both' : VIEWS.find(v => v.id === view)?.sp || (view === 'acceleration' ? 'accel' : null)
  let space = owns[spacePref] ? spacePref : owns.accel ? 'accel' : 'methode'
  if (viewSp && viewSp !== 'both' && viewSp !== space && owns[viewSp]) space = viewSp   // lien direct (#mcours, notification…)
  const spaceList = Object.keys(SPACES).filter(s => owns[s] || (s === 'accel' && owns.methode))   // un élève Méthode voit L'Accélérateur (verrouillé)
  const switchSpace = (s) => {
    setSpaceMenu(false)
    if (!owns[s]) { setView('offre'); return }
    try { localStorage.setItem('space', s) } catch {}
    setSpacePref(s); setView(SPACES[s].home)
  }
  const go = (v) => setView(v)
  const visible = VIEWS.filter(v => inSpace(v, space) && (!v.staff || isStaff) && (!v.admin || isAdmin) && (!v.memberOnly || !isStaff) && (!v.noAccel || !owns.accel) && (!v.needDm || isStaff || me.dm_enabled))
  const cur = visible.some(v => v.id === view) || (view === 'acceleration' && space === 'accel') ? view : SPACES[space].home
  const groups = [...new Set(visible.map(v => v.group))]

  let main
  if (space === 'methode') {
    if (cur === 'offre') main = <AccelOffer {...ctx} />
    else if (cur === 'mwins') main = <Feed key="mwins" space="mwins" canPost={isStaff} {...ctx} />
    else if (cur === 'messages') main = <Messages {...ctx} />
    else if (cur === 'mlives') main = <Lives {...ctx} />
    else if (cur === 'mchat') main = owns.accel ? <Chat key="mchat" space="general" {...ctx} /> : <AccelOffer {...ctx} reason="chat" />
    else if (cur === 'notifs') main = <Notifs {...ctx} onRead={() => setUnread(0)} />
    else if (cur === 'profile') main = <Profile {...ctx} />
    else if (cur === 'admin' && isAdmin) main = <Admin {...ctx} />
    else main = <Courses key="methode" scope="methode" {...ctx} />
  }
  else if (cur === 'acceleration' && me.tier < 2 && !isStaff) main = <Upsell {...ctx} />
  else if (['general', 'demarrage', 'acceleration'].includes(cur)) main = <Chat key={cur} space={cur} {...ctx} />
  else if (cur === 'feed') main = <Feed key="feed" space="feed" {...ctx} />
  else if (cur === 'wins') main = <Feed key="wins" space="wins" {...ctx} />
  else if (cur === 'lives') main = <Lives {...ctx} />
  else if (cur === 'members') main = <Members {...ctx} />
  else if (cur === 'profile') main = <Profile {...ctx} />
  else if (cur === 'journey') main = <Journey {...ctx} />
  else if (cur === 'courses') main = <Courses {...ctx} />
  else if (cur === 'tracking' && isStaff) main = <Tracking {...ctx} />
  else if (cur === 'notifs') main = <Notifs {...ctx} onRead={() => setUnread(0)} />
  else if (cur === 'messages') main = <Messages {...ctx} />
  else if (cur === 'leads' && isStaff) main = <Leads {...ctx} />
  else if (cur === 'agenda' && isStaff) main = <Agenda {...ctx} />
  else if (cur === 'moderation' && isStaff) main = <Moderation {...ctx} />
  else if (cur === 'admin' && isAdmin) main = <Admin {...ctx} />
  else main = <Chat key="general" space="general" {...ctx} />

  return (
    <div className={`app ${live && space === 'accel' ? 'has-live' : ''} ${space === 'accel' && !['courses', 'messages', 'agenda'].includes(cur) ? '' : 'noside'}`}>
      <header className="topbar">
        <button className="ic" aria-label="Menu" onClick={() => setRail(r => !r)}>☰</button>
        <div className="spaces">
          <button className="spbtn" onClick={() => spaceList.length > 1 && setSpaceMenu(m => !m)} aria-haspopup={spaceList.length > 1}><Mark size={24} /><span><b className="full">{SPACES[space].name}</b><b className="short">{SPACES[space].short}</b><small>{SPACES[space].sub}</small></span>{spaceList.length > 1 && <i>▾</i>}</button>
          {spaceMenu && <><div className="spscrim" onClick={() => setSpaceMenu(false)} /><div className="spmenu">
            <small>Tes espaces</small>
            {spaceList.map(s => <button key={s} className={s === space ? 'on' : ''} onClick={() => switchSpace(s)}><span><b>{SPACES[s].name}</b><small>{owns[s] ? SPACES[s].sub : 'Accompagnement · 160 €/mois'}</small></span><em>{s === space ? '✓' : owns[s] ? '' : '🔒'}</em></button>)}
          </div></>}
        </div>
        <div className="sp" />
        <button className="ic" aria-label="Notifications" onClick={() => go('notifs')}>🔔{unread > 0 && <span className="n">{unread}</span>}</button>
        <div className="me" style={{ cursor: 'pointer' }} onClick={() => go('profile')}><Avatar p={me} /><div><b>{me.name}</b><small>{ROLE_LABEL[me.role]}</small></div></div>
        <button className="ic" aria-label="Se déconnecter" title="Se déconnecter" onClick={() => supabase.auth.signOut()}>⎋</button>
      </header>

      {live && space === 'accel' && <div className="livebar"><span className="ld" /><div style={{ minWidth: 0 }}><b>Live en cours · {live.title}</b><small>avec {live.host}</small></div>{live.link ? <a href={live.link} target="_blank" rel="noreferrer">Rejoindre</a> : <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => go('lives')}>Voir</button>}</div>}
      {rail && <div className="scrim" onClick={() => setRail(false)} />}
      <nav className={`rail ${rail ? 'open' : ''}`}>
        {groups.map((g, gi) => <div key={g}>
          {(() => { const key = space + ':' + g, items = visible.filter(v => v.group === g), hasCur = items.some(v => v.id === cur), shut = folded[key] ?? (gi > 0 && !hasCur)
            const toggle = () => { const n = { ...folded, [key]: !shut }; setFolded(n); try { localStorage.setItem('railFolded', JSON.stringify(n)) } catch {} }
            return <><button className={`railh ${shut ? 'shut' : ''}`} onClick={toggle} aria-expanded={!shut}><span>{space === 'methode' && g === 'Communauté' ? 'Mon compte' : g}</span><i>▾</i></button>
          {!shut && items.map(v => {
            const locked = (v.tier && me.tier < v.tier && !isStaff) || (v.needAccel && !owns.accel)
            return <button key={v.id} className={`nav ${cur === v.id ? 'on' : ''} ${locked ? 'lock' : ''}`} onClick={() => go(v.id)}><span className="k">{locked ? '🔒' : v.k}</span>{v.label}</button>
          })}</> })()}
        </div>)}
      </nav>

      <main className="main">
        {pushAsk && (!isIOS() || isStandalone()) && <div className="pushbar"><span>🔔 Active les notifications pour être prévenu des messages, des lives et des réponses.</span>
        <button className="btn sm" onClick={() => enablePush(me.id).then(() => { toast('Notifications activées sur cet appareil'); setPushAsk(false) }).catch(e => toast(e.message, true))}>Activer</button>
        <button className="x" aria-label="Plus tard" onClick={() => { setPushAsk(false); try { localStorage.setItem('pushAsked', '1') } catch {} }}>✕</button></div>}
        {main}</main>
      {space === 'accel' && !['courses', 'messages', 'agenda'].includes(cur) && <Side {...ctx} />}

      <nav className="tabbar">
        {(space === 'methode' ? (isStaff ? [['mcours', '🎓', 'Formation'], ['messages', '💬', 'Élèves'], ['mwins', '🏆', 'Résultats'], ['mlives', '🔴', 'Lives']] : [['mcours', '🎓', 'Formation'], ['mwins', '🏆', 'Résultats'], me.dm_enabled ? ['messages', '✉️', 'Messages'] : ['mlives', '🔴', 'Lives'], owns.accel ? ['mchat', '💬', 'Chat'] : ['offre', '⚡', 'Accélérateur']]) : isStaff ? [['general', '💬', 'Chat'], ['messages', '✉️', 'Élèves'], ['courses', '🎓', 'Cours'], ['tracking', '📊', 'Suivi'], ['lives', '🔴', 'Lives']] : [['general', '💬', 'Chat'], ['courses', '🎓', 'Cours'], me.dm_enabled ? ['messages', '✉️', 'Messages'] : ['journey', '🧭', 'Parcours'], ['lives', '🔴', 'Lives'], ['members', '👥', 'Membres']]).map(([id, k, l]) =>
          <button key={id} className={cur === id ? 'on' : ''} onClick={() => go(id)}><span>{k}</span>{l}</button>)}
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
