import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import Logo from '../lib/Logo'
import { GOALS, COACHING, BUDGETS } from './Leads'

/** Page affichée juste après le paiement Stripe : /bienvenue?session_id=cs_… */
export default function LeadForm() {
  const sid = new URLSearchParams(location.search).get('session_id') || ''
  const [pre, setPre] = useState(null)        // infos du paiement
  const [f, setF] = useState({ email: '', first_name: '', last_name: '', phone: '', goals: [], goals_text: '', wants_coaching: '', budget: '' })
  const [step, setStep] = useState('form')    // form | done
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))

  useEffect(() => {
    if (!sid) return
    let n = 0, stop = false
    const tryLoad = async () => {   // le paiement peut arriver quelques secondes après la redirection
      const { data } = await supabase.rpc('lead_prefill', { p_session: sid })
      if (stop) return
      if (data) {
        setPre(data); if (data.done) setStep('done')
        const [first, ...rest] = String(data.name || '').trim().split(/\s+/)
        setF(x => ({ ...x, email: x.email || data.email || '', first_name: x.first_name || first || '', last_name: x.last_name || rest.join(' ') }))
      } else if (++n < 6) setTimeout(tryLoad, 1500)
    }
    tryLoad(); return () => { stop = true }
  }, [sid])

  const knownName = !!(pre && pre.name)
  async function submit(e) {
    e.preventDefault(); setErr('')
    if (!f.wants_coaching || !f.budget) return setErr('Réponds aux deux dernières questions, ça prend 5 secondes.')
    setBusy(true)
    const { error } = await supabase.rpc('submit_lead', { p: { ...f, session_id: sid } })
    setBusy(false)
    if (error) return setErr(error.message.replace(/^.*?: /, ''))
    setStep('done'); window.scrollTo(0, 0)
  }

  const Choice = ({ k, v, label, multi }) => {
    const on = multi ? f[k].includes(v) : f[k] === v
    return <button type="button" className={`lchoice ${on ? 'on' : ''}`} onClick={() => multi ? set(k, on ? f[k].filter(x => x !== v) : [...f[k], v]) : set(k, v)}><i>{on ? '✓' : ''}</i>{label || v}</button>
  }

  return <section className="leadpage"><div className="leadcard">
    <Logo size={30} />
    <div className="paid">✓ Paiement validé{pre?.offer ? ` · ${pre.offer.split(' · ')[0]}` : ''}</div>
    {step === 'done' ? <>
      <h1>C'est noté, merci{f.first_name ? ` ${f.first_name}` : ''} 🙌</h1>
      <p>Ton accès arrive par email dans quelques minutes{pre?.email || f.email ? <> à <b>{pre?.email || f.email}</b></> : null}. Clique sur « Créer mon accès » dans l'email, choisis ton mot de passe, et commence par le module 1.</p>
      <a className="btn" href="/#signup">Créer mon accès maintenant</a>
      <p className="small muted">Pas d'email ? Regarde dans les spams ou les promotions. Toujours rien dans 10 minutes, écris à contact@theambitiousman.fr.</p>
    </> : <form onSubmit={submit}>
      <h1>Bienvenue dans la Méthode E-Connect</h1>
      <p>Ton accès arrive par email. En attendant, prends 1 minute pour me dire où tu en es : ça m'aide à te proposer la bonne suite.</p>

      <label className="lq">Ton email</label>
      <input type="email" required value={f.email} onChange={e => set('email', e.target.value)} placeholder="ton@email.com" />
      {knownName ? <div className="known">Prénom et nom : <b>{f.first_name} {f.last_name}</b> <button type="button" className="linkbtn" onClick={() => setPre({ ...pre, name: '' })}>modifier</button></div>
        : <div className="grid2"><div><label className="lq">Prénom</label><input required value={f.first_name} onChange={e => set('first_name', e.target.value)} /></div><div><label className="lq">Nom</label><input value={f.last_name} onChange={e => set('last_name', e.target.value)} /></div></div>}
      <label className="lq">Ton numéro WhatsApp <span>(pour te répondre si tu as une question)</span></label>
      <input type="tel" value={f.phone} onChange={e => set('phone', e.target.value)} placeholder="+33 6 12 34 56 78" />

      <label className="lq">Qu'est-ce que tu veux obtenir ? <span>(plusieurs choix possibles)</span></label>
      <div className="lchoices">{GOALS.map(g => <Choice key={g} k="goals" v={g} multi />)}</div>
      <textarea rows={2} value={f.goals_text} onChange={e => set('goals_text', e.target.value)} placeholder="Dis-m'en plus si tu veux (où tu en es, ce qui te bloque…)" />

      <label className="lq">Tu aimerais être accompagné ?</label>
      <div className="lchoices">{COACHING.map(([v, l]) => <Choice key={v} k="wants_coaching" v={v} label={l} />)}</div>

      <label className="lq">Quel budget tu peux mettre dans ton projet ? <span>(publicité, outils, accompagnement)</span></label>
      <div className="lchoices">{BUDGETS.map(b => <Choice key={b} k="budget" v={b} />)}</div>

      {err && <div className="err">{err}</div>}
      <button className="btn big" disabled={busy}>{busy ? 'Envoi…' : 'Envoyer et accéder à ma formation'}</button>
      <p className="small muted">Tes réponses restent entre nous, elles ne sont jamais partagées.</p>
    </form>}
  </div></section>
}
