import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import Logo from '../lib/Logo'
import { SITUATIONS, COACHING, BUDGETS, CAPITAL } from './Leads'
import { SlotPicker, agenda, fmtDay, fmtHour } from './Booking'

/** Page affichée juste après le paiement Stripe : /bienvenue?session_id=cs_…
 *  Une question par page. */
export default function LeadForm() {
  const sid = new URLSearchParams(location.search).get('session_id') || ''
  const [pre, setPre] = useState(null)
  const [f, setF] = useState({ email: '', first_name: '', last_name: '', phone: '', situation: '', wants_coaching: '', budget: '', has_capital: '' })
  const [i, setI] = useState(0)
  const [done, setDone] = useState(false)
  const [booking, setBooking] = useState(false)   // étape « réserve ton appel » (prospects chauds)
  const [booked, setBooked] = useState(null)
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
    { k: 'budget', q: 'Quel budget peux-tu mettre dans ton projet aujourd\'hui ?', sub: 'Publicité ou accompagnement.', opts: BUDGETS.map(b => [b, b]) },
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
    if (f.wants_coaching === 'oui' && f.has_capital === 'oui') setBooking(true); else setDone(true)
    window.scrollTo(0, 0)
  }
  const pick = (k, v) => { set(k, v); setTimeout(() => setI(n => Math.min(n + 1, total - 1)), 180) }
  const knownName = !!(pre && pre.name)

  return <section className="leadpage"><div className="leadcard">
    <div className="leadhead"><Logo size={26} /><div className="paid">✓ Paiement validé</div></div>
    {booking && !done ? <div className="lstep" key="booking">
      <h1>Réserve ton appel avec nous</h1>
      <p>30 minutes en visio pour faire le point sur ton projet et voir si l'accompagnement est fait pour toi. Choisis le moment qui t'arrange.</p>
      <SlotPicker onBook={async (s) => { const r = await agenda({ action: 'book', session_id: sid, start: s }); setBooked(r); setDone(true); window.scrollTo(0, 0) }} />
      <button type="button" className="lback" onClick={() => setDone(true)}>Je préfère qu'on me recontacte</button>
    </div> : done && booked ? <div className="lstep" key="booked">
      <h1>C'est calé{f.first_name ? `, ${f.first_name}` : ''} ✅</h1>
      <p>Rendez-vous <b>{fmtDay(booked.starts_at)} à {fmtHour(booked.starts_at)}</b>{booked.host ? ` avec ${booked.host}` : ''}. Tu viens de recevoir la confirmation et l'invitation par email.</p>
      <p>Ton accès à la formation arrive aussi par email. Tu peux le créer tout de suite :</p>
      <a className="btn big" href="/#signup">Créer mon accès à la formation</a>
    </div> : done ? <div className="lstep" key="done">
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
