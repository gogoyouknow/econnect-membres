import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import Logo from '../lib/Logo'
import { SITUATIONS, COACHING, BUDGETS, BUDGET_OK, CAPITAL } from './Leads'
import Booking from './Booking'

/** Page affichée juste après le paiement Stripe : /bienvenue?session_id=cs_…
 *  Une question par page. */
export default function LeadForm() {
  const sid = new URLSearchParams(location.search).get('session_id') || ''
  const [pre, setPre] = useState(null)
  const [f, setF] = useState({ email: '', first_name: '', last_name: '', phone: '', situation: '', wants_coaching: '', budget: '', has_capital: '' })
  const [i, setI] = useState(0)
  const [done, setDone] = useState(false)
  const [booked, setBooked] = useState(null)   // { when } une fois le rendez-vous pris
  const hot = f.wants_coaching === 'oui' && BUDGET_OK.includes(f.budget) && f.has_capital !== 'non'
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))

  useEffect(() => {
    if (!sid) return
    let n = 0, stop = false
    const tryLoad = async () => {   // le paiement peut arriver quelques secondes après la redirection
      const { data } = await supabase.rpc('lead_prefill', { p_session: sid })
      if (stop) return
      if (data) {
        setPre(data); if (data.done) setDone(true)
        const [first, ...rest] = String(data.name || '').trim().split(/\s+/)
        setF(x => ({ ...x, email: x.email || data.email || '', first_name: x.first_name || first || '', last_name: x.last_name || rest.join(' ') }))
      } else if (++n < 6) setTimeout(tryLoad, 1500)
    }
    tryLoad(); return () => { stop = true }
  }, [sid])

  const steps = [
    { k: 'situation', q: "C'est quoi ta situation aujourd'hui ?", opts: SITUATIONS },
    { k: 'wants_coaching', q: 'Tu aimerais être accompagné(e) ?', opts: COACHING },
    { k: 'budget', q: 'Combien peux-tu investir dans ton business aujourd\'hui ?', sub: 'Coche la case qui te correspond. Ça comprend la publicité (10 € par jour pour tester) et, si tu le souhaites, l\'accompagnement. Pas de bonne ou mauvaise réponse.', opts: BUDGETS.map(b => [b, b]) },
    { k: 'has_capital', q: 'Est-ce que tu as ce capital aujourd\'hui ?', sub: 'Sois honnête : le but, c\'est que personne ne perde son temps. Ta réponse ne change rien à ton accès.', opts: CAPITAL },
    { k: 'contact', q: 'Dernière étape : où te joindre ?' },
  ]
  const step = steps[i], total = steps.length

  async function submit(e) {
    e && e.preventDefault(); setErr('')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) return setErr('Vérifie ton email.')
    if (!f.first_name.trim()) return setErr('Ton prénom, au minimum.')
    setBusy(true)
    const { error } = await supabase.rpc('submit_lead', { p: { ...f, session_id: sid } })
    setBusy(false)
    if (error) return setErr(error.message.replace(/^.*?: /, ''))
    setDone(true); window.scrollTo(0, 0)
  }
  const pick = (k, v) => { set(k, v); setTimeout(() => setI(n => Math.min(n + 1, total - 1)), 180) }
  const knownName = !!(pre && pre.name)

  return <section className="leadpage"><div className="leadcard">
    <div className="leadhead"><Logo size={26} /><div className="paid">✓ Paiement validé</div></div>
    {done && hot && !booked ? <div className="lstep" key="book">
      <h1>{f.first_name ? `${f.first_name}, ` : ''}on s'appelle quand ?</h1>
      <p>Tu veux être accompagné(e) et tu as le budget : réserve un appel de 30 minutes avec moi dans les 48 h. On regarde ta situation et on voit si l'accompagnement est fait pour toi. Heure de Paris.</p>
      <Booking lead={{ email: f.email, name: `${f.first_name} ${f.last_name}`.trim(), phone: f.phone, session_id: sid }} onBooked={r => { setBooked(r); window.scrollTo(0, 0) }} />
      <button type="button" className="lback" onClick={() => setBooked({ skipped: true })}>Plus tard, je veux d'abord accéder à la formation ›</button>
    </div> : done ? <div className="lstep" key="done">
      {booked?.when && <div className="paid" style={{ marginBottom: 12 }}>📅 Appel confirmé : {booked.when}</div>}
      <h1>Merci{f.first_name ? ` ${f.first_name}` : ''}, c'est noté 🙌</h1>
      <p>Ton accès arrive par email dans quelques minutes{pre?.email || f.email ? <> à <b>{pre?.email || f.email}</b></> : null}. Tu peux aussi le créer tout de suite avec cette adresse.</p>
      <a className="btn big" href="/#signup">Créer mon accès à la formation</a>
      <p className="small muted">Pas d'email ? Regarde dans les spams ou les promotions. Toujours rien dans 10 minutes : contact@theambitiousman.fr</p>
    </div> : <>
      <div className="lprog"><i style={{ width: `${(i + 1) / total * 100}%` }} /></div>
      <div className="lcount">{i === 0 ? 'Bienvenue dans la Méthode E-Connect · ' : ''}Question {i + 1} sur {total}</div>
      <div className="lstep" key={i}>
        <h1>{step.q}</h1>
        {step.sub && <p>{step.sub}</p>}
        {step.opts && <div className="lchoices">{step.opts.map(([v, l]) => <button key={v} type="button" className={`lchoice ${f[step.k] === v ? 'on' : ''}`} onClick={() => pick(step.k, v)}><i>{f[step.k] === v ? '✓' : ''}</i>{l}</button>)}</div>}
        {step.k === 'contact' && <form onSubmit={submit} className="lform">
          {knownName ? <div className="known">Prénom et nom : <b>{f.first_name} {f.last_name}</b> <button type="button" className="linkbtn" onClick={() => setPre({ ...pre, name: '' })}>modifier</button></div>
            : <div className="grid2"><div><label className="lq">Prénom</label><input required value={f.first_name} onChange={e => set('first_name', e.target.value)} autoComplete="given-name" /></div><div><label className="lq">Nom</label><input value={f.last_name} onChange={e => set('last_name', e.target.value)} autoComplete="family-name" /></div></div>}
          <label className="lq">Ton email</label>
          <input type="email" required value={f.email} onChange={e => set('email', e.target.value)} placeholder="ton@email.com" autoComplete="email" />
          <label className="lq">Ton numéro WhatsApp</label>
          <input type="tel" value={f.phone} onChange={e => set('phone', e.target.value)} placeholder="+33 6 12 34 56 78" autoComplete="tel" />
          {err && <div className="err">{err}</div>}
          <button className="btn big" disabled={busy}>{busy ? 'Envoi…' : 'Valider et accéder à ma formation'}</button>
          <p className="small muted">Tes réponses restent entre nous.</p>
        </form>}
      </div>
      {i > 0 && <button type="button" className="lback" onClick={() => setI(i - 1)}>‹ Retour</button>}
    </>}
  </div></section>
}
