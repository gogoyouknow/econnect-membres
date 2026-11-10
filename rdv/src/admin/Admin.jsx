import { useEffect, useState } from 'react'
import { usePS, useScrollMemory } from './persist'
import { supabase } from './supabase'
import Candidatures from './Candidatures'
import Leads from './Leads'
import Prospects from './Prospects'
import Formulaires from './Formulaires'
import Search from './Search'
const Logo = ({ s = 30 }) => <svg className="logo" viewBox="0 0 1024 1024" width={s} height={s} aria-hidden="true"><path d="M 686.6 354.8 A 235 235 0 1 0 686.6 669.2" fill="none" stroke="#fff" strokeWidth="125" strokeLinecap="round" /><circle cx="742" cy="512" r="62" fill="#6FE3A1" /></svg>
import Dispos from './Dispos'
import Closing from './Closing'
import Boundary from './Boundary'
import { pushState, enablePush, disablePush } from './push'
import { useAutoUpdate } from './autoupdate'

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
const rnd = (n) => crypto.getRandomValues(new Uint8Array(n))
const LKEY = 'calio_faceid'
const faceOk = typeof window !== 'undefined' && !!window.PublicKeyCredential
const getFace = () => { try { return localStorage.getItem(LKEY) } catch { return null } }
// Face ID / Touch ID : vérifie que c'est bien toi (clé stockée dans l'iPhone, rien n'est envoyé nulle part).
const faceUnlock = async () => {
  const id = getFace(); if (!id) return true
  try { await navigator.credentials.get({ publicKey: { challenge: rnd(32), allowCredentials: [{ type: 'public-key', id: unb64(id) }], userVerification: 'required', rpId: location.hostname, timeout: 60000 } }); return true } catch { return false }
}

const Ic = ({ d }) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">{d}</svg>

export default function Admin() {
  const stale = useAutoUpdate()
  const [sess, setSess] = useState(undefined)
  const [ok, setOk] = useState(null)
  const [role, setRole] = useState('staff')
  const [join, setJoin] = useState(() => { try { return new URLSearchParams(location.search).get('join') === '1' } catch { return false } })
  const [jstep, setJstep] = useState('form'); const [jmail, setJmail] = useState(() => { try { return new URLSearchParams(location.search).get('email') || '' } catch { return '' } })
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = usePS('tab', 'appels')
  useScrollMemory(tab)
  const [forgot, setForgot] = useState(false)
  const [showPw, setShowPw] = useState(false)
  const [sent, setSent] = useState(false)
  const [nLeads, setNLeads] = useState(0)
  const [focus, setFocus] = useState(null)
  const [locked, setLocked] = useState(() => !!getFace())
  const [face, setFace] = useState(() => !!getFace())
  const [pst, setPst] = useState('off'); const [retry, setRetry] = useState(0)
  useEffect(() => { pushState().then(setPst) }, [])
  const [keep, setKeep] = useState(true)
  const toast = (t, bad) => { setMsg({ t, bad }); setTimeout(() => setMsg(null), 3500) }
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      let off = false; try { off = localStorage.getItem('calio_keep') === '0' && !sessionStorage.getItem('calio_sess') } catch { /* */ }
      if (data.session && off) { supabase.auth.signOut(); setSess(null) } else setSess(data.session || null)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSess(s || null))
    return () => sub.subscription.unsubscribe()
  }, [])
  useEffect(() => {
    if (!sess) { setOk(null); return }
    setOk(null)
    supabase.rpc('calio_role').then(({ data, error }) => {
      if (!error) { setRole(data === 'closer' ? 'closer' : 'staff'); return setOk(!!data) }
      return supabase.rpc('is_staff').then((r) => { setRole('staff'); setOk(r.error ? 'err' : !!r.data) })
    }).catch(() => setOk('err'))
  }, [sess, retry])
  useEffect(() => { if (locked && sess && ok === true) faceUnlock().then((r) => r && setLocked(false)) }, [locked, sess, ok])
  useEffect(() => {
    let t = 0
    const v = () => { if (document.visibilityState === 'hidden') t = Date.now(); else if (t && Date.now() - t > 60000 && getFace()) setLocked(true) }
    document.addEventListener('visibilitychange', v); return () => document.removeEventListener('visibilitychange', v)
  }, [])
  useEffect(() => {
    if (ok !== true || role === 'closer') return
    const q = () => supabase.from('cand_leads').select('capital,budget_confirmed').eq('booked', false).eq('follow', 'new').then(({ data }) => setNLeads((data || []).filter(l => l.capital !== 'lt500' && !['soon', 'no'].includes(l.budget_confirmed)).length))
    q(); const i = setInterval(q, 90000); return () => clearInterval(i)
  }, [ok, role])
  useEffect(() => { if (role === 'closer' && !['appels', 'closing'].includes(tab)) setTab('appels') }, [role, tab])
  const login = async (e) => {
    e.preventDefault(); setBusy(true)
    const f = new FormData(e.target)
    const { error } = await supabase.auth.signInWithPassword({ email: String(f.get('email')).trim(), password: String(f.get('password')) })
    setBusy(false)
    if (!error) { try { localStorage.setItem('calio_keep', f.get('keep') ? '1' : '0'); sessionStorage.setItem('calio_sess', '1') } catch { /* */ } }
    if (error) toast(/invalid login/i.test(error.message) ? 'Email ou mot de passe incorrect' : 'Erreur : ' + error.message, true)
  }
  const joinSubmit = async (e) => {
    e.preventDefault(); setBusy(true)
    const f = new FormData(e.target); const email = String(f.get('email') || jmail).trim().toLowerCase()
    try {
      if (jstep === 'code') {
        const code = String(f.get('code') || '').replace(/\D/g, ''); if (code.length < 6) throw new Error('Entre les 6 chiffres du code.')
        const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'signup' }); if (error) throw error
      } else {
        const pw = String(f.get('password') || ''); if (pw.length < 8) throw new Error('8 caractères minimum pour le mot de passe.')
        if (pw !== String(f.get('password2') || '')) throw new Error('Les deux mots de passe ne sont pas identiques.')
        const { data, error } = await supabase.auth.signUp({ email, password: pw, options: { emailRedirectTo: 'https://rdv.theambitiousman.fr/admin' } })
        if (error) throw error
        setJmail(email)
        if (!data.session) { setJstep('code'); toast('Code envoyé par email. Regarde aussi tes spams.') }
      }
      try { localStorage.setItem('calio_keep', '1'); sessionStorage.setItem('calio_sess', '1') } catch { /* */ }
    } catch (er) {
      const m = String(er.message || '')
      toast(/pas d.acc[eè]s actif|inviter/i.test(m) ? "Cet email n'a pas été invité. Demande une invitation à Clément." : /already registered|already been registered/i.test(m) ? 'Ce compte existe déjà : connecte-toi.' : m || 'Erreur', true)
    }
    setBusy(false)
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
  if (!sess && join) return <div className="adm"><form className="login" onSubmit={joinSubmit}>
    <Logo s={44} /><b className="brand">CALIO</b><h1>Créer mon compte</h1>
    {jstep === 'code' ? <><p className="muted">On vient d'envoyer un code à 6 chiffres à <b>{jmail}</b>. Entre-le ici.</p>
      <input name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="Code à 6 chiffres" maxLength={8} required />
      <button className="btn big" disabled={busy}>{busy ? '…' : 'Valider'}</button></>
      : <><p className="muted">Utilise l'adresse email sur laquelle Clément t'a invité.</p>
        <input name="email" type="email" inputMode="email" placeholder="Email" autoComplete="username" autoCapitalize="none" defaultValue={jmail} required />
        <input name="password" type={showPw ? 'text' : 'password'} placeholder="Mot de passe (8 caractères min.)" autoComplete="new-password" required />
        <input name="password2" type={showPw ? 'text' : 'password'} placeholder="Répète le mot de passe" autoComplete="new-password" required />
        <label className="showpw"><input type="checkbox" checked={showPw} onChange={e => setShowPw(e.target.checked)} /> Afficher le mot de passe</label>
        <button className="btn big" disabled={busy}>{busy ? '…' : 'Créer mon compte'}</button></>}
    <button type="button" className="btn ghost" onClick={() => { setJoin(false); setJstep('form') }}>J'ai déjà un compte</button>
    {msg && <small className="err">{msg.t}</small>}
  </form></div>
  if (!sess && forgot) return <div className="adm"><form className="login" onSubmit={sendReset}>
    <Logo s={44} /><b className="brand">CALIO</b><h1>Mot de passe oublié</h1>
    {sent ? <p className="muted">C'est envoyé. Ouvre l'email, clique sur le lien et choisis un nouveau mot de passe (tu arrives sur L'Accélérateur). Reviens ensuite ici pour te connecter avec.</p>
      : <><p className="muted">Entre ton email : on t'envoie un lien pour en choisir un nouveau.</p>
        <input name="email" type="email" placeholder="Email" autoComplete="username" defaultValue="contact@theambitiousman.fr" required />
        <button className="btn big" disabled={busy}>{busy ? '…' : 'Envoyer le lien'}</button></>}
    <button type="button" className="btn ghost" onClick={() => { setForgot(false); setSent(false) }}>Retour</button>
    {msg && <small className="err">{msg.t}</small>}
  </form></div>
  if (!sess) return <div className="adm"><form className="login" onSubmit={login}>
    <Logo s={44} /><b className="brand">CALIO</b><h1>Mes appels</h1><p className="muted">Connecte-toi avec ton compte habituel.</p>
    <input id="email" name="email" type="email" inputMode="email" placeholder="Email" autoComplete="username" autoCapitalize="none" required />
    <input id="password" name="password" type={showPw ? 'text' : 'password'} placeholder="Mot de passe" autoComplete="current-password" required />
    <label className="showpw"><input type="checkbox" name="keep" checked={keep} onChange={e => setKeep(e.target.checked)} /> Rester connecté</label>
    <label className="showpw"><input type="checkbox" checked={showPw} onChange={e => setShowPw(e.target.checked)} /> Afficher le mot de passe</label>
    <button className="btn big" disabled={busy}>{busy ? '…' : 'Me connecter'}</button>
    <button type="button" className="btn ghost" onClick={() => setForgot(true)}>Mot de passe oublié</button>
    <button type="button" className="linkbtn" onClick={() => setJoin(true)}>Tu as reçu une invitation ? Crée ton compte</button>
    {msg && <small className="err">{msg.t}</small>}
  </form></div>
  if (ok === null) return <div className="adm"><p className="muted ctr">Vérification…</p></div>
  if (ok === 'err') return <div className="adm"><div className="login"><h1>Connexion impossible</h1><p className="muted">Je n'arrive pas à joindre le serveur (réseau faible ?). Tes données ne sont pas perdues.</p>
    <button className="btn big" onClick={() => setRetry((n) => n + 1)}>Réessayer</button></div></div>
  if (!ok) return <div className="adm"><div className="login"><h1>Accès refusé</h1><p className="muted">Ce compte n'a pas accès à cet espace.</p>
    <button className="btn ghost" onClick={() => supabase.auth.signOut()}>Changer de compte</button></div></div>
  const togglePush = async () => {
    try {
      if (pst === 'on') { await disablePush(); setPst('off'); return toast('Notifications désactivées') }
      await enablePush(sess.user.id); setPst('on'); toast('Notifications activées : tu seras prévenu à chaque nouveau formulaire')
    } catch (e) { toast(e.message || 'Impossible d’activer les notifications', true) }
  }
  const unlock = () => faceUnlock().then((r) => r ? setLocked(false) : toast('Face ID non reconnu', true))
  const toggleFace = async () => {
    if (face) { try { localStorage.removeItem(LKEY) } catch { /* */ } setFace(false); return toast('Face ID désactivé') }
    try {
      const c = await navigator.credentials.create({ publicKey: { challenge: rnd(32), rp: { name: 'Calio', id: location.hostname }, user: { id: rnd(16), name: sess.user.email || 'calio', displayName: 'Calio' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' }, timeout: 60000 } })
      localStorage.setItem(LKEY, b64(c.rawId)); setFace(true); toast('Face ID activé : Calio se verrouille quand tu la quittes')
    } catch { toast("Impossible d'activer Face ID sur cet appareil", true) }
  }
  if (locked) return <div className="adm"><div className="login"><Logo s={44} /><b className="brand">CALIO</b><h1>Verrouillé</h1><p className="muted">Déverrouille avec Face ID pour ouvrir tes appels.</p>
    <button className="btn big" onClick={unlock}>Déverrouiller</button>
    <button className="btn ghost" onClick={() => { supabase.auth.signOut(); setLocked(false) }}>Se déconnecter</button>{msg && <small className="err">{msg.t}</small>}</div></div>
  const today = new Date().toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short' })
  return <div className="adm app">
    {stale && <button className="upd" onClick={() => location.reload()}>Une nouvelle version de Calio est disponible · Mettre à jour</button>}
    <header className="bar"><Logo s={30} /><h1>{{ appels: 'Mes appels', prospects: 'Prospects', formulaires: 'Formulaires', leads: 'Relances', closing: 'Closing', dispos: 'Disponibilités' }[tab] || 'Mes appels'}</h1>{role !== 'closer' && <Search onPick={(id) => { setFocus({ id, t: Date.now() }); setTab('prospects') }} />}<span className="date">{today}</span>{pst !== 'unsupported' && <button className="out" onClick={togglePush} aria-label="Notifications" title={pst === 'on' ? 'Notifications activées' : 'Activer les notifications'} style={{ color: pst === 'on' ? '#6FE3A1' : undefined }}><svg width="21" height="21" viewBox="0 0 24 24" fill={pst === 'on' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg></button>}{faceOk && <button className="out" onClick={toggleFace} aria-label="Face ID" title={face ? 'Face ID activé' : 'Activer Face ID'} style={{ color: face ? '#6FE3A1' : undefined }}><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M9 10v1.5M15 10v1.5M12 10v3.5M9 16c1.7 1.3 4.3 1.3 6 0" /></svg></button>}<button className="out" onClick={() => supabase.auth.signOut()} aria-label="Se déconnecter">⎋</button></header>
    <div className={`scroll ${tab !== 'appels' ? 'light' : ''} ${tab === 'prospects' || tab === 'formulaires' || tab === 'closing' ? 'wide' : ''}`}>
      <Boundary name={tab}>{tab === 'prospects' ? <Prospects toast={toast} focus={focus} /> : tab === 'formulaires' ? <Formulaires toast={toast} onOpen={(id) => { setFocus({ id, t: Date.now() }); setTab('prospects') }} /> : tab === 'leads' ? <Leads toast={toast} onChange={setNLeads} /> : tab === 'closing' ? <Closing toast={toast} /> : tab === 'dispos' ? <Dispos toast={toast} /> : <Candidatures toast={toast} tab={tab} closer={role === 'closer'} />}</Boundary>
    </div>
    <nav className="tabs">
      <button className={tab === 'appels' ? 'on' : ''} onClick={() => setTab('appels')}><Ic d={<><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></>} />Appels</button>
      {role !== 'closer' && <button className={tab === 'prospects' ? 'on' : ''} onClick={() => setTab('prospects')}><Ic d={<><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 5.5a3.2 3.2 0 0 1 0 6M18 14.8c1.8.6 3 2.2 3 5.2" /></>} />Prospects</button>}
      {role !== 'closer' && <button className={tab === 'formulaires' ? 'on' : ''} onClick={() => setTab('formulaires')}><Ic d={<><rect x="5" y="3" width="14" height="18" rx="2.5" /><path d="M9 8h6M9 12h6M9 16h3" /></>} />Formulaires</button>}
      {role !== 'closer' && <button className={tab === 'leads' ? 'on' : ''} onClick={() => setTab('leads')}><span className="ico"><Ic d={<><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M17 6v6M20 9h-6" /></>} />{nLeads > 0 && <i className="dot">{nLeads > 9 ? '9+' : nLeads}</i>}</span>Relances</button>}
      <button className={tab === 'closing' ? 'on' : ''} onClick={() => setTab('closing')}><Ic d={<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>} />Closing</button>
      {role !== 'closer' && <button className={tab === 'dispos' ? 'on' : ''} onClick={() => setTab('dispos')}><Ic d={<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>} /><span className="lg">Disponibilités</span><span className="sm">Horaires</span></button>}
    </nav>
    {msg && <div className={`toast ${msg.bad ? 'bad' : ''}`}>{msg.t}</div>}
  </div>
}
