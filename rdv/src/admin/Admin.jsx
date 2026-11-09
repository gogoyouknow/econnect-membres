import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Candidatures from './Candidatures'

const Ic = ({ d }) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">{d}</svg>

export default function Admin() {
  const [sess, setSess] = useState(undefined)
  const [ok, setOk] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState('appels')
  const toast = (t, bad) => { setMsg({ t, bad }); setTimeout(() => setMsg(null), 3500) }
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSess(data.session || null))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSess(s || null))
    return () => sub.subscription.unsubscribe()
  }, [])
  useEffect(() => {
    if (!sess) { setOk(null); return }
    supabase.rpc('is_staff').then(({ data, error }) => setOk(error ? false : !!data))
  }, [sess])
  const login = async (e) => {
    e.preventDefault(); setBusy(true)
    const f = new FormData(e.target)
    const { error } = await supabase.auth.signInWithPassword({ email: String(f.get('email')).trim(), password: String(f.get('password')) })
    setBusy(false)
    if (error) toast('Email ou mot de passe incorrect', true)
  }
  if (sess === undefined) return <div className="adm"><p className="muted ctr">Chargement…</p></div>
  if (!sess) return <div className="adm"><form className="login" onSubmit={login}>
    <b className="brand">L'ACCÉLÉRATEUR</b><h1>Mes appels</h1><p className="muted">Connecte-toi avec ton compte habituel.</p>
    <input name="email" type="email" placeholder="Email" autoComplete="username" required />
    <input name="password" type="password" placeholder="Mot de passe" autoComplete="current-password" required />
    <button className="btn big" disabled={busy}>{busy ? '…' : 'Me connecter'}</button>
    {msg && <small className="err">{msg.t}</small>}
  </form></div>
  if (ok === null) return <div className="adm"><p className="muted ctr">Vérification…</p></div>
  if (!ok) return <div className="adm"><div className="login"><h1>Accès refusé</h1><p className="muted">Ce compte n'a pas accès à cet espace.</p>
    <button className="btn ghost" onClick={() => supabase.auth.signOut()}>Changer de compte</button></div></div>
  const today = new Date().toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short' })
  return <div className="adm app">
    <header className="bar"><h1>Mes appels</h1><span className="date">{today}</span><button className="out" onClick={() => supabase.auth.signOut()} aria-label="Se déconnecter">⎋</button></header>
    <div className={`scroll ${tab === 'dispos' ? 'light' : ''}`}>
      <Candidatures toast={toast} tab={tab} />
    </div>
    <nav className="tabs">
      <button className={tab === 'appels' ? 'on' : ''} onClick={() => setTab('appels')}><Ic d={<><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></>} />Appels</button>
      <button className={tab === 'dispos' ? 'on' : ''} onClick={() => setTab('dispos')}><Ic d={<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>} />Disponibilités</button>
    </nav>
    {msg && <div className={`toast ${msg.bad ? 'bad' : ''}`}>{msg.t}</div>}
  </div>
}
