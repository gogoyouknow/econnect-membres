import { openChat } from './openchat'
import { mailProblem, mailShape } from './mailcheck'
import { useEffect, useMemo, useRef, useState } from 'react'
import { rpc, configured } from './api'
import Logo from './Logo'
import { TEMOS, Thumb } from './videos'
import Vidalytics from './Vidalytics'

const TZ = 'Europe/Paris'
// Avec QUI l'appel : lien ?closer_id=clement (ou rien) → Clément ; ?closer_id=amandine / 9512 / assigned_to=amandine → Amandine. Même règle que l'ancienne page de confirmation.
const QS = new URLSearchParams(typeof location !== 'undefined' ? location.search : '')
const gq = (k) => (QS.get(k) || '').trim().toLowerCase()
// Lien personnel d'un closer (?closer_id=amandine) = imposé. Sinon c'est la répartition de l'événement (règles par profil, priorités) qui décide, au moment de la réservation.
const FORCED = (() => { const c = gq('closer_id'); if (c === '9512') return 'amandine'; if (/^[a-z0-9-]{2,30}$/.test(c)) return c; return (gq('assigned_to').includes('amandine') || gq('utm_campaign').includes('amandine')) ? 'amandine' : '' })()
const CLOSER = FORCED || 'clement'
// Événement personnalisé : rdv.theambitiousman.fr/e/mon-lien
const EVENT = (() => { try { const m = location.pathname.toLowerCase().match(/^\/e\/([a-z0-9-]{2,60})\/?$/); return m ? m[1] : '' } catch { return '' } })()
const CLOSER_NAME = { clement: 'Clément', amandine: 'Amandine' }[CLOSER]
const WA_DEF = { clement: '33756849421', amandine: '33763850319' }[CLOSER]
const CAPS = [['lt500', 'Moins de 500 €'], ['500-1000', 'Entre 500 € et 1 000 €'], ['1000-3000', 'Entre 1 000 € et 3 000 €'], ['gt3000', 'Plus de 3 000 €']]
const CAP_LBL = { '500-1000': 'entre 500 € et 1 000 €', '1000-3000': 'entre 1 000 € et 3 000 €', gt3000: 'plus de 3 000 €' }
const SITUS = ['Salarié', 'Étudiant', 'Entrepreneur', 'Sans activité']
const EXPS = ['Jamais vendu en ligne', 'Quelques ventes', 'Boutique active']
const MIN_TXT = 40
const INVS = ['Non, jamais', 'Oui, une fois', 'Oui, plusieurs fois']
// Lien de test (?test=1) : nouveau parcours, mais RIEN n'est enregistré (ni fiche, ni rendez-vous, ni email).
const TEST = (() => { try { const q = new URLSearchParams(location.search).get('test'); if (q === '1') sessionStorage.setItem('cand_test', '1'); if (q === '0') sessionStorage.removeItem('cand_test'); return sessionStorage.getItem('cand_test') === '1' } catch { return false } })()
const NEW = TEST // le nouveau parcours : testé d'abord, puis activé pour tout le monde
const rpcW = (n, a) => (TEST ? Promise.resolve(null) : rpc(n, a))
const PREFIX = ['+33', '+32', '+41', '+352', '+212', '+213', '+216', '+351', '+40', '+1']
// Numéro saisi « comme on veut » : +33 6…, 0033 6…, 33 6… ou 06… → on retrouve l'indicatif et les chiffres du numéro, sans doublon d'indicatif.
const splitTel = (prefix, tel) => {
  let d = String(tel || '').replace(/[^\d+]/g, ''); if (d.startsWith('00')) d = '+' + d.slice(2)
  if (d.startsWith('+')) {
    const pd = d.slice(1).replace(/\D/g, ''); const m = PREFIX.map((x) => x.slice(1)).sort((a, b) => b.length - a.length).find((x) => pd.startsWith(x))
    if (m) return ['+' + m, pd.slice(m.length).replace(/^0+/, '')]
    if (AF_BLOCK.test('+' + pd)) return ['+' + pd.slice(0, 3), pd.slice(3)] // numéro d'un pays non proposé : on garde l'indicatif tel quel (et le 0 éventuel) pour pouvoir l'écarter
    return [prefix, pd.replace(/^0+/, '')]
  }
  d = d.replace(/\D/g, ''); const pp = prefix.slice(1)
  if (prefix === '+33' && d.startsWith(pp) && d.length === pp.length + 9) d = d.slice(pp.length)
  return [prefix, d.replace(/^0+/, '')]
}
// Numéro réellement utilisé pour te joindre sur WhatsApp : le numéro principal, ou celui indiqué si le principal n'est pas sur WhatsApp.
const effTel = (g) => (g.wa_ok === false && String(g.wtel || '').trim() ? splitTel(g.wprefix, g.wtel) : splitTel(g.prefix, g.tel))
let PV = null // validateur de numéros de mobile (chargé à la demande, ne ralentit pas la page)
const loadPV = () => PV ? Promise.resolve(PV) : import('libphonenumber-js/mobile').then((m) => (PV = m)).catch(() => null)
// Numéro fixe français (01 à 05) : pas de WhatsApp possible.
const isFixe = (prefix, tel) => { const [pf, d] = splitTel(prefix, tel); return pf === '+33' && /^[1-5]/.test(String(d)) }
// Afrique subsaharienne (hors Maghreb, Égypte, Afrique du Sud, La Réunion / Mayotte) : pas d'appel possible, on le dit honnêtement.
const AF_BLOCK = /^\+(?:22[1-9]|23[1-9]|24\d|25\d|26[013-9]|211)/
const intlOf = (prefix, tel) => { const raw = String(tel || '').replace(/[^\d+]/g, ''); const d = raw.startsWith('00') ? '+' + raw.slice(2) : raw; const p = String(prefix || ''); return d.startsWith('+') ? d : p + (AF_BLOCK.test(p + '000') ? d : d.replace(/^0+/, '')) }
const geoBlocked = (g) => AF_BLOCK.test(intlOf(g.prefix, g.tel)) || (g.wa_ok === false && AF_BLOCK.test(intlOf(g.wprefix, g.wtel)))
const telOk = (prefix, tel) => { const [pf, d] = splitTel(prefix, tel); if (d.length < 6) return false; if (isFixe(prefix, tel)) return String(d).length === 9; if (PV) { try { return PV.isValidPhoneNumber(pf + d) } catch { /* */ } } return d.length >= 8 && d.length <= 12 }
const dayKey = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso))
const fmtT = (iso) => new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
const fmtDay = (k) => { const d = new Date(k + 'T12:00:00Z'); return { w: new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'short' }).format(d), n: d.getUTCDate() } }

// D'où vient la personne (TikTok, Instagram…) : on le mémorise à la 1ère visite et on l'envoie avec la fiche.
const SRC = (() => {
  try {
    const k = 'cand_src'; const old = localStorage.getItem(k); if (old) return JSON.parse(old)
    const q = new URLSearchParams(location.search); const utm = {}
    ;['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ttclid', 'fbclid', 'src'].forEach((x) => { const v = q.get(x); if (v) utm[x.replace('utm_', '')] = v.slice(0, 100) })
    let ref = ''; try { ref = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : '' } catch { /* */ }
    if (/theambitiousman\.fr$|vercel\.app$/.test(ref)) ref = ''
    const h = String(utm.source || utm.src || ref).toLowerCase()
    const source = utm.ttclid || /tiktok|^tt$/.test(h) ? 'TikTok' : /instagram|^ig$/.test(h) ? 'Instagram' : /youtu/.test(h) ? 'YouTube' : utm.fbclid || /facebook|^fb$|meta/.test(h) ? 'Facebook' : /^t\.co$|twitter|^x$/.test(h) ? 'X' : h ? (utm.source || utm.src || ref).slice(0, 40) : 'Direct'
    const v = { source, utm: Object.keys(utm).length ? utm : null, referrer: ref, landing: (location.pathname + location.search).slice(0, 200) }
    localStorage.setItem(k, JSON.stringify(v)); return v
  } catch { return {} }
})()
const sid = (() => {
  try { let v = localStorage.getItem('cand_sid'); if (!v) { v = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)); localStorage.setItem('cand_sid', v) } return v } catch { return 'mem-' + Date.now() + Math.random().toString(16).slice(2) }
})()

function Temos({ onCta }) {
  const [play, setPlay] = useState(null)
  const [all, setAll] = useState(false)
  const [first, ...rest] = TEMOS
  const list = all ? rest : rest.slice(0, 4)
  useEffect(() => { if (!play) return; const k = (e) => e.key === 'Escape' && setPlay(null); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [play])
  const card = ([id, lbl, dur], big) => <button className={`tcard ${big ? 'big' : ''}`} key={id} onClick={() => setPlay([id, lbl])} aria-label={`Lire le témoignage : ${lbl}`}><Thumb id={id} dur={dur} big={big} /><b>{lbl}</b></button>
  return <section className="temos">
    <h2>Ils étaient exactement comme toi</h2>
    <p className="muted s13">Ils avaient les mêmes doutes avant de réserver. Écoute-les, c'est eux qui en parlent le mieux.</p>
    {card(first, true)}
    <div className="tgrid">{list.map((t) => card(t))}</div>
    {!all && rest.length > 4 && <button className="link" onClick={() => setAll(true)}>Voir {rest.length - 4} autres témoignages</button>}
    <button className="btn" onClick={onCta}>Je dépose ma candidature →</button>
    {play && <div className="tmodal" onClick={() => setPlay(null)} role="dialog" aria-modal="true" aria-label={play[1]}>
      <div className="tbox" onClick={(e) => e.stopPropagation()}>
        <button className="tclose" onClick={() => setPlay(null)} aria-label="Fermer">✕</button>
        <div className="tvid"><iframe src={`https://www.youtube-nocookie.com/embed/${play[0]}?autoplay=1&rel=0&playsinline=1`} title={play[1]} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" /></div>
        <b>{play[1]}</b>
      </div></div>}
  </section>
}

const isoIn = (d) => { const x = new Date(Date.now() + d * 864e5); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(x) }

const MAIL_DOMS = ['gmail.com', 'hotmail.com', 'hotmail.fr', 'outlook.com', 'outlook.fr', 'yahoo.fr', 'yahoo.com', 'icloud.com', 'live.fr', 'live.com', 'orange.fr', 'free.fr', 'wanadoo.fr', 'sfr.fr', 'laposte.net', 'proton.me', 'protonmail.com', 'me.com']
function lev(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length] }
// Faute de frappe dans le domaine (gmail.con, gmial.com, hotmal.fr…) : propose la bonne adresse, sans jamais bloquer.
function mailFix(email) {
  const e = (email || '').trim(); const at = e.lastIndexOf('@'); if (at < 1) return null
  const dom = e.slice(at + 1).toLowerCase(); if (dom.length < 4 || !dom.includes('.') || MAIL_DOMS.includes(dom)) return null
  let best = null, bd = 3
  for (const c of MAIL_DOMS) { const d = lev(dom, c); if (d < bd) { bd = d; best = c } }
  return best && bd <= 2 ? e.slice(0, at + 1) + best : null
}


export default function App() {
  const [step, setStep] = useState('intro')
  const [f, setF] = useState({ first_name: '', prefix: '+33', tel: '', wa_ok: true, wprefix: '+33', wtel: '', email: '', situation: '', experience: '', invest: '', blocage: '', capital: '', have: '', bdate: '' })
  const [err, setErr] = useState('')
  const [cfg, setCfg] = useState({ slot_min: 45, wa: '33756849421', release_hours: 4 })
  const [slots, setSlots] = useState(null)
  const [day, setDay] = useState('')
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false); const [mailBad, setMailBad] = useState(false)
  const [done, setDone] = useState(null)
  const [mine, setMine] = useState(null); const [resched, setResched] = useState(false)
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }))
  const [tBlur, setTBlur] = useState(false); const [pvReady, setPvReady] = useState(false)
  const [mailOk, setMailOk] = useState(false) // nouveau parcours : le numéro WhatsApp n'apparaît qu'une fois l'email validé
  useEffect(() => {
    if (!NEW) return
    const em = f.email.trim(); if (!mailShape(em)) { setMailOk(false); return }
    if (mailOk || mailFix(em)) return
    const t = setTimeout(() => { mailProblem(em).then((pb) => { if (!pb) setMailOk(true) }) }, 700)
    return () => clearTimeout(t)
  }, [f.email, mailOk])
  useEffect(() => { loadPV().then(() => setPvReady(true)) }, [])
  const go = (s) => { setErr(''); setStep(s); window.scrollTo(0, 0); try { history.pushState({ s }, '') } catch { /* */ } }
  // Le bouton « retour » du téléphone revient à l'étape précédente au lieu de quitter la page (et de renvoyer la personne sur TikTok).
  useEffect(() => {
    const pop = (e) => { setErr(''); setStep((cur) => (cur === 'done' ? cur : (e.state && e.state.s) || 'intro')); window.scrollTo(0, 0) }
    window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop)
  }, [])
  // Sauvegarde silencieuse de ce que la personne a déjà saisi (pour pouvoir la relancer si elle ne réserve pas)
  const [evSrc, setEvSrc] = useState('')
  const leadBody = (stp, g) => { const [pf, d] = effTel(g); const af = AF_BLOCK.test(intlOf(g.prefix, g.tel)) ? intlOf(g.prefix, g.tel) : (g.wa_ok === false && AF_BLOCK.test(intlOf(g.wprefix, g.wtel)) ? intlOf(g.wprefix, g.wtel) : ''); return { sid, step: stp, first_name: g.first_name.trim(), phone: af || (d.length >= 8 ? pf + d : ''), phone_raw: af || (d ? pf + d : ''), email: g.email.trim(), situation: g.situation, experience: g.experience, invest: g.invest || '', blocage: g.blocage, capital: g.capital, budget_confirmed: g.have, ...SRC, ...(EVENT ? { source: evSrc || SRC.source, utm: { ...(SRC.utm || {}), event: EVENT } } : {}) } }
  const saveLead = (stp, over = {}) => { if (!configured) return; rpcW('cand_lead', { p: leadBody(stp, { ...f, ...over }) }).catch(() => {}) }
  // On garde TOUT ce qui est tapé, même sans clic sur « Continuer » : sauvegarde auto 0,7 s après la dernière frappe, et à la fermeture / au changement d'onglet.
  const LS = { who: 'who', geo: 'who', situ: 'situ', exp: 'situ', txt: 'situ', inv: 'situ', cap: 'budget', block: 'budget', budget: 'budget', block2: 'budget', when: 'budget', later: 'budget', slot: 'slot' }
  const live = useRef({})
  live.current = { f, step }
  useEffect(() => {
    if (!configured || !LS[step] || !(f.first_name.trim() || f.tel.trim() || f.email.trim())) return
    const t = setTimeout(() => rpcW('cand_lead', { p: leadBody(LS[step], f) }).catch(() => {}), 700)
    return () => clearTimeout(t)
  }, [f, step])
  useEffect(() => {
    const flush = () => { const { f: g, step: s } = live.current; if (configured && LS[s] && (g.first_name.trim() || g.tel.trim() || g.email.trim())) rpcW('cand_lead', { p: leadBody(LS[s], g) }).catch(() => {}) }
    const vis = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush); document.addEventListener('visibilitychange', vis)
    return () => { window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', vis) }
  }, [])
  const n = { who: 1, situ: 2, exp: 3, txt: NEW ? 3 : 4, inv: 4, cap: 5, block: 5, budget: 6, block2: 6, when: 6, later: 6, slot: 7 }[step] || 0

  useEffect(() => { if (configured) rpc('cand_config').then(setCfg).catch(() => {}) }, [])
  useEffect(() => { if (configured && EVENT) rpc('cand_event_info', { p_slug: EVENT }).then((e) => e?.source && setEvSrc(e.source)).catch(() => {}) }, [])
  const loadSlots = () => rpc('cand_slots').then((s) => setSlots(s || [])).catch(() => setSlots([]))
  useEffect(() => { if (step === 'slot') { loadSlots(); if (!resched) saveLead('slot') } }, [step])
  const days = useMemo(() => { const m = new Map(); (slots || []).forEach((s) => { const k = dayKey(s); if (!m.has(k)) m.set(k, []); m.get(k).push(s) }); return [...m.entries()] }, [slots])
  useEffect(() => { if (days.length && !days.find((d) => d[0] === day)) setDay(days[0][0]) }, [days])

  const next = {
    async who() {
      const [pfx, digits] = splitTel(f.prefix, f.tel)
      if (!f.first_name.trim()) return setErr('Indique ton prénom.')
      if (geoBlocked(f)) { saveLead('who'); return go('geo') } // on garde la fiche (numéro complet), mais pas de créneau ni de relance
      if (f.wa_ok !== false && isFixe(f.prefix, f.tel)) { set('wa_ok', false); return setErr("Ce numéro est un fixe : il n'a pas WhatsApp. Indique ci-dessous ton numéro de portable, c'est là qu'on se parlera.") }
      if (!telOk(f.prefix, f.tel)) { setTBlur(true); return setErr("Ce numéro n'a pas l'air valide : vérifie l'indicatif et les chiffres (exemple : 6 12 34 56 78).") }
      if (f.wa_ok === false && (!telOk(f.wprefix, f.wtel) || isFixe(f.wprefix, f.wtel))) { setTBlur(true); return setErr("Entre un numéro WhatsApp valide, c'est lui qui me permet de te joindre.") }
      if (!mailShape(f.email)) return setErr("Vérifie ton adresse email : elle n'a pas l'air correcte (exemple : prenom@gmail.com).")
      if (pfx !== f.prefix || String(digits) !== f.tel) setF((x) => ({ ...x, prefix: pfx, tel: digits })); saveLead('who', { prefix: pfx, tel: digits })
      // Déjà un rendez-vous à venir ? On ne le laisse pas en reprendre un deuxième : on propose de le modifier.
      setBusy(true)
      { const pb = await mailProblem(f.email); if (pb) { setBusy(false); setMailBad(true); return setErr(pb) } }
      try { const m = TEST ? null : await rpc('cand_mine', { p: { email: f.email.trim().toLowerCase(), phone: effTel({ ...f, prefix: pfx, tel: digits }).join('') } }); if (m && m.found) { setBusy(false); setMine(m); return go('mine') } } catch { /* en cas de souci réseau on continue : le serveur refusera le doublon */ }
      setBusy(false); go('situ')
    },
    txt() {
      if (f.blocage.trim().length < MIN_TXT) return setErr(`Écris-moi quelques mots de plus (${MIN_TXT} caractères minimum).`)
      saveLead('situ'); go(NEW ? 'inv' : 'cap')
    },
    budget() {
      if (!f.have) return setErr('Choisis une réponse pour continuer.')
      saveLead('budget'); go(f.have === 'yes' ? 'slot' : f.have === 'soon' ? 'when' : 'block2')
    },
    async when() {
      if (!f.bdate) return setErr('Choisis la date à laquelle tu pourras investir.')
      setBusy(true)
      try { await rpcW('cand_lead_date', { p: { sid, date: f.bdate } }) } catch { /* la date reste aussi dans le formulaire sauvegardé : on ne bloque jamais la personne */ }
      setBusy(false); go('later')
    },
  }
  const fakeBook = () => { const d = new Date(pick); const w = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(d); return { ok: true, when: w + ' à ' + fmtT(pick).replace(':', 'h'), closer_name: 'Clément', wa: cfg.wa, first_name: f.first_name, release_hours: cfg.release_hours, status: 'reserve' } }
  async function book() {
    setBusy(true); setErr('')
    try {
      const tel_ = (() => { const [pf, d] = effTel(f); return pf + d })()
      if (resched) {
        const r = await rpcW('cand_resched', { p: { email: f.email.trim().toLowerCase(), phone: tel_, starts_at: pick } })
        setDone({ ...r, moved: true }); setResched(false); go('done'); setBusy(false); return
      }
      const r = TEST ? fakeBook() : await rpc('cand_book', { p: { closer: FORCED, event: EVENT, src: [SRC.source, SRC.utm?.source, SRC.utm?.campaign, SRC.utm?.content, evSrc, EVENT].filter(Boolean).join(' '), first_name: f.first_name.trim(), phone: (() => { const [pf, d] = effTel(f); return pf + d })(), email: f.email.trim(), situation: f.situation, capital: f.capital, budget_confirmed: f.have, starts_at: pick } })
      setDone(r); go('done')
    } catch (e) { setErr(e.message || 'La réservation a échoué.'); setPick(''); loadSlots() }
    setBusy(false)
  }
  const jour = (iso) => new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, weekday: 'long' }).format(new Date(iso))
  const bk = done || mine
  const cn = bk?.closer_name || CLOSER_NAME
  const waNum = bk?.wa || (CLOSER === 'amandine' ? WA_DEF : cfg.wa)
  const waMsg = bk ? `Salut ${cn}, c’est ${(bk.first_name || f.first_name).trim()}. Je viens de ${done?.moved ? 'déplacer' : 'réserver'} mon appel pour ${bk.when}.` : ''
  const waHref = `https://wa.me/${waNum}?text=${encodeURIComponent(waMsg)}`
  const copy = () => { try { navigator.clipboard.writeText('+' + waNum) } catch {} }
  const waClick = (e) => { openChat(e, waNum, waMsg, waHref); try { rpcW('cand_wa_click', { p: { email: f.email.trim().toLowerCase(), phone: effTel(f).join('') } }).catch(() => {}) } catch { /* */ } }
  const cur = days.find((d) => d[0] === day)
  const relH = bk?.release_hours || cfg.release_hours
  const confirmBtn = () => <div className="card confirm"><p><b>Tu n'as pas encore envoyé ton message ?</b></p><p className="muted s13">C'est la seule chose qui confirme ton créneau.</p>
    <a className="btn wa" href={waHref} target="_blank" rel="noopener noreferrer" onClick={waClick}>JE CONFIRME SUR WHATSAPP</a></div>
  const confirmCard = () => <div className="card confirm">
    <p><b>Envoie-moi ce message sur WhatsApp</b></p><p className="muted s13">C'est la seule chose qui confirme ton créneau.</p>
    <div className="msg">{waMsg}</div>
    <a className="btn wa" href={waHref} target="_blank" rel="noopener noreferrer" onClick={waClick}>JE CONFIRME SUR WHATSAPP</a>
    <div className="copyrow">Le bouton ne s'ouvre pas ? Écris-moi au <code>+{waNum}</code> <button className="ghost" onClick={copy}>Copier</button></div>
    <p className="note">Sans message dans les {relH} heures, je libère ton créneau pour quelqu'un d'autre.</p></div>
  const prepVideo = () => <div className="prep"><span className="eyebrow">En attendant mon appel</span><h2>Regarde cette vidéo afin de préparer notre appel</h2>
    <p className="muted s13"><b className="gold">#1</b> Écoute la vidéo entièrement (1 minute)</p><Vidalytics /></div>

  return <div className="shell">
    {TEST && <div className="testbar">Mode test : rien n'est enregistré, aucun email, aucun vrai rendez-vous.</div>}
    <header><Logo /></header>
    {n > 0 && <div className="progress">{[1, 2, 3, 4, 5, 6, 7].map((i) => <i key={i} className={i <= n ? 'on' : ''} />)}</div>}

    {step === 'intro' && <section className="screen">
      <div className="col">
        <h1>Tu veux te lancer, mais tu ne sais pas par où commencer ?</h1>
        <p>Dépose ta candidature. Je lis chaque candidature moi-même et je te dis franchement si je peux t'accompagner.</p></div>
      <div className="quotes"><span className="lbl muted">Ce que j'entends le plus souvent</span>
        <q>« Je tourne en rond depuis des mois. »</q><q>« J'ai déjà payé des formations qui n'ont rien donné. »</q><q>« Je veux sortir du métro, boulot, dodo. »</q></div>
      <div className="card"><div className="steps">
        <div><span>1</span><p><b>On fait le point.</b> Où tu en es, ce qui te bloque, ce que tu veux.</p></div>
        <div><span>2</span><p><b>Je te dis ce que je ferais à ta place.</b></p></div>
        <div><span>3</span><p><b>Si je peux t'aider, on en parle.</b> Sinon, je te le dis.</p></div></div>
        <button className="btn" onClick={() => go('who')}>Je dépose ma candidature →</button>
        </div>
      <Temos onCta={() => go('who')} />
      <p className="note filter">Je réponds aux personnes prêtes à passer à l'action et à investir dans leur projet. Si ce n'est pas encore ton cas, ne réserve pas : on perdrait du temps tous les deux.</p>
    </section>}

    {step === 'who' && <section className="screen">{NEW ? <div className="col"><h2>Où je t'envoie ma réponse ?</h2><p className="muted s13" style={{ margin: 0 }}>Je te réponds personnellement.</p></div> : <h2>Où je te réponds ?</h2>}<div className="card">
      <div className="field"><label htmlFor="p">Prénom</label><input id="p" value={f.first_name} onChange={(e) => set('first_name', e.target.value)} autoComplete="given-name" placeholder="Ton prénom" /></div>
      {NEW ? <>
      <div className="field"><label htmlFor="e">Email</label><input id="e" type="email" autoComplete="email" value={f.email} onChange={(e) => { set('email', e.target.value); setMailBad(false); setErr('') }} onBlur={() => { saveLead('who'); if (f.email.trim().includes('@')) mailProblem(f.email).then((pb) => { if (pb) setErr(pb); else if (NEW) setMailOk(true) }) }} aria-invalid={mailBad || undefined} placeholder="ton@email.com" />
        {mailFix(f.email) && <button type="button" className="mailfix" onClick={() => set('email', mailFix(f.email))}>Tu voulais dire <b>{mailFix(f.email)}</b> ? <u>Corriger</u></button>}{NEW && mailOk && <span className="okmark">✓ Email valide</span>}</div>
      {mailOk && <div className="reveal">
      <div className="field"><label htmlFor="t">Ton numéro WhatsApp</label><div className="phone">
        <select value={f.prefix} onChange={(e) => set('prefix', e.target.value)} aria-label="Indicatif">{PREFIX.map((p) => <option key={p}>{p}</option>)}</select>
        <input id="t" type="tel" inputMode="tel" autoComplete="tel-national" value={f.tel} onChange={(e) => set('tel', e.target.value)} onBlur={() => { setTBlur(true); const [pf, d] = splitTel(f.prefix, f.tel); if (f.tel.trim() && (pf !== f.prefix || d !== f.tel.replace(/\s/g, ''))) setF((x) => ({ ...x, prefix: pf, tel: d })); saveLead('who', { prefix: pf, tel: d }) }} placeholder="6 12 34 56 78" /></div>
        {tBlur && f.tel.trim() && pvReady && !telOk(f.prefix, f.tel) && <span className="err s12" role="alert">Ce numéro n'a pas l'air valide. Vérifie l'indicatif et les chiffres.</span>}
        <label className="chk"><input type="checkbox" checked={f.wa_ok !== false} onChange={(e) => set('wa_ok', e.target.checked)} /> Ce numéro est bien sur WhatsApp</label>
        {f.wa_ok === false && <div className="phone" style={{ marginTop: 8 }}>
          <select value={f.wprefix} onChange={(e) => set('wprefix', e.target.value)} aria-label="Indicatif WhatsApp">{PREFIX.map((p) => <option key={p}>{p}</option>)}</select>
          <input id="tw" type="tel" inputMode="tel" autoComplete="off" value={f.wtel} onChange={(e) => set('wtel', e.target.value)} placeholder="Ton numéro WhatsApp" aria-label="Numéro WhatsApp" /></div>}
        {f.wa_ok === false && <span className="muted s12">Indique le numéro sur lequel tu as WhatsApp : c'est là que tu me confirmes ton appel.</span>}</div>
      </div>}</> : <>
      <div className="field"><label htmlFor="t">Ton numéro WhatsApp</label><div className="phone">
        <select value={f.prefix} onChange={(e) => set('prefix', e.target.value)} aria-label="Indicatif">{PREFIX.map((p) => <option key={p}>{p}</option>)}</select>
        <input id="t" type="tel" inputMode="tel" autoComplete="tel-national" value={f.tel} onChange={(e) => set('tel', e.target.value)} onBlur={() => { setTBlur(true); const [pf, d] = splitTel(f.prefix, f.tel); if (f.tel.trim() && (pf !== f.prefix || d !== f.tel.replace(/\s/g, ''))) setF((x) => ({ ...x, prefix: pf, tel: d })); saveLead('who', { prefix: pf, tel: d }) }} placeholder="6 12 34 56 78" /></div>
        {tBlur && f.tel.trim() && pvReady && !telOk(f.prefix, f.tel) && <span className="err s12" role="alert">Ce numéro n'a pas l'air valide. Vérifie l'indicatif et les chiffres.</span>}
        <label className="chk"><input type="checkbox" checked={f.wa_ok !== false} onChange={(e) => set('wa_ok', e.target.checked)} /> Ce numéro est bien sur WhatsApp</label>
        {f.wa_ok === false && <div className="phone" style={{ marginTop: 8 }}>
          <select value={f.wprefix} onChange={(e) => set('wprefix', e.target.value)} aria-label="Indicatif WhatsApp">{PREFIX.map((p) => <option key={p}>{p}</option>)}</select>
          <input id="tw" type="tel" inputMode="tel" autoComplete="off" value={f.wtel} onChange={(e) => set('wtel', e.target.value)} placeholder="Ton numéro WhatsApp" aria-label="Numéro WhatsApp" /></div>}
        {f.wa_ok === false && <span className="muted s12">Indique le numéro sur lequel tu as WhatsApp : c'est là que tu me confirmes ton appel.</span>}</div>
      <div className="field"><label htmlFor="e">Email</label><input id="e" type="email" autoComplete="email" value={f.email} onChange={(e) => { set('email', e.target.value); setMailBad(false); setErr('') }} onBlur={() => { saveLead('who'); if (f.email.trim().includes('@')) mailProblem(f.email).then((pb) => { if (pb) setErr(pb); else if (NEW) setMailOk(true) }) }} aria-invalid={mailBad || undefined} placeholder="ton@email.com" />
        {mailFix(f.email) && <button type="button" className="mailfix" onClick={() => set('email', mailFix(f.email))}>Tu voulais dire <b>{mailFix(f.email)}</b> ? <u>Corriger</u></button>}{NEW && mailOk && <span className="okmark">✓ Email valide</span>}</div>
      </>}
      <div className="err">{err}</div><button className="btn" disabled={busy || (NEW && !mailOk)} onClick={next.who}>{busy ? 'Un instant…' : 'Continuer →'}</button></div></section>}

    {step === 'situ' && <section className="screen"><div className="col"><span className="eyebrow">Question 1 sur 5</span><h2>Quelle est ta situation actuelle ?</h2></div><div className="card">
      <div className="chips col">{SITUS.map((v) => <button key={v} className={`chip ${f.situation === v ? 'sel' : ''}`} onClick={() => { set('situation', v); saveLead('situ', { situation: v }); go(NEW ? 'txt' : 'exp') }}>{v}</button>)}</div></div>
      <button className="link" onClick={() => go('who')}>← Retour</button></section>}

    {step === 'exp' && <section className="screen"><div className="col"><span className="eyebrow">Question 2 sur 5</span><h2>Ton expérience en e-commerce ?</h2></div><div className="card">
      <div className="chips col">{EXPS.map((v) => <button key={v} className={`chip ${f.experience === v ? 'sel' : ''}`} onClick={() => { set('experience', v); saveLead('situ', { experience: v }); go(NEW ? 'inv' : 'txt') }}>{v}</button>)}</div></div>
      <button className="link" onClick={() => go('situ')}>← Retour</button></section>}

    {step === 'inv' && <section className="screen"><div className="col"><span className="eyebrow">Question 3 sur 5</span><h2>As-tu déjà investi dans une formation ou un coaching ?</h2></div><div className="card">
      <div className="chips col">{INVS.map((v) => <button key={v} className={`chip ${f.invest === v ? 'sel' : ''}`} onClick={() => { set('invest', v); saveLead('situ', { invest: v }); go('cap') }}>{v}</button>)}</div></div>
      <button className="link" onClick={() => go(NEW ? 'txt' : 'exp')}>← Retour</button></section>}

    {step === 'txt' && <section className="screen"><div className="col">{NEW ? <><span className="eyebrow">Question 2 sur 5</span><h2>Quel est ton problème principal ?</h2></> : <><span className="eyebrow">Merci {f.first_name.trim()}</span><h2>Qu'est-ce qui t'a bloqué jusqu'ici ?</h2></>}</div><div className="card notes">
      <div className="field"><label htmlFor="bl">Dis-le avec tes mots</label>
        <textarea id="bl" rows={6} value={f.blocage} onChange={(e) => set('blocage', e.target.value)} placeholder={NEW ? "Ce qui te bloque aujourd'hui, ce que tu as déjà essayé…" : "Ce qui te bloque, ce que tu as déjà essayé…"} />
        <div className="s12 muted" style={{ display: 'flex', justifyContent: 'space-between' }}><span>Obligatoire, à écrire toi-même</span><span>{Math.min(f.blocage.trim().length, MIN_TXT)} / min. {MIN_TXT}</span></div></div>
      <div className="err">{err}</div><button className="btn" disabled={f.blocage.trim().length < MIN_TXT} onClick={next.txt}>Continuer →</button></div>
      <button className="link" onClick={() => go(NEW ? 'situ' : 'exp')}>← Retour</button></section>}

    {step === 'cap' && <section className="screen"><div className="col"><span className="eyebrow">Question 4 sur 5</span><h2>Combien peux-tu investir maintenant dans ton projet ?</h2></div><div className="card">
      <div className="chips col">{CAPS.map(([v, l]) => <button key={v} className={`chip ${f.capital === v ? 'sel' : ''}`} onClick={() => { set('capital', v); saveLead('budget', { capital: v }); go(v === 'lt500' ? 'block' : 'budget') }}>{l}</button>)}</div></div>
      <button className="link" onClick={() => go(NEW ? 'inv' : 'txt')}>← Retour</button></section>}

    {step === 'geo' && <section className="screen"><div className="col"><span className="eyebrow">Merci pour ton message</span><h2>Je ne peux pas encore t'accompagner depuis ton pays</h2></div><div className="card">
      <p>Mon accompagnement se règle par carte bancaire, et je ne peux pas l'ouvrir pour l'instant depuis ton pays. Ce n'est pas un jugement sur toi ni sur ton projet.</p>
      <p className="muted">En attendant, continue de suivre mes contenus.</p></div>
      <button className="link" onClick={() => go('who')}>← Modifier mon numéro</button></section>}

    {step === 'block' && <section className="screen"><h2>Ce n'est pas le bon moment</h2><div className="card">
      <p>Avec moins de 500 € disponibles, je ne peux pas t'accompagner correctement et je ne veux pas te faire perdre ton temps.</p>
      <p className="muted">Reviens dès que tu as de quoi investir, ou suis mes contenus en attendant.</p></div>
      <button className="link" onClick={() => go('cap')}>← Modifier ma réponse</button></section>}

    {step === 'budget' && <section className="screen"><h2>Une dernière question, franche</h2><div className="card">
      <p>Tu as indiqué <b>{CAP_LBL[f.capital]}</b>. Beaucoup de personnes cochent un montant qu'elles n'ont pas encore, et on perd du temps tous les deux.</p>
      <div className="field"><span className="lbl">Tu peux vraiment mobiliser ce budget maintenant ?</span><div className="chips col">
        {[['yes', 'Oui, je l\'ai disponible maintenant'], ['soon', 'Pas encore, il me faut quelques semaines'], ['no', 'Non, je ne l\'ai pas']].map(([v, l]) => <button key={v} className={`chip ${f.have === v ? 'sel' : ''}`} onClick={() => { set('have', v); saveLead('budget', { have: v }) }}>{l}</button>)}</div></div>
      <p className="muted s13">Sois honnête, ça m'aide à te dire la vérité.</p>
      <div className="err">{err}</div><button className="btn" onClick={next.budget}>Choisir mon créneau →</button></div>
      <button className="link" onClick={() => go('cap')}>← Retour</button></section>}

    {step === 'when' && <section className="screen"><h2>À partir de quand ?</h2><div className="card">
      <p>Pas de souci. Donne-moi une <b>date précise</b> à laquelle tu pourras investir : je te recontacte directement sur WhatsApp à ce moment-là.</p>
      <div className="chips">{[['Dans 2 semaines', 14], ['Dans 1 mois', 30], ['Dans 2 mois', 60], ['Dans 3 mois', 90]].map(([l, d]) => { const v = isoIn(d); return <button key={d} className={`chip ${f.bdate === v ? 'sel' : ''}`} onClick={() => set('bdate', v)}>{l}</button> })}</div>
      <div className="field"><label htmlFor="bd">Ou choisis ta date</label><input id="bd" type="date" min={isoIn(1)} max={isoIn(400)} value={f.bdate} onChange={(e) => set('bdate', e.target.value)} /></div>
      <div className="err">{err}</div><button className="btn" disabled={busy} onClick={next.when}>{busy ? 'Un instant…' : 'Me recontacter à cette date →'}</button></div>
      <button className="link" onClick={() => go('budget')}>← Modifier ma réponse</button></section>}

    {step === 'later' && <section className="screen"><div className="col"><span className="eyebrow">C'est noté</span><h2>Je te recontacte le {new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(f.bdate + 'T12:00:00'))}</h2></div><div className="card">
      <p>Je t'écrirai sur WhatsApp au <b>{f.wa_ok === false ? f.wprefix + ' ' + f.wtel : f.prefix + ' ' + f.tel}</b>. Garde-le à portée de main.</p>
      <p className="muted">Si ça va plus vite que prévu, tu peux réserver ton appel dès que ton budget est disponible.</p></div>
      <button className="link" onClick={() => go('budget')}>← Modifier ma réponse</button></section>}

    {step === 'block2' && <section className="screen"><h2>Reviens quand ce sera le bon moment</h2><div className="card">
      <p>Sans budget disponible, un appel ne te servirait à rien : je ne pourrais pas t'accompagner correctement.</p>
      <p className="muted">Dès que tu peux investir, reviens réserver. En attendant, continue de suivre mes contenus.</p></div>
      <button className="link" onClick={() => go('budget')}>← Modifier ma réponse</button></section>}

    {step === 'slot' && <section className="screen"><h2>{resched ? 'Choisis ton nouveau créneau' : 'Choisis ton créneau'}</h2><div className="card">
      {slots === null && <p className="muted">Je regarde mes disponibilités…</p>}
      {slots && !days.length && <p className="muted">Aucun créneau libre pour le moment. Reviens bientôt.</p>}
      {!!days.length && <><div className="days">{days.map(([k]) => { const d = fmtDay(k); return <button key={k} className={`day ${k === day ? 'sel' : ''}`} onClick={() => { setDay(k); setPick('') }}>{d.w}<b>{d.n}</b></button> })}</div>
        <div className="slots">{(cur?.[1] || []).map((s) => <button key={s} className={`slot ${pick === s ? 'sel' : ''}`} onClick={() => setPick(s)}>{fmtT(s)}</button>)}</div></>}
      <p className="note">Heure de Paris · appel de {cfg.slot_min} minutes</p>
      <div className="err">{err}</div>
      <button className="btn" disabled={!pick || busy} onClick={book}>{busy ? (resched ? 'Un instant…' : 'Réservation…') : resched ? 'Déplacer mon rendez-vous' : 'Confirmer ce créneau'}</button></div>
      <button className="link" onClick={() => { if (resched) { setResched(false); go('mine') } else go('budget') }}>← Retour</button></section>}

    {step === 'mine' && mine && <section className="screen">
      <div className="col"><span className="eyebrow">Tu as déjà réservé</span><h2>{mine.status === 'confirme' ? 'Ton rendez-vous est confirmé ✓' : "Tu as déjà un rendez-vous, il n'est pas encore confirmé"}</h2></div>
      <div className="recap"><span className="muted s12">Ton appel</span><b>{mine.when.replace(' à ', ' · ')}</b></div>
      {mine.status !== 'confirme' && confirmCard()}
      <div className="card"><p><b>Tu veux changer l'horaire ?</b></p><p className="muted s13">Pas besoin d'en réserver un deuxième : je déplace celui-ci.</p>
        <button className="btn ghost" onClick={() => { setPick(''); setResched(true); go('slot') }}>Modifier mon rendez-vous</button></div>
      {prepVideo()}
      {mine.status !== 'confirme' && confirmBtn()}</section>}

    {step === 'done' && done && <section className="screen">
      <div className="col"><span className="eyebrow">{done.status === 'confirme' ? 'Rendez-vous déplacé' : 'Étape 1 sur 2 faite'}</span>
        <h2>{done.status === 'confirme' ? 'Ton rendez-vous est déplacé ✓' : "Ton appel n'est pas encore confirmé"}</h2></div>
      <div className="recap"><span className="muted s12">{done.moved ? 'Nouveau créneau' : 'Créneau réservé'}</span><b>{done.when.replace(' à ', ' · ')}</b></div>
      {done.status !== 'confirme' && confirmCard()}
      {prepVideo()}
      {done.status !== 'confirme' && confirmBtn()}</section>}
    {!configured && <p className="err">Configuration manquante (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).</p>}
  </div>
}
