import { useState } from 'react'
import { supabase, configured } from '../lib/supabase'
import { friendlyError } from '../lib/data'

export default function Login() {
  const [email, setEmail] = useState('')
  const [pwd, setPwd] = useState('')
  const [mode, setMode] = useState('login') // login | signup
  const [msg, setMsg] = useState({ t: '', ok: false })
  const [busy, setBusy] = useState(false)

  const say = (t, ok = false) => setMsg({ t, ok })

  async function submit(e) {
    e.preventDefault(); if (busy) return
    const em = email.trim().toLowerCase()
    if (!em || !pwd) return say('Renseigne ton email et ton mot de passe.')
    setBusy(true)
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: em, password: pwd })
        if (error) throw error
      } else {
        if (pwd.length < 8) throw new Error('8 caractères minimum pour le mot de passe')
        const { error } = await supabase.auth.signUp({ email: em, password: pwd, options: { emailRedirectTo: window.location.origin } })
        if (error) throw error
        say('Compte créé. Si un email de confirmation arrive, clique dessus puis connecte-toi.', true)
      }
    } catch (err) {
      const m = friendlyError(err)
      say(/invalid login/i.test(m) ? 'Email ou mot de passe incorrect.' : /accès actif/i.test(m) ? "Cet email n'a pas d'accès actif. Vérifie ton abonnement ou écris-nous." : m)
    } finally { setBusy(false) }
  }

  async function magic() {
    const em = email.trim().toLowerCase()
    if (!em) return say("Entre ton email d'abord.")
    setBusy(true)
    const { error } = await supabase.auth.signInWithOtp({ email: em, options: { emailRedirectTo: window.location.origin, shouldCreateUser: true } })
    setBusy(false)
    if (error) return say(friendlyError(error))
    say(`Lien envoyé à ${em}. Ouvre-le sur ce téléphone.`, true)
  }

  return (
    <section className="login">
      <form className="card" onSubmit={submit}>
        <div className="logo"><i>E</i><b>Groupe <span>E-Connect</span></b></div>
        <h1>{mode === 'login' ? 'Connecte-toi à ton espace' : 'Crée ton accès'}</h1>
        <p>Réservé aux membres de la school. Ton accès s'active dès ton paiement.</p>
        {!configured && <div className="err">Configuration Supabase manquante (variables VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).</div>}
        <div className="field"><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="email" placeholder="toi@exemple.com" value={email} onChange={e => setEmail(e.target.value)} /></div>
        <div className="field"><label htmlFor="pwd">Mot de passe</label><input id="pwd" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="••••••••" value={pwd} onChange={e => setPwd(e.target.value)} /></div>
        <div className={`err ${msg.ok ? 'ok' : ''}`}>{msg.t}</div>
        <button className="btn" type="submit" disabled={busy || !configured}>{mode === 'login' ? 'Se connecter' : 'Créer mon accès'}</button>
        <button className="btn ghost" type="button" onClick={magic} disabled={busy || !configured}>Recevoir un lien de connexion par email</button>
        <div className="or">ou</div>
        <button className="btn ghost" type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); say('') }}>
          {mode === 'login' ? "Première connexion ? Crée ton mot de passe" : "J'ai déjà un compte"}
        </button>
        <div className="legal">Pas encore membre ? <a href="https://ecomeconnect.com" target="_blank" rel="noreferrer">Rejoindre la school</a></div>
      </form>
    </section>
  )
}
