import LoadErr from './LoadErr'
import { usePS } from './persist'
import { useEffect, useMemo, useState } from 'react'
import { supabase, friendlyError } from './supabase'

const TZ = 'Europe/Paris'
const CAPL = { lt500: 'Moins de 500 €', '500-1000': 'Entre 500 € et 1 000 €', '1000-3000': 'Entre 1 000 € et 3 000 €', gt3000: 'Plus de 3 000 €' }
const BUD = { yes: 'Oui, je l\'ai disponible maintenant', soon: 'Pas encore, il me faut quelques semaines', no: 'Non, je ne l\'ai pas' }
const ORD = { who: 0, situ: 1, budget: 2, slot: 3 }
const STEPN = ['Coordonnées', 'Situation', 'Budget', 'Créneaux']
const dt = (iso) => iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
const dcall = (iso) => iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : ''
const full = (r) => [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Sans prénom'
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const reached = (r, i) => Boolean(r.call_id) || (ORD[r.step] ?? 0) >= i

// Les questions, dans l'ordre et avec les mots exacts de la page de réservation.
const QS = [
  ['Prénom', (r) => r.first_name],
  ['Numéro WhatsApp', (r) => r.phone || r.phone_raw],
  ['Email', (r) => r.email || r.email_raw],
  ['Que fais-tu dans la vie ?', (r) => r.situation],
  ['Ton expérience en e-commerce ? (ancien parcours)', (r) => r.experience],
  ['As-tu déjà investi dans une formation ou un coaching ?', (r) => r.invest],
  ["Quel est ton problème principal ? (ou : ce qui l'a bloqué, ancien parcours)", (r) => r.blocage],
  ['Combien peux-tu investir maintenant dans ton projet ?', (r) => CAPL[r.capital]],
  ['Tu peux vraiment mobiliser ce budget maintenant ?', (r) => BUD[r.budget_confirmed]],
  ['Créneau choisi', (r) => r.call_at ? dcall(r.call_at) : ''],
]

/** « Formulaires » : toutes les réponses au formulaire de réservation + où les gens s'arrêtent. */
export default function Formulaires({ toast, onOpen }) {
  const [rows, setRows] = useState(null); const [days, setDays] = usePS('fo_days', 'today'); const [f, setF] = usePS('fo_f', 'all'); const [q, setQ] = usePS('fo_q', ''); const [more, setMore] = usePS('fo_more', 24); const [openId, setOpenId] = usePS('fo_open', null)
  const [lerr, setLerr] = useState('')
  const load = async () => {
    let all = [], from = 0, bad = ''
    try {
      for (;;) {
        const { data, error } = await supabase.from('prospects_v').select('*').order('created_at', { ascending: false }).range(from, from + 999)
        if (error) { bad = friendlyError(error); break }
        all = all.concat(data || []); if (!data || data.length < 1000) break; from += 1000
      }
    } catch (e) { bad = friendlyError(e) }
    setLerr(bad); if (!bad) setRows(all)
  }
  useEffect(() => { load(); const i = setInterval(load, 60000); return () => clearInterval(i) }, [])
  useEffect(() => setMore(24), [days, f, q])

  const inRange = useMemo(() => {
    const day = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: TZ }) // jour de Paris, ex. 2026-11-10
    const k = days === 'today' ? day(Date.now()) : days === 'yday' ? day(Date.now() - 864e5) : ''
    return (rows || []).filter((r) => k ? day(r.created_at) === k : !days || new Date(r.created_at).getTime() > Date.now() - days * 864e5)
  }, [rows, days])
  const fun = useMemo(() => [inRange.length, ...[1, 2, 3].map((i) => inRange.filter((r) => reached(r, i)).length), inRange.filter((r) => r.call_id).length], [inRange])
  const labels = ['Ont commencé le formulaire', 'Sont arrivés à la question « situation »', 'Sont arrivés à la question « budget »', 'Ont vu les créneaux', 'Ont réservé un appel']
  const list = useMemo(() => {
    const nq = norm(q)
    return inRange.filter((r) => (f === 'all' || (f === 'done' ? r.call_id : !r.call_id)) && (!nq || norm(full(r) + ' ' + (r.email || r.email_raw || '') + ' ' + (r.phone || r.phone_raw || '') + ' ' + (r.situation || '')).includes(nq)))
  }, [inRange, f, q])
  const total = fun[0]

  return <div className="fm">
    <div className="fm-head">
      <div><h2 className="sh">Formulaire de réservation</h2><p className="muted">Toutes les réponses, même quand la personne s'arrête en route. Rien ne se perd.</p></div>
      <div className="pills">{[['today', "Aujourd'hui"], ['yday', 'Hier'], [7, '7 jours'], [30, '30 jours'], [0, 'Tout']].map(([d, l]) => <button key={d} className={`pill ${days === d ? 'on' : ''}`} onClick={() => setDays(d)}>{l}</button>)}</div>
    </div>
    {rows === null && !lerr && <p className="muted">Chargement…</p>}
    <LoadErr msg={lerr} onRetry={load} />
    {rows && <>
      <div className="fm-fun">{fun.map((n, i) => <div key={i} className="fm-bar"><span className="fm-l">{labels[i]}</span>
        <span className="fm-t"><i style={{ width: total ? Math.max(2, Math.round(n / total * 100)) + '%' : '0%' }} className={i === 4 ? 'g' : ''} /></span>
        <b>{n}</b><small>{total ? Math.round(n / total * 100) : 0} %</small></div>)}</div>
      <div className="fm-tools">
        <div className="pills" style={{ marginBottom: 0 }}>{[['all', `Toutes · ${inRange.length}`], ['done', `Réservées · ${fun[4]}`], ['drop', `Abandonnées · ${inRange.length - fun[4]}`]].map(([k, l]) => <button key={k} className={`pill ${f === k ? 'on' : ''}`} onClick={() => setF(k)}>{l}</button>)}</div>
        <input className="fm-q" type="search" placeholder="Rechercher un nom, un numéro, un email…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!list.length && <div className="sys">Aucune réponse pour le moment</div>}
      <div className="fm-list">{list.slice(0, more).map((r) => {
        const last = ORD[r.step] ?? 0; const open = openId === r.id
        return <article key={r.id} className={`fm-card ${open ? 'open' : ''}`}>
          <header onClick={() => setOpenId(open ? null : r.id)}>
            <div><b>{full(r)}</b><small>{dt(r.created_at)}{r.source ? ` · ${r.source}` : ''}</small></div>
            {r.call_id ? <span className="badge ok">Appel réservé</span> : r.stage === 'disqualifie' ? <span className="badge dq">Disqualifié{r.capital === 'lt500' ? ' : moins de 500 €' : ''}</span> : <span className="badge wait">Arrêté : {STEPN[last]}</span>}
          </header>
          {open && <div className="fm-qa">
            {QS.map(([q, g], i) => { const v = g(r); return <div key={q} className="fm-row"><span>{q}</span>{v ? <b>{v}</b> : <em>— pas de réponse</em>}</div> })}
            {r.utm && Object.keys(r.utm).length > 0 && <div className="fm-row"><span>Origine</span><b>{Object.entries(r.utm).map(([k, v]) => `${k} : ${v}`).join(' · ')}</b></div>}
            <div className="acts"><button className="btn ghost sm" onClick={() => onOpen(r.id)}>Ouvrir la fiche prospect</button></div>
          </div>}
        </article>
      })}</div>
      {list.length > more && <div className="fm-more"><button className="btn ghost sm" onClick={() => setMore(more + 24)}>Voir plus ({list.length - more})</button></div>}
    </>}
  </div>
}
