import { useEffect, useState } from 'react'
import { supabase, configured } from '../lib/supabase'
import { friendlyError } from '../lib/data'
import Logo from '../lib/Logo'

/**
 * Écrans : login | signup | code (6 chiffres) | forgot | reset (nouveau mot de passe)
 * Le mode "reset" s'ouvre tout seul quand on arrive depuis le lien de l'email.
 */
export default function Login() {
  const [email, setEmail] = useState('')
  const [pwd, setPwd] = useState('')
  const [code, setCode] = useState('')
  const [mode, setMode] = useState('login')
  const [msg, setMsg] = useState({ t: '', ok: false })
  const [busy, setBusy] = useState(false)
  const say = (t, ok = false) => setMsg({ t, ok })
  const switchTo = (m) => { setMode(m); say('') }

  useEffect(() => {
    if (!configured) return
    const { data: sub } = supabase.auth.onAuthStateChange((event) => { if (event === 'PASSWORD_RECOVERY') setMode('reset') })
    if (location.hash.includes('type=recovery')) setMode('reset')
    return () => sub.subscription.unsubscribe()
  }, [])

  const nice = (err) => {
    const m = friendlyError(err)
    if (/invalid login/i.test(m)) return 'Email ou mot de passe incorrect.'
    if (/accès actif/i.test(m)) return "Cet email n'a pas d'accès actif. Vérifie ton abonnement ou écris-nous."
    if (/already registered/i.test(m)) return 'Ce compte existe déjà. Connecte-toi, ou utilise « Mot de passe oublié ».'
    if (/token has expired|invalid/i.test(m) && mode === 'code') return 'Code incorrect ou expiré. Demande un nouveau code.'
    if (/rate limit|security purposes/i.test(m)) return 'Trop de tentatives. Attends une minute et réessaie.'
    return m
  }

  async function submit(e) {
    e.preventDefault(); if (busy) return
    const em = email.trim().toLowerCase()
    setBusy(true)
    try {
      if (mode === 'login') {
        if (!em || !pwd) throw new Error('Renseigne ton email et ton mot de passe.')
        const { error } = await supabase.auth.signInWithPassword({ email: em, password: pwd }); if (error) throw error
      } else if (mode === 'signup') {
        if (!em || !pwd) throw new Error('Renseigne ton email et un mot de passe.')
        if (pwd.length < 8) throw new Error('8 caractères minimum pour le mot de passe.')
        const { data, error } = await supabase.auth.signUp({ email: em, password: pwd, options: { emailRedirectTo: window.location.origin } }); if (error) throw error
        if (data.session) return // confirmation désactivée côté Supabase : connecté directement
        switchTo('code'); say(`Code envoyé à ${em}. Regarde aussi tes spams.`, true)
      } else if (mode === 'code') {
        if (code.replace(/\D/g, '').length < 6) throw new Error('Entre les 6 chiffres du code.')
        const { error } = await supabase.auth.verifyOtp({ email: em, token: code.replace(/\D/g, ''), type: 'signup' }); if (error) throw error
      } else if (mode === 'forgot') {
        if (!em) throw new Error("Entre ton email d'abord.")
        const { error } = await supabase.auth.resetPasswordForEmail(em, { redirectTo: window.location.origin + '/#reset' }); if (error) throw error
        say(`Email envoyé à ${em}. Clique sur le lien pour choisir un nouveau mot de passe.`, true)
      } else if (mode === 'reset') {
        if (pwd.length < 8) throw new Error('8 caractères minimum pour le mot de passe.')
        const { error } = await supabase.auth.updateUser({ password: pwd }); if (error) throw error
        say('Mot de passe changé. Tu es connecté.', true); history.replaceState(null, '', '/')
      }
    } catch (err) { say(nice(err)) } finally { setBusy(false) }
  }

  async function resend() {
    const em = email.trim().toLowerCase(); if (!em) return say("Entre ton email d'abord.")
    setBusy(true); const { error } = await supabase.auth.resend({ type: 'signup', email: em }); setBusy(false)
    say(error ? nice(error) : `Nouveau code envoyé à ${em}.`, !error)
  }

  const titles = { login: 'Connecte-toi à ton espace', signup: 'Crée ton accès', code: 'Entre ton code', forgot: 'Mot de passe oublié', reset: 'Choisis un nouveau mot de passe' }
  const subs = {
    login: "Réservé aux membres de L'Accélérateur. Ton accès s'active dès ton paiement.",
    signup: "Utilise l'email avec lequel tu as payé. Tu recevras un code à 6 chiffres.",
    code: `On t'a envoyé un code à 6 chiffres par email. Il est valable 10 minutes.`,
    forgot: "Entre ton email, on t'envoie un lien pour en choisir un nouveau.",
    reset: '8 caractères minimum. Tu seras connecté juste après.',
  }

  return (
    <section className="login">
      <form className="card" onSubmit={submit}>
        <Logo size={34} />
        <h1>{titles[mode]}</h1>
        <p>{subs[mode]}</p>
        {!configured && <div className="err">Configuration Supabase manquante.</div>}

        {mode !== 'reset' && mode !== 'code' && <div className="field"><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="email" inputMode="email" placeholder="toi@exemple.com" value={email} onChange={e => setEmail(e.target.value)} /></div>}
        {(mode === 'login' || mode === 'signup' || mode === 'reset') && <div className="field"><label htmlFor="pwd">{mode === 'reset' ? 'Nouveau mot de passe' : 'Mot de passe'}</label><input id="pwd" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="••••••••" value={pwd} onChange={e => setPwd(e.target.value)} /></div>}
        {mode === 'code' && <div className="field"><label htmlFor="code">Code</label><input id="code" className="otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} placeholder="000 000" value={code} onChange={e => setCode(e.target.value.replace(/[^\d ]/g, ''))} autoFocus /></div>}

        <div className={`err ${msg.ok ? 'ok' : ''}`}>{msg.t}</div>

        <button className="btn" type="submit" disabled={busy || !configured}>
          {{ login: 'Se connecter', signup: 'Créer mon accès', code: 'Valider', forgot: 'Envoyer le lien', reset: 'Enregistrer' }[mode]}
        </button>

        {mode === 'login' && <>
          <button className="btn ghost" type="button" onClick={() => switchTo('forgot')}>Mot de passe oublié</button>
          <div className="or">ou</div>
          <button className="btn ghost" type="button" onClick={() => switchTo('signup')}>Première connexion ? Crée ton mot de passe</button>
        </>}
        {mode === 'signup' && <button className="btn ghost" type="button" onClick={() => switchTo('login')}>J'ai déjà un compte</button>}
        {mode === 'code' && <>
          <button className="btn ghost" type="button" onClick={resend} disabled={busy}>Renvoyer le code</button>
          <button className="btn ghost" type="button" onClick={() => switchTo('signup')}>Changer d'email</button>
        </>}
        {mode === 'forgot' && <button className="btn ghost" type="button" onClick={() => switchTo('login')}>Retour</button>}

        {mode !== 'reset' && <div className="legal">Pas encore membre ? <a href="https://ecomeconnect.com" target="_blank" rel="noreferrer">Rejoindre L'Accélérateur</a></div>}
      </form>
    </section>
  )
}
