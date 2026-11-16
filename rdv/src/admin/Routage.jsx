import { useEffect, useMemo, useState } from 'react'
import { supabase, friendlyError } from './supabase'

export const CAPS = [['lt500', 'Moins de 500 € (exception)'], ['500-1000', '500 – 1 000 €'], ['1000-3000', '1 000 – 3 000 €'], ['gt3000', 'Plus de 3 000 €']]
export const SITS = ['Salarié', 'Étudiant', 'Entrepreneur', 'Sans activité']
export const INVS = ['Non, jamais', 'Oui, une fois', 'Oui, plusieurs fois']
export const HAVES = [['yes', 'Oui, disponible maintenant'], ['soon', 'Pas encore (quelques semaines)'], ['no', 'Non, il ne l’a pas']]
const DQ = '__dq'
const PRIOS = [['haute', 'Haute'], ['moyenne', 'Moyenne'], ['basse', 'Basse'], ['off', 'Désactivé']]
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** Charge les closers actifs (pour les listes de choix). */
export function useClosers() {
  const [rows, setRows] = useState(null)
  useEffect(() => { supabase.from('cand_closers').select('key,name,active').order('key').then(({ data }) => setRows((data || []).filter((c) => c.active).sort((a, b) => (b.key === 'clement') - (a.key === 'clement') || a.name.localeCompare(b.name)))) }, [])
  return rows
}

const poolOf = (ev, closers) => closers.map((c) => ({ closer: c.key, prio: (ev.pool || []).find((p) => p.closer === c.key)?.prio || 'off' }))
const cleanRule = (r) => ({ closer: r.closer, capital: r.capital || [], situation: r.situation || [], invest: r.invest || [], have: r.have || [], source: (r.source || '').trim(), ...(r.closer === DQ ? { dq_page: r.dq_page === 'plus_tard' ? 'plus_tard' : 'methode' } : {}) })

/**
 * Répartition des appels : priorité des closers + règles par profil (arbre de décision).
 * Les règles passent dans l'ordre : la première qui correspond gagne. Sinon, la priorité décide.
 */
export function Routing({ event, closers, toast, onSaved }) {
  const [pool, setPool] = useState(() => poolOf(event, closers)); const [rules, setRules] = useState(() => (event.rules || []).map(cleanRule)); const [busy, setBusy] = useState(false)
  const [sim, setSim] = useState({ capital: 'gt3000', situation: 'Salarié', invest: '', have: 'yes', src: '' }); const [res, setRes] = useState(null)
  useEffect(() => { setPool(poolOf(event, closers)); setRules((event.rules || []).map(cleanRule)); setRes(null) }, [event.id, event.updated_at, closers.length])
  const saved = useMemo(() => ({ pool: poolOf(event, closers), rules: (event.rules || []).map(cleanRule) }), [event, closers])
  const dirty = !same(saved, { pool, rules })
  const name = (k) => closers.find((c) => c.key === k)?.name || k
  const setPrio = (k, prio) => setPool(pool.map((p) => (p.closer === k ? { ...p, prio } : p)))
  const setRule = (i, patch) => setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const toggle = (i, key, v) => { const cur = rules[i][key] || []; setRule(i, { [key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] }) }
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= rules.length) return; const n = [...rules];[n[i], n[j]] = [n[j], n[i]]; setRules(n) }
  const add = () => setRules([...rules, { closer: (closers.find((c) => c.key === 'clement') || closers[0])?.key, capital: [], situation: [], invest: [], have: [], source: '' }])
  const save = async () => {
    setBusy(true)
    const { data, error } = await supabase.from('cand_events').update({ pool, rules, updated_at: new Date().toISOString() }).eq('id', event.id).select().single()
    setBusy(false)
    if (error) return toast(friendlyError(error), true)
    toast('Répartition enregistrée'); onSaved?.(data)
  }
  const test = async () => {
    if (dirty) return toast('Enregistre d’abord : le test utilise la répartition enregistrée.', true)
    const { data, error } = await supabase.rpc('cand_route_test', { p_event: event.id, p_cap: sim.capital, p_sit: sim.situation, p_src: sim.src, p_inv: sim.invest || null, p_have: sim.have || null })
    if (error) return toast(friendlyError(error), true); setRes(data)
  }
  const noOne = !pool.some((p) => p.prio !== 'off')

  return <div className="rt">
    <section className="rt-card">
      <h3 className="rt-h">1 · Priorité des closers</h3>
      <p className="muted s12">Quand aucune règle ne correspond, l’appel va au closer le plus prioritaire. À priorité égale, à celui qui a le moins d’appels à venir. « Désactivé » = il ne reçoit pas d’appel automatiquement (une règle peut quand même lui en donner).</p>
      <div className="rt-pool">{pool.map((p) => <div key={p.closer} className={`rt-row ${p.prio === 'off' ? 'off' : ''}`}>
        <span className="rt-av">{name(p.closer)[0]}</span><b>{name(p.closer)}</b>
        <select value={p.prio} onChange={(e) => setPrio(p.closer, e.target.value)} aria-label={`Priorité de ${name(p.closer)}`} className={`rt-sel pr-${p.prio}`}>{PRIOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </div>)}</div>
      {noOne && <p className="rt-warn">Personne n’est actif dans la priorité : sans règle, l’appel ira à Clément par défaut.</p>}
    </section>

    <section className="rt-card">
      <h3 className="rt-h">2 · Règles par profil <small>l’ordre compte : la 1re qui correspond gagne</small></h3>
      {!rules.length && <p className="muted s12">Aucune règle. Exemple : « Si budget plus de 3 000 € → Clément ».</p>}
      {rules.map((r, i) => <div key={i} className="rt-rule">
        <div className="rt-rh"><b>Règle {i + 1}</b><span className="rt-mv">
          <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Monter">↑</button>
          <button type="button" onClick={() => move(i, 1)} disabled={i === rules.length - 1} aria-label="Descendre">↓</button>
          <button type="button" onClick={() => setRules(rules.filter((_, j) => j !== i))} aria-label="Supprimer la règle">✕</button></span></div>
        <div className="rt-if"><span>SI le budget est</span><div className="chips">{CAPS.map(([v, l]) => <button type="button" key={v} className={`chip ${r.capital.includes(v) ? 'sel' : ''}`} onClick={() => toggle(i, 'capital', v)}>{l}</button>)}</div></div>
        <div className="rt-if"><span>ET la situation est</span><div className="chips">{SITS.map((v) => <button type="button" key={v} className={`chip ${r.situation.includes(v) ? 'sel' : ''}`} onClick={() => toggle(i, 'situation', v)}>{v}</button>)}</div></div>
        <div className="rt-if"><span>ET « tu as déjà investi dans une formation ? »</span><div className="chips">{INVS.map((v) => <button type="button" key={v} className={`chip ${r.invest.includes(v) ? 'sel' : ''}`} onClick={() => toggle(i, 'invest', v)}>{v}</button>)}</div></div>
        <div className="rt-if"><span>ET « tu peux mobiliser ce budget maintenant ? »</span><div className="chips">{HAVES.map(([v, l]) => <button type="button" key={v} className={`chip ${r.have.includes(v) ? 'sel' : ''}`} onClick={() => toggle(i, 'have', v)}>{l}</button>)}</div></div>
        <div className="rt-if"><span>ET l’origine contient</span><input className="ti" placeholder="ex. instagram, tiktok, nom de campagne…" value={r.source} onChange={(e) => setRule(i, { source: e.target.value })} autoCapitalize="none" autoComplete="off" /></div>
        <p className="muted s12 rt-hint">{!r.capital.length && !r.situation.length && !r.invest.length && !r.have.length && !r.source.trim() ? 'Aucune condition : cette règle s’applique à tout le monde.' : 'Rien de coché dans une ligne = « peu importe ».'}{(r.have.includes('soon') || r.have.includes('no')) && ' Cocher « Pas encore » ou « Non » ouvre le calendrier à ces personnes (au lieu de les renvoyer vers une page d’attente) : leur appel va au closer choisi.'}</p>
        <div className="rt-then"><span>ALORS</span>
          <select value={r.closer} onChange={(e) => setRule(i, { closer: e.target.value, ...(e.target.value === DQ ? { dq_page: r.dq_page || 'methode' } : {}) })} className={`rt-sel ${r.closer === DQ ? 'rt-dq' : ''}`}>{closers.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}{r.closer !== DQ && !closers.some((c) => c.key === r.closer) && <option value={r.closer}>{r.closer} (retiré)</option>}<option value={DQ}>Disqualifier (pas d’appel)</option></select>
          {r.closer === DQ && <><span className="rt-then-s">Elle voit</span><select value={r.dq_page || 'methode'} onChange={(e) => setRule(i, { dq_page: e.target.value })} className="rt-sel"><option value="methode">La page Méthode (97 €)</option><option value="plus_tard">« Reviens quand ce sera le bon moment »</option></select></>}</div>
      </div>)}
      <button type="button" className="btn ghost sm" onClick={add}>+ Ajouter une règle</button>
      <p className="rt-else">Sinon → selon la priorité (1)</p>
    </section>

    <div className={`rt-save ${dirty ? 'dirty' : ''}`}>
      <span>{dirty ? 'Modifications non enregistrées' : 'Tout est enregistré'}</span>
      <button type="button" className="btn" disabled={!dirty || busy} onClick={save}>{busy ? '…' : 'Enregistrer la répartition'}</button>
    </div>

    <section className="rt-card">
      <h3 className="rt-h">Tester <small>à qui tomberait cet appel ?</small></h3>
      <div className="rt-sim">
        <select value={sim.capital} onChange={(e) => setSim({ ...sim, capital: e.target.value })}>{CAPS.map(([v, l]) => <option key={v} value={v}>Budget : {l}</option>)}</select>
        <select value={sim.situation} onChange={(e) => setSim({ ...sim, situation: e.target.value })}>{SITS.map((v) => <option key={v} value={v}>{v}</option>)}</select>
        <select value={sim.invest} onChange={(e) => setSim({ ...sim, invest: e.target.value })}><option value="">Formation : peu importe</option>{INVS.map((v) => <option key={v} value={v}>Formation : {v}</option>)}</select>
        <select value={sim.have} onChange={(e) => setSim({ ...sim, have: e.target.value })}>{HAVES.map(([v, l]) => <option key={v} value={v}>Budget dispo : {l}</option>)}</select>
        <input className="ti" placeholder="Origine (ex. TikTok)" value={sim.src} onChange={(e) => setSim({ ...sim, src: e.target.value })} autoCapitalize="none" />
        <button type="button" className="btn ghost sm" onClick={test}>Tester</button>
      </div>
      {res && <p className="rt-res">→ <b>{res.name || res.closer}</b> <span className="badge ok">{res.why}</span></p>}
    </section>
  </div>
}

/** Sous-onglet « Répartition » de Disponibilités : règle l’événement principal (le lien habituel). */
export default function Repartition({ toast }) {
  const closers = useClosers(); const [ev, setEv] = useState(null)
  useEffect(() => { supabase.from('cand_events').select('*').eq('main', true).limit(1).then(({ data, error }) => { if (error) toast(friendlyError(error), true); else setEv((data || [])[0] || null) }) }, [])
  if (!closers || !ev) return <p className="muted">Chargement…</p>
  return <div>
    <p className="muted s12">Décide <b>qui prend les appels</b> réservés avec ton lien habituel. Pour une pub ou une page précise, crée un lien perso dans « Événements » (sur ordinateur).</p>
    <Routing event={ev} closers={closers} toast={toast} onSaved={setEv} />
  </div>
}
