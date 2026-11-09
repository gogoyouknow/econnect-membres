import { useEffect, useMemo, useState } from 'react'
import { rpc, configured } from './api'

const TZ = 'Europe/Paris'
const CAPS = [['lt500', 'Moins de 500 €'], ['500-1000', 'Entre 500 € et 1 000 €'], ['1000-3000', 'Entre 1 000 € et 3 000 €'], ['gt3000', 'Plus de 3 000 €']]
const CAP_LBL = { '500-1000': 'entre 500 € et 1 000 €', '1000-3000': 'entre 1 000 € et 3 000 €', gt3000: 'plus de 3 000 €' }
const SITUS = ['Salarié', 'Étudiant', 'Entrepreneur', 'Sans activité']
const PREFIX = ['+33', '+32', '+41', '+352', '+212', '+213', '+216', '+351', '+40', '+1']
const dayKey = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso))
const fmtT = (iso) => new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
const fmtDay = (k) => { const d = new Date(k + 'T12:00:00Z'); return { w: new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'short' }).format(d), n: d.getUTCDate() } }

const sid = (() => {
  try { let v = localStorage.getItem('cand_sid'); if (!v) { v = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)); localStorage.setItem('cand_sid', v) } return v } catch { return 'mem-' + Date.now() + Math.random().toString(16).slice(2) }
})()

export default function App() {
  const [step, setStep] = useState('intro')
  const [f, setF] = useState({ first_name: '', prefix: '+33', tel: '', email: '', situation: '', capital: '', have: '' })
  const [err, setErr] = useState('')
  const [cfg, setCfg] = useState({ slot_min: 45, wa: '33756842921', release_hours: 4 })
  const [slots, setSlots] = useState(null)
  const [day, setDay] = useState('')
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const go = (s) => { setErr(''); setStep(s); window.scrollTo(0, 0) }
  // Sauvegarde silencieuse de ce que la personne a déjà saisi (pour pouvoir la relancer si elle ne réserve pas)
  const saveLead = (stp, over = {}) => { if (!configured) return; const g = { ...f, ...over }; rpc('cand_lead', { p: { sid, step: stp, first_name: g.first_name.trim(), phone: g.tel.replace(/\D/g, '').length >= 8 ? g.prefix + g.tel.replace(/\D/g, '').replace(/^0+/, '') : '', email: g.email.trim(), situation: g.situation, capital: g.capital, budget_confirmed: g.have } }).catch(() => {}) }
  const n = { who: 1, situ: 2, block: 2, budget: 3, block2: 3, slot: 4 }[step] || 0

  useEffect(() => { if (configured) rpc('cand_config').then(setCfg).catch(() => {}) }, [])
  const loadSlots = () => rpc('cand_slots').then((s) => setSlots(s || [])).catch(() => setSlots([]))
  useEffect(() => { if (step === 'slot') { loadSlots(); saveLead('slot') } }, [step])
  const days = useMemo(() => { const m = new Map(); (slots || []).forEach((s) => { const k = dayKey(s); if (!m.has(k)) m.set(k, []); m.get(k).push(s) }); return [...m.entries()] }, [slots])
  useEffect(() => { if (days.length && !days.find((d) => d[0] === day)) setDay(days[0][0]) }, [days])

  const next = {
    who() {
      const digits = f.tel.replace(/\D/g, '').replace(/^0+/, '')
      if (!f.first_name.trim()) return setErr('Indique ton prénom.')
      if (digits.length < 8 || digits.length > 12) return setErr('Vérifie ton numéro WhatsApp, il semble incomplet.')
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(f.email.trim())) return setErr('Vérifie ton adresse email.')
      saveLead('who'); go('situ')
    },
    situ() {
      if (!f.situation || !f.capital) return setErr('Réponds aux deux questions pour continuer.')
      saveLead('situ'); go(f.capital === 'lt500' ? 'block' : 'budget')
    },
    budget() {
      if (!f.have) return setErr('Choisis une réponse pour continuer.')
      saveLead('budget'); go(f.have === 'yes' ? 'slot' : 'block2')
    },
  }
  async function book() {
    setBusy(true); setErr('')
    try {
      const r = await rpc('cand_book', { p: { first_name: f.first_name.trim(), phone: f.prefix + f.tel.replace(/\D/g, '').replace(/^0+/, ''), email: f.email.trim(), situation: f.situation, capital: f.capital, budget_confirmed: f.have, starts_at: pick } })
      setDone(r); go('done')
    } catch (e) { setErr(e.message || 'La réservation a échoué.'); setPick(''); loadSlots() }
    setBusy(false)
  }
  const jour = (iso) => new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, weekday: 'long' }).format(new Date(iso))
  const waMsg = done ? `Salut Clément, c’est ${f.first_name.trim()}. Je viens de réserver mon appel pour ${jour(done.starts_at)} à ${fmtT(done.starts_at).replace(':', 'h')}.` : ''
  const waNum = (done?.wa || cfg.wa)
  const copy = () => { try { navigator.clipboard.writeText('+' + waNum) } catch {} }
  const cur = days.find((d) => d[0] === day)

  return <div className="shell">
    <header><div className="logo"><svg viewBox="0 0 28 28" fill="none" aria-hidden="true"><rect x="2" y="2" width="24" height="24" rx="6" stroke="#e9c53e" strokeWidth="2.4" /><path d="M9 19L19 9M11 9h8v8" stroke="#e9c53e" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>L'Accélérateur</div></header>
    {n > 0 && <div className="progress">{[1, 2, 3, 4].map((i) => <i key={i} className={i <= n ? 'on' : ''} />)}</div>}

    {step === 'intro' && <section className="screen">
      <div className="col"><span className="eyebrow">Appel diagnostic · {cfg.slot_min} minutes</span>
        <h1>Tu veux te lancer, mais tu ne sais pas par où commencer ?</h1>
        <p>Réserve un appel avec moi. On regarde ta situation et je te dis franchement si je peux t'aider.</p></div>
      <div className="quotes"><span className="lbl muted">Ce que j'entends le plus souvent</span>
        <q>« Je tourne en rond depuis des mois. »</q><q>« J'ai déjà payé des formations qui n'ont rien donné. »</q><q>« Je veux sortir du métro, boulot, dodo. »</q></div>
      <div className="card"><div className="steps">
        <div><span>1</span><p><b>On fait le point.</b> Où tu en es, ce qui te bloque, ce que tu veux.</p></div>
        <div><span>2</span><p><b>Je te dis ce que je ferais à ta place.</b></p></div>
        <div><span>3</span><p><b>Si je peux t'aider, on en parle.</b> Sinon, je te le dis.</p></div></div>
        <button className="btn" onClick={() => go('who')}>Je réserve mon appel →</button>
        <p className="note c">3 questions · moins d'une minute</p></div>
      <p className="note filter">Je réponds aux personnes prêtes à passer à l'action et à investir dans leur projet. Si ce n'est pas encore ton cas, ne réserve pas : on perdrait du temps tous les deux.</p>
    </section>}

    {step === 'who' && <section className="screen"><h2>Comment je t'appelle ?</h2><div className="card">
      <div className="field"><label htmlFor="p">Prénom</label><input id="p" value={f.first_name} onChange={(e) => set('first_name', e.target.value)} autoComplete="given-name" placeholder="Ton prénom" /></div>
      <div className="field"><label htmlFor="t">Numéro WhatsApp</label><div className="phone">
        <select value={f.prefix} onChange={(e) => set('prefix', e.target.value)} aria-label="Indicatif">{PREFIX.map((p) => <option key={p}>{p}</option>)}</select>
        <input id="t" type="tel" inputMode="tel" autoComplete="tel-national" value={f.tel} onChange={(e) => set('tel', e.target.value)} onBlur={() => saveLead('who')} placeholder="6 12 34 56 78" /></div>
        <span className="muted s12">Je t'appelle sur ce numéro, vérifie-le bien.</span></div>
      <div className="field"><label htmlFor="e">Email</label><input id="e" type="email" autoComplete="email" value={f.email} onChange={(e) => set('email', e.target.value)} onBlur={() => saveLead('who')} placeholder="ton@email.com" /></div>
      <div className="err">{err}</div><button className="btn" onClick={next.who}>Continuer →</button></div></section>}

    {step === 'situ' && <section className="screen"><h2>Ta situation</h2><div className="card">
      <div className="field"><span className="lbl">Que fais-tu dans la vie ?</span><div className="chips">{SITUS.map((s) => <button key={s} className={`chip ${f.situation === s ? 'sel' : ''}`} onClick={() => { set('situation', s); saveLead('situ', { situation: s }) }}>{s}</button>)}</div></div>
      <div className="field"><span className="lbl">Combien peux-tu investir maintenant dans ton projet ?</span><div className="chips col">{CAPS.map(([v, l]) => <button key={v} className={`chip ${f.capital === v ? 'sel' : ''}`} onClick={() => { set('capital', v); saveLead('situ', { capital: v }) }}>{l}</button>)}</div></div>
      <div className="err">{err}</div><button className="btn" onClick={next.situ}>Continuer →</button></div>
      <button className="link" onClick={() => go('who')}>← Retour</button></section>}

    {step === 'block' && <section className="screen"><h2>Ce n'est pas le bon moment</h2><div className="card">
      <p>Avec moins de 500 € disponibles, je ne peux pas t'accompagner correctement et je ne veux pas te faire perdre ton temps.</p>
      <p className="muted">Reviens dès que tu as de quoi investir, ou suis mes contenus en attendant.</p></div>
      <button className="link" onClick={() => go('situ')}>← Modifier ma réponse</button></section>}

    {step === 'budget' && <section className="screen"><h2>Une dernière question, franche</h2><div className="card">
      <p>Tu as indiqué <b>{CAP_LBL[f.capital]}</b>. Beaucoup de personnes cochent un montant qu'elles n'ont pas encore, et on perd du temps tous les deux.</p>
      <div className="field"><span className="lbl">Tu peux vraiment mobiliser ce budget maintenant ?</span><div className="chips col">
        {[['yes', 'Oui, je l\'ai disponible maintenant'], ['soon', 'Pas encore, il me faut quelques semaines'], ['no', 'Non, je ne l\'ai pas']].map(([v, l]) => <button key={v} className={`chip ${f.have === v ? 'sel' : ''}`} onClick={() => { set('have', v); saveLead('budget', { have: v }) }}>{l}</button>)}</div></div>
      <p className="muted s13">Sois honnête, ça m'aide à te dire la vérité.</p>
      <div className="err">{err}</div><button className="btn" onClick={next.budget}>Choisir mon créneau →</button></div>
      <button className="link" onClick={() => go('situ')}>← Retour</button></section>}

    {step === 'block2' && <section className="screen"><h2>Reviens quand ce sera le bon moment</h2><div className="card">
      <p>Sans budget disponible, un appel ne te servirait à rien : je ne pourrais pas t'accompagner correctement.</p>
      <p className="muted">Dès que tu peux investir, reviens réserver. En attendant, continue de suivre mes contenus.</p></div>
      <button className="link" onClick={() => go('budget')}>← Modifier ma réponse</button></section>}

    {step === 'slot' && <section className="screen"><h2>Choisis ton créneau</h2><div className="card">
      {slots === null && <p className="muted">Je regarde mes disponibilités…</p>}
      {slots && !days.length && <p className="muted">Aucun créneau libre pour le moment. Reviens bientôt.</p>}
      {!!days.length && <><div className="days">{days.map(([k]) => { const d = fmtDay(k); return <button key={k} className={`day ${k === day ? 'sel' : ''}`} onClick={() => { setDay(k); setPick('') }}>{d.w}<b>{d.n}</b></button> })}</div>
        <div className="slots">{(cur?.[1] || []).map((s) => <button key={s} className={`slot ${pick === s ? 'sel' : ''}`} onClick={() => setPick(s)}>{fmtT(s)}</button>)}</div></>}
      <p className="note">Heure de Paris · appel de {cfg.slot_min} minutes</p>
      <div className="err">{err}</div>
      <button className="btn" disabled={!pick || busy} onClick={book}>{busy ? 'Réservation…' : 'Confirmer ce créneau'}</button></div>
      <button className="link" onClick={() => go('budget')}>← Retour</button></section>}

    {step === 'done' && done && <section className="screen">
      <div className="col"><span className="eyebrow">Étape 1 sur 2 faite</span><h2>Ton appel n'est pas encore confirmé</h2></div>
      <div className="recap"><span className="muted s12">Créneau réservé</span><b>{done.when.replace(' à ', ' · ')}</b></div>
      <div className="card"><div className="steps">
        <div><span className="ok">✓</span><p><b>Créneau réservé</b></p></div>
        <div><span>2</span><div><p><b>Envoie-moi ce message sur WhatsApp</b></p><p className="muted s13">C'est ce qui confirme ta place. Je t'appelle dans les 5 minutes.</p></div></div></div>
        <div className="msg">{waMsg}</div>
        <a className="btn wa" href={`https://wa.me/${waNum}?text=${encodeURIComponent(waMsg)}`} target="_blank" rel="noopener noreferrer">Envoyer sur WhatsApp</a>
        <div className="copyrow">Le bouton ne s'ouvre pas ? Écris-moi au <code>+{waNum}</code> <button className="ghost" onClick={copy}>Copier</button></div>
        <p className="note">Sans message dans les {done.release_hours} heures, je libère ton créneau pour quelqu'un d'autre.</p></div></section>}
    {!configured && <p className="err">Configuration manquante (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).</p>}
  </div>
}
