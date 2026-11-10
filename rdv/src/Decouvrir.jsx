import { useEffect, useRef, useState } from 'react'
import { rpc, configured } from './api'
import Logo from './Logo'
import { TEMOS, Thumb, PlayerModal } from './videos'

// ⚙️ Vidéo principale (explique la méthode). Pour la changer : remplace l'identifiant YouTube ci-dessous.
const MAIN = ['_owYS81Ohj0', 'Ma méthode E-Connect, expliquée', '13:20']

// À voir aussi, juste sous le bloc-notes.
const ALSO = [
  ['HYw80zutipU', 'Pourquoi commander du stock n’est pas risqué en E-Connect', '9:27'],
  ['FOttgqg1scQ', 'Comment Koudjedji a généré +2 300 € net avec 2 h par jour, sans dropshipping', '8:21'],
  ['F5u08WW4I5A', 'E-Connect : le business en ligne que personne ne connaît', '11:18'],
  ['-H0tRIFK1_4', 'J’ai lancé 3 boutiques clé en main : ce que ça donne vraiment', '13:36'],
]

const CATS = [
  ['start', 'Commence ici', [
    ['qAq43rMH3uo', 'Si je recommençais l’e-commerce de zéro en 2026', '4:19'],
    ['bnZzWnZIsPs', 'Pourquoi je ne fais plus de dropshipping', '14:06'],
    ['l5HbS9e0yFg', 'Le plan à suivre pour réussir en e-commerce', '19:02'],
    ['_QOn8Yae0cc', 'Pourquoi j’ai arrêté le dropshipping classique', '8:08'],
  ]],
  ['temos', 'Témoignages', [...TEMOS, ['FOttgqg1scQ', 'Koudjedji · en 2 h par jour', '8:21']]],
  ['learn', 'Apprendre les bases', [
    ['7FnQsLdIh70', 'Créer une boutique Shopify en 30 minutes', '16:53'],
    ['0BYfWKOKZcE', 'Les 5 meilleures apps Shopify', '8:57'],
    ['BMBgi-aS_eM', 'Trouver un fournisseur facilement', '10:01'],
    ['eRyiK67LUqU', 'Trouver un produit gagnant', '23:41'],
    ['sWGoiRoiuqc', 'Faire de bonnes créatives', '8:36'],
    ['R5km-g7z4nc', 'Lancer une campagne Facebook Ads en 5 minutes', '10:56'],
    ['wkFYqHBDY9Q', 'La réalité sur le dropshipping', '11:39'],
  ]],
]

const FAQ = [
  ['C’est quoi, concrètement, E-Connect ?', 'C’est la méthode que j’enseigne pour lancer ton e-commerce : on choisit un produit, on monte ta boutique, on lance tes publicités et on suit tes chiffres. Tu lances, et je t’accompagne en un-à-un à chaque étape.'],
  ['Je n’ai aucune expérience, est-ce que c’est un problème ?', 'Non. Tu peux partir de zéro, c’est justement à ça que sert l’accompagnement. Ce qu’il faut, c’est de la régularité et l’envie de passer à l’action.'],
  ['Je suis salarié, je peux le faire à côté de mon travail ?', 'Oui, plusieurs élèves ont lancé à côté de leur emploi. Ça demande du travail régulier, mais pas d’être disponible toute la journée : on adapte à ton emploi du temps.'],
  ['Est-ce que je dois commander du stock ?', 'Oui, mais pas au départ. On teste d’abord ton produit, et tu ne commandes du stock qu’une fois que les chiffres de tes tests le justifient. Je l’explique en détail dans la vidéo « Pourquoi commander du stock n’est pas risqué en E-Connect ».'],
  ['Combien ça coûte et de quel budget j’ai besoin ?', 'C’est un accompagnement payant, et il faut aussi un budget de départ pour tes tests. On en parle franchement pendant l’appel, avec les vrais chiffres, pour que tu décides en connaissance de cause.'],
  ['Est-ce que ça marche pour tout le monde ?', 'Non, et je préfère te le dire. Ça demande du travail, de la régularité et un budget de départ. Pendant l’appel, je te dis honnêtement si je peux t’aider ou non.'],
  ['Comment se passe l’appel ?', 'On fait le point sur ta situation, je te dis ce que je ferais à ta place, et si je peux t’aider, on en parle. Sinon, je te le dis simplement.'],
  ['J’ai réservé : que dois-je faire maintenant ?', 'Réponds au message WhatsApp que je t’envoie pour confirmer ta présence. Sans réponse dans le délai, ton créneau est libéré pour quelqu’un d’autre. Un empêchement ? Écris-moi sur WhatsApp, on décale.'],
]

// Qui écrit ? Le lien personnel (?t=…) envoyé sur WhatsApp, sinon l'identifiant du navigateur utilisé pour réserver.
const TOKEN = (() => { try { return new URLSearchParams(location.search).get('t') || '' } catch { return '' } })()
const SID = (() => { try { return localStorage.getItem('cand_sid') || '' } catch { return '' } })()

function Notes() {
  const [body, setBody] = useState(''); const [name, setName] = useState(''); const [st, setSt] = useState('')
  const loaded = useRef(false); const dirty = useRef(false)
  useEffect(() => {
    if (!configured || (!TOKEN && !SID)) { loaded.current = true; return }
    rpc('cand_questions_get', { p: { t: TOKEN, sid: SID } }).then((r) => { if (r && !dirty.current) { setBody(r.body || ''); setName(r.name || '') } }).catch(() => { }).finally(() => { loaded.current = true })
  }, [])
  const save = (b, n) => { if (!configured || (!TOKEN && !SID)) return Promise.resolve(); setSt('saving'); return rpc('cand_questions_save', { p: { t: TOKEN, sid: SID, body: b, name: n } }).then(() => setSt('saved')).catch(() => setSt('err')) }
  useEffect(() => {
    if (!dirty.current) return
    const t = setTimeout(() => save(body, name), 900)
    return () => clearTimeout(t)
  }, [body, name])
  useEffect(() => {
    const flush = () => { if (dirty.current && document.visibilityState !== 'visible') save(body, name) }
    document.addEventListener('visibilitychange', flush); window.addEventListener('pagehide', flush)
    return () => { document.removeEventListener('visibilitychange', flush); window.removeEventListener('pagehide', flush) }
  }, [body, name])
  const type = (fn) => (e) => { dirty.current = true; fn(e.target.value) }
  return <section className="card notes">
    <h2>Prépare tes questions pour notre appel</h2>
    <p className="muted">Regarde la vidéo, puis écris ici toutes les questions que tu veux me poser. Je les lis avant l'appel et j'y réponds avec toi.</p>
    {!TOKEN && <div className="field"><label htmlFor="qn">Ton prénom</label><input id="qn" value={name} onChange={type(setName)} autoComplete="given-name" placeholder="Pour que je sache de qui viennent les questions" /></div>}
    <div className="field"><label htmlFor="qb">Mes questions</label>
      <textarea id="qb" value={body} onChange={type(setBody)} rows={7} placeholder={'1. …\n2. …\n3. …'} maxLength={4000} /></div>
    <span className={`qst ${st}`} aria-live="polite">{st === 'saving' ? 'Enregistrement…' : st === 'saved' ? '✓ Enregistré. Tu peux fermer cette page et revenir quand tu veux.' : st === 'err' ? 'Impossible d’enregistrer pour le moment, réessaie.' : 'Tout s’enregistre tout seul.'}</span>
  </section>
}

function Main() {
  const [on, setOn] = useState(false)
  return <div className="dmain">
    {on ? <div className="tvid big"><iframe src={`https://www.youtube-nocookie.com/embed/${MAIN[0]}?autoplay=1&rel=0&playsinline=1`} title={MAIN[1]} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen /></div>
      : <button className="tcard big" onClick={() => setOn(true)} aria-label={`Lire : ${MAIN[1]}`}><Thumb id={MAIN[0]} dur={MAIN[2]} big /></button>}
    <b>{MAIN[1]}</b>
  </div>
}

export default function Decouvrir() {
  const [cat, setCat] = useState('start'); const [all, setAll] = useState(false); const [play, setPlay] = useState(null)
  useEffect(() => { document.title = 'Avant notre appel · E-Connect' }, [])
  const cur = CATS.find((c) => c[0] === cat)
  const list = all ? cur[2] : cur[2].slice(0, 6)
  const vid = ([id, l, d]) => <button className="tcard" key={id} onClick={() => setPlay([id, l])}><Thumb id={id} dur={d} /><b>{l}</b></button>
  return <div className="shell">
    <header><Logo /></header>

    <section className="screen">
      <div className="col"><span className="eyebrow">Avant notre appel</span>
        <h1>Regarde cette vidéo en premier</h1>
        <p className="muted">Elle t'explique ma méthode, étape par étape. Ensuite, prépare tes questions juste en dessous.</p></div>
      <Main />
    </section>

    <Notes />

    <section className="temos">
      <h2>À voir aussi</h2>
      <div className="tgrid">{ALSO.map(vid)}</div>
    </section>

    <section className="temos">
      <h2>Ils étaient exactement comme toi</h2>
      <p className="muted s13">Ils avaient les mêmes doutes que toi avant de commencer. Écoute-les, ce sont eux qui en parlent le mieux.</p>
      <button className="tcard big" onClick={() => setPlay([TEMOS[0][0], TEMOS[0][1]])}><Thumb id={TEMOS[0][0]} dur={TEMOS[0][2]} big /><b>{TEMOS[0][1]}</b></button>
      <div className="tgrid">{TEMOS.slice(1, 5).map(vid)}</div>
    </section>

    <section className="temos">
      <h2>Toutes mes vidéos, bien rangées</h2>
      <div className="dpills" role="tablist">{CATS.map(([k, l, v]) => <button key={k} role="tab" aria-selected={cat === k} className={`chip ${cat === k ? 'sel' : ''}`} onClick={() => { setCat(k); setAll(false) }}>{l} <small>{v.length}</small></button>)}</div>
      <div className="tgrid">{list.map(vid)}</div>
      {!all && cur[2].length > 6 && <button className="link" onClick={() => setAll(true)}>Voir les {cur[2].length - 6} autres</button>}
    </section>

    <section className="faq">
      <h2>Les questions qu'on me pose le plus</h2>
      {FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
    </section>
    <PlayerModal play={play} onClose={() => setPlay(null)} />
  </div>
}
