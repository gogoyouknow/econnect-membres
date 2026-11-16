import { useEffect, useMemo, useState } from 'react'
import { supabase, friendlyError } from './supabase'

// Les 4 montants (clés fixes : elles servent au routage) et leur libellé habituel.
const AMOUNTS = [['lt500', 'Moins de 500 €'], ['500-1000', 'Entre 500 € et 1 000 €'], ['1000-3000', 'Entre 1 000 € et 3 000 €'], ['gt3000', 'Plus de 3 000 €']]
// Les 3 réponses à « Tu peux vraiment mobiliser ce budget maintenant ? »
const ANSWERS = [['yes', 'Oui, je l’ai disponible maintenant'], ['soon', 'Pas encore, il me faut quelques semaines'], ['no', 'Non, je ne l’ai pas']]
const CAP_T = 'Combien peux-tu investir maintenant dans ton projet ?'
const HAVE_T = 'Tu peux vraiment mobiliser ce budget maintenant ?'
// Après le choix du montant
const CAP_ACT = [['ask', 'Selon sa réponse à la question suivante'], ['slot', 'Calendrier, quelle que soit sa réponse'], ['block', 'Page Méthode (97 €), quelle que soit sa réponse']]
// Après la réponse « mobiliser ce budget »
const DEST = [['slot', 'Choisit son créneau (calendrier)'], ['when', 'Donne une date de rappel'], ['block2', 'Message « reviens quand ce sera le bon moment »'], ['block', 'Page Méthode (97 €)']]
const DEST_SHORT = { slot: 'Calendrier', when: 'Date de rappel', block2: 'Reviens plus tard', block: 'Page Méthode' }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// Réglage par défaut = exactement le comportement d'avant (et l'exception « moins de 500 € » si une règle la demande).
const lt500Rule = (ev, closers) => (ev.rules || []).some((r) => (r.capital || []).includes('lt500') && closers.some((c) => c.key === r.closer))
const baseOf = (ev, closers) => {
  const lt = lt500Rule(ev, closers)
  return {
    cap: { lt500: lt ? 'slot' : 'block', '500-1000': lt ? 'slot' : 'ask', '1000-3000': lt ? 'slot' : 'ask', gt3000: lt ? 'slot' : 'ask' },
    have: { yes: 'slot', soon: 'when', no: 'block2' },
    q: { cap_title: '', have_title: '', cap_labels: {}, have_labels: {} },
  }
}
const mergeQ = (base, saved) => ({
  cap: { ...base.cap, ...(saved?.cap || {}) },
  have: { ...base.have, ...(saved?.have || {}) },
  q: { ...base.q, ...(saved?.q || {}), cap_labels: { ...(saved?.q?.cap_labels || {}) }, have_labels: { ...(saved?.q?.have_labels || {}) } },
})
// Ce qui est vraiment enregistré : seulement ce qui diffère du réglage par défaut des textes ; les destinations sont enregistrées en entier.
const clean = (v) => ({
  cap: v.cap, have: v.have,
  q: {
    cap_title: (v.q.cap_title || '').trim(), have_title: (v.q.have_title || '').trim(),
    cap_labels: Object.fromEntries(Object.entries(v.q.cap_labels || {}).map(([k, t]) => [k, (t || '').trim()]).filter(([, t]) => t)),
    have_labels: Object.fromEntries(Object.entries(v.q.have_labels || {}).map(([k, t]) => [k, (t || '').trim()]).filter(([, t]) => t)),
  },
})

/**
 * Questions du formulaire d'un événement : ce qui se passe après chaque réponse aux questions de budget, et les textes de ces questions.
 * Ordinateur uniquement (dans Événements).
 */
export default function Questions({ event, closers, toast, onSaved }) {
  const base = useMemo(() => baseOf(event, closers), [event.rules, closers])
  const saved = useMemo(() => clean(mergeQ(base, event.qual)), [base, event.qual])
  const [v, setV] = useState(() => mergeQ(base, event.qual)); const [busy, setBusy] = useState(false)
  useEffect(() => { setV(mergeQ(base, event.qual)) }, [event.id, event.updated_at, base])
  const dirty = !same(clean(v), saved)
  const custom = event.qual != null
  const setCap = (k, a) => setV({ ...v, cap: { ...v.cap, [k]: a } })
  const setHave = (k, d) => setV({ ...v, have: { ...v.have, [k]: d } })
  const setQ = (patch) => setV({ ...v, q: { ...v.q, ...patch } })
  const setLbl = (group, k, t) => setQ({ [group]: { ...(v.q[group] || {}), [k]: t } })
  const outcome = (cap, a) => { const c = v.cap[cap]; return c === 'ask' ? v.have[a] : c }

  const save = async (next) => {
    setBusy(true)
    const { data, error } = await supabase.from('cand_events').update({ qual: next, updated_at: new Date().toISOString() }).eq('id', event.id).select().single()
    setBusy(false)
    if (error) return toast(friendlyError(error), true)
    toast(next ? 'Questions enregistrées' : 'Réglage habituel remis'); onSaved?.(data)
  }
  const reset = () => { if (window.confirm('Remettre le réglage habituel ? Les destinations et les textes personnalisés de cet événement seront effacés.')) save(null) }

  return <section className="rt-card qf">
    <h3 className="rt-h">Questions du formulaire <small>ce qui se passe après chaque réponse</small></h3>
    <p className="muted s12">Le formulaire pose ces deux questions sur le budget. Tu choisis où part la personne selon ce qu’elle répond, et tu peux changer les textes. Les autres questions (prénom, situation, expérience, blocage…) restent identiques pour tous les événements.</p>

    <div className="rt-rule">
      <div className="rt-rh"><b>Question 4 · le montant</b></div>
      <label className="qf-l">Texte de la question<input className="ti" value={v.q.cap_title || ''} placeholder={CAP_T} onChange={(e) => setQ({ cap_title: e.target.value })} /></label>
      {AMOUNTS.map(([k, d]) => <div key={k} className="rt-row qf-row">
        <input className="ti qf-t" value={v.q.cap_labels?.[k] || ''} placeholder={d} aria-label={`Texte du choix ${d}`} onChange={(e) => setLbl('cap_labels', k, e.target.value)} />
        <select className="rt-sel qf-s" value={v.cap[k]} onChange={(e) => setCap(k, e.target.value)} aria-label={`Après « ${d} »`}>{CAP_ACT.map(([a, l]) => <option key={a} value={a}>{l}</option>)}</select>
      </div>)}
      <p className="muted s12 rt-hint">« Selon sa réponse » = la personne passe à la question 5, et sa réponse décide. Les deux autres choix posent quand même la question 5 (pour garder la réponse sur sa fiche) mais l’ignorent.</p>
    </div>

    <div className="rt-rule">
      <div className="rt-rh"><b>Question 5 · « Tu peux vraiment mobiliser ce budget maintenant ? »</b></div>
      <label className="qf-l">Texte de la question<input className="ti" value={v.q.have_title || ''} placeholder={HAVE_T} onChange={(e) => setQ({ have_title: e.target.value })} /></label>
      {ANSWERS.map(([k, d]) => <div key={k} className="rt-row qf-row">
        <input className="ti qf-t" value={v.q.have_labels?.[k] || ''} placeholder={d} aria-label={`Texte de la réponse ${d}`} onChange={(e) => setLbl('have_labels', k, e.target.value)} />
        <select className="rt-sel qf-s" value={v.have[k]} onChange={(e) => setHave(k, e.target.value)} aria-label={`Quand la réponse est « ${d} »`}>{DEST.map(([a, l]) => <option key={a} value={a}>{l}</option>)}</select>
      </div>)}
    </div>

    <div className="qf-sum">
      <b>Résultat pour chaque profil</b>
      <div className="qf-grid" role="table" aria-label="Résultat pour chaque profil">
        <span role="columnheader" />{ANSWERS.map(([k, d]) => <span key={k} role="columnheader" className="qf-h">{k === 'yes' ? 'Dit oui' : k === 'soon' ? 'Dit pas encore' : 'Dit non'}</span>)}
        {AMOUNTS.map(([c, d]) => [<span key={c} role="rowheader" className="qf-r">{(v.q.cap_labels?.[c] || '').trim() || d}</span>,
          ...ANSWERS.map(([a]) => { const o = outcome(c, a); return <span key={c + a} role="cell"><span className={`badge ${o === 'slot' ? 'ok' : o === 'when' ? 'wait' : 'done'}`}>{DEST_SHORT[o]}</span></span> })])}
      </div>
    </div>

    <div className={`rt-save ${dirty ? 'dirty' : ''}`}>
      <span>{dirty ? 'Modifications non enregistrées' : custom ? 'Réglage personnalisé enregistré' : 'Réglage habituel (rien de personnalisé)'}</span>
      <span className="qf-act">{custom && <button type="button" className="btn ghost sm" disabled={busy} onClick={reset}>Remettre le réglage habituel</button>}
        <button type="button" className="btn" disabled={!dirty || busy} onClick={() => save(clean(v))}>{busy ? '…' : 'Enregistrer les questions'}</button></span>
    </div>
  </section>
}
