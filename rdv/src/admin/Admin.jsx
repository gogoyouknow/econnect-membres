import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Candidatures from './Candidatures'
import Leads from './Leads'
import Dispos from './Dispos'

const Ic = ({ d }) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">{d}</svg>

export default function Admin() {
  const [sess, setSess] = useState(undefined)
  const [ok, setOk] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState('appels')
  const [forgot, setForgot] = useState(false)
  const [showPw, setShowPw] = useState(false)
  const [sent, setSent] = useState(false)
  const [nLeads, setNLeads] = useState(0)
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
  useEffect(() => {
    if (!ok) return
    const q = () => supabase.from('cand_leads').select('capital,budget_confirmed').eq('booked', false).eq('follow', 'new').then(({ data }) => setNLeads((data || []).filter(l => l.capital !== 'lt500' && !['soon', 'no'].includes(l.budget_confirmed)).length))
    q(); const i = setInterval(q, 90000); return () => clearInterval(i)
  }, [ok])
  const login = async (e) => {
    e.preventDefault(); setBusy(true)
    const f = new FormData(e.target)
    const { error } = await supabase.auth.signInWithPassword({ email: String(f.get('email')).trim(), password: String(f.get('password')) })
    setBusy(false)
    if (error) toast(/invalid login/i.test(error.message) ? 'Email ou mot de passe incorrect' : 'Erreur : ' + error.message, true)
  }
  const sendReset = async (e) => {
    e.preventDefault(); setBusy(true)
    const email = String(new FormData(e.target).get('email')).trim()
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: 'https://econnect-membres.vercel.app/#reset' })
    setBusy(false)
    if (error) return toast("Impossible d'envoyer le lien pour le moment", true)
    setSent(true)
  }
  if (sess === undefined) return <div className="adm"><p className="muted ctr">Chargement…</p></div>
  if (!sess && forgot) return <div className="adm"><form className="login" onSubmit={sendReset}>
    <b className="brand">L'ACCÉLÉRATEUR</b><h1>Mot de passe oublié</h1>
    {sent ? <p className="muted">C'est envoyé. Ouvre l'email, clique sur le lien et choisis un nouveau mot de passe (tu arrives sur L'Accélérateur). Reviens ensuite ici pour te connecter avec.</p>
      : <><p className="muted">Entre ton email : on t'envoie un lien pour en choisir un nouveau.</p>
        <input name="email" type="email" placeholder="Email" autoComplete="username" defaultValue="contact@theambitiousman.fr" required />
        <button className="btn big" disabled={busy}>{busy ? '…' : 'Envoyer le lien'}</button></>}
    <button type="button" className="btn ghost" onClick={() => { setForgot(false); setSent(false) }}>Retour</button>
    {msg && <small className="err">{msg.t}</small>}
  </form></div>
  if (!sess) return <div className="adm"><form className="login" onSubmit={login}>
    <b className="brand">L'ACCÉLÉRATEUR</b><h1>Mes appels</h1><p className="muted">Connecte-toi avec ton compte habituel.</p>
    <input name="email" type="email" placeholder="Email" autoComplete="username" required />
    <input name="password" type={showPw ? 'text' : 'password'} placeholder="Mot de passe" autoComplete="current-password" required />
    <label className="showpw"><input type="checkbox" checked={showPw} onChange={e => setShowPw(e.target.checked)} /> Afficher le mot de passe</label>
    <button className="btn big" disabled={busy}>{busy ? '…' : 'Me connecter'}</button>
    <button type="button" className="btn ghost" onClick={() => setForgot(true)}>Mot de passe oublié</button>
    {msg && <small className="err">{msg.t}</small>}
  </form></div>
  if (ok === null) return <div className="adm"><p className="muted ctr">Vérification…</p></div>
  if (!ok) return <div className="adm"><div className="login"><h1>Accès refusé</h1><p className="muted">Ce compte n'a pas accès à cet espace.</p>
    <button className="btn ghost" onClick={() => supabase.auth.signOut()}>Changer de compte</button></div></div>
  const today = new Date().toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short' })
  return <div className="adm app">
    <header className="bar"><h1>Mes appels</h1><span className="date">{today}</span><button className="out" onClick={() => supabase.auth.signOut()} aria-label="Se déconnecter">⎋</button></header>
    <div className={`scroll ${tab !== 'appels' ? 'light' : ''}`}>
      {tab === 'leads' ? <Leads toast={toast} onChange={setNLeads} /> : tab === 'dispos' ? <Dispos toast={toast} /> : <Candidatures toast={toast} tab={tab} />}
    </div>
    <nav className="tabs">
      <button className={tab === 'appels' ? 'on' : ''} onClick={() => setTab('appels')}><Ic d={<><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></>} />Appels</button>
      <button className={tab === 'leads' ? 'on' : ''} onClick={() => setTab('leads')}><span className="ico"><Ic d={<><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M17 6v6M20 9h-6" /></>} />{nLeads > 0 && <i className="dot">{nLeads > 9 ? '9+' : nLeads}</i>}</span>Relances</button>
      <button className={tab === 'dispos' ? 'on' : ''} onClick={() => setTab('dispos')}><Ic d={<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>} />Disponibilités</button>
    </nav>
    {msg && <div className={`toast ${msg.bad ? 'bad' : ''}`}>{msg.t}</div>}
  </div>
}
