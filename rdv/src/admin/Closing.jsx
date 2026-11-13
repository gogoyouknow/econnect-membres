import { useEffect, useMemo, useState } from 'react'
import { usePS } from './persist'
import { supabase, friendlyError } from './supabase'
import LoadErr from './LoadErr'
import { closerName, useCloserNames } from './closerNames'

export const OUTCOMES = [['signe', 'Signé'], ['reflechit', 'Il réfléchit'], ['perdu', 'Pas signé']]
const PERIODS = [['7', '7 jours'], ['30', '30 jours'], ['90', '90 jours'], ['all', 'Tout']]
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null)
const fmt = (v) => (v == null ? '–' : v + ' %')
const eur = (v) => (v == null ? '–' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €')
const cname = closerName

function stats(list) {
  const done = list.filter((c) => c.status === 'fait'), abs = list.filter((c) => c.status === 'absent')
  const sigL = done.filter((c) => c.outcome === 'signe'), sig = sigL.length, montant = sigL.reduce((a, c) => a + (Number(c.signed_amount) || 0), 0), nm = sigL.filter((c) => c.signed_amount != null).length,
    ref = done.filter((c) => c.outcome === 'reflechit').length
  const per = done.filter((c) => c.outcome === 'perdu').length, none = done.length - sig - ref - per
  return { prevus: done.length + abs.length, realises: done.length, absents: abs.length, signes: sig, montant, panier: nm ? Math.round(montant / nm) : null, reflechit: ref, perdus: per, sans: none,
    presence: pct(done.length, done.length + abs.length), closing: pct(sig, done.length) }
}
const weekStart = (iso) => { const d = new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'Europe/Paris' })); const w = (d.getDay() + 6) % 7; d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - w); return d }

/** « Closé à combien ? » : montant signé, affiché dès que le résultat est « Signé ». */
function AmountField({ c, onAmount }) {
  const [v, setV] = useState(c.signed_amount == null ? '' : String(c.signed_amount))
  useEffect(() => { setV(c.signed_amount == null ? '' : String(c.signed_amount)) }, [c.signed_amount, c.id])
  const save = () => {
    const n = v.trim() === '' ? null : Number(v.replace(',', '.').replace(/\s/g, ''))
    if (n != null && (!Number.isFinite(n) || n < 0)) return
    if (n !== (c.signed_amount == null ? null : Number(c.signed_amount))) onAmount(c, n)
  }
  return <label className="cl-amt"><span>Closé à combien ?</span>
    <div><input type="text" inputMode="decimal" placeholder="Montant" value={v} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} /><i>€</i>
      <button type="button" className="btn sm" onClick={save}>OK</button></div></label>
}

export function OutcomeChips({ c, onPick, onAmount }) {
  return <div className="outc-wrap"><div className="chips outc" role="group" aria-label="Résultat de l'appel">
    {OUTCOMES.map(([v, l]) => <button key={v} className={`chip ${c.outcome === v ? 'sel' : ''} oc-${v}`} onClick={() => onPick(c, c.outcome === v ? null : v)}>{l}</button>)}
  </div>{c.outcome === 'signe' && onAmount && <AmountField c={c} onAmount={onAmount} />}</div>
}

/** Onglet « Closing » : taux de closing global, par closer et par semaine, + appels dont le résultat reste à renseigner. */
export default function Closing({ toast }) {
  useCloserNames()
  const [rows, setRows] = useState(null); const [per, setPer] = usePS('cl_per', '30'); const [err, setErr] = useState('')
  const load = () => supabase.from('candidatures').select('id,first_name,starts_at,status,closer,outcome,outcome_at,signed_amount').order('starts_at', { ascending: false }).limit(2000)
    .then(({ data, error }) => { if (error) return setErr(friendlyError(error)); setErr(''); setRows(data || []) })
  useEffect(() => { load(); const i = setInterval(load, 60000); return () => clearInterval(i) }, [])
  const pick = async (c, v) => {
    const patch = { outcome: v, outcome_at: v ? new Date().toISOString() : null }
    if (v !== 'signe') patch.signed_amount = null
    setRows((r) => r.map((x) => (x.id === c.id ? { ...x, ...patch } : x)))
    const { error } = await supabase.from('candidatures').update(patch).eq('id', c.id)
    if (error) { toast(friendlyError(error), true); load() } else toast(v ? 'Résultat enregistré' : 'Résultat retiré')
  }
  const amount = async (c, n) => {
    setRows((r) => r.map((x) => (x.id === c.id ? { ...x, signed_amount: n } : x)))
    const { error } = await supabase.from('candidatures').update({ signed_amount: n }).eq('id', c.id)
    if (error) { toast(friendlyError(error), true); load() } else toast(n == null ? 'Montant retiré' : 'Montant enregistré : ' + eur(n))
  }
  const now = Date.now()
  const inPer = useMemo(() => (rows || []).filter((c) => ['fait', 'absent'].includes(c.status) && new Date(c.starts_at).getTime() <= now && (per === 'all' || new Date(c.starts_at).getTime() >= now - Number(per) * 864e5)), [rows, per])
  const total = stats(inPer)
  const byCloser = useMemo(() => { const m = new Map(); inPer.forEach((c) => { const k = c.closer || 'clement'; if (!m.has(k)) m.set(k, []); m.get(k).push(c) }); return [...m.entries()].map(([k, l]) => [k, stats(l)]).sort((a, b) => b[1].realises - a[1].realises) }, [inPer])
  const weeks = useMemo(() => { const m = new Map(); inPer.forEach((c) => { const k = weekStart(c.starts_at).getTime(); if (!m.has(k)) m.set(k, []); m.get(k).push(c) }); return [...m.entries()].sort((a, b) => b[0] - a[0]).slice(0, 8).map(([k, l]) => [k, stats(l)]) }, [inPer])
  const todo = useMemo(() => (rows || []).filter((c) => c.status === 'fait' && (!c.outcome || (c.outcome === 'signe' && c.signed_amount == null))), [rows])

  if (err && !rows) return <div className="sheet-body"><LoadErr msg={err} onRetry={load} /></div>
  if (!rows) return <div className="sheet-body"><p className="muted">Chargement…</p></div>
  const wlabel = (t) => { const d = new Date(t); return 'Sem. du ' + d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) }
  const cols = [['Prévus', 'prevus'], ['Réalisés', 'realises'], ['Absents', 'absents'], ['Signés', 'signes'], ['Il réfléchit', 'reflechit'], ['Pas signés', 'perdus']]

  return <div className="sheet-body cl">
    <div className="cl-head"><div><h2 className="sh">Closing</h2><p className="muted">Taux de closing = signés ÷ appels réalisés.</p></div>
      <div className="chips cl-per">{PERIODS.map(([v, l]) => <button key={v} className={`chip ${per === v ? 'sel' : ''}`} onClick={() => setPer(v)}>{l}</button>)}</div></div>

    <div className="cl-kpis">
      <div className="cl-k big"><span>Taux de closing</span><b>{fmt(total.closing)}</b><small>{total.signes} signé{total.signes > 1 ? 's' : ''} sur {total.realises} appel{total.realises > 1 ? 's' : ''} réalisé{total.realises > 1 ? 's' : ''}</small>
        <div className="cl-bar"><i style={{ width: (total.closing || 0) + '%' }} /></div></div>
      <div className="cl-k"><span>Taux de présence</span><b>{fmt(total.presence)}</b><small>{total.realises} venus sur {total.prevus}</small></div>
      <div className="cl-k"><span>Montant signé</span><b>{eur(total.montant)}</b><small>{total.panier != null ? 'panier moyen ' + eur(total.panier) : 'à renseigner sur chaque signé'}</small></div>
      <div className="cl-k"><span>Il réfléchit</span><b>{total.reflechit}</b><small>à relancer</small></div>
      <div className="cl-k"><span>À renseigner</span><b className={todo.length ? 'warn' : ''}>{todo.length}</b><small>résultat ou montant manquant</small></div>
    </div>

    {todo.length > 0 && <><h3 className="cl-h">Résultat à renseigner</h3>
      <div className="cl-todo">{todo.slice(0, 30).map((c) => <div key={c.id} className="cl-row">
        <div><b>{c.first_name || 'Sans nom'}</b><small>{new Date(c.starts_at).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short' })} · avec {cname(c.closer)}</small></div>
        <OutcomeChips c={c} onPick={pick} onAmount={amount} /></div>)}</div></>}

    <h3 className="cl-h">Par closer</h3>
    {byCloser.length === 0 ? <p className="muted">Aucun appel réalisé sur cette période.</p> : <>
      <div className="cl-cards">{byCloser.map(([k, s]) => <div key={k} className="cl-card">
        <div className="cl-ct"><b>{cname(k)}</b><span className="cl-rate">{fmt(s.closing)}</span></div>
        <div className="cl-bar"><i style={{ width: (s.closing || 0) + '%' }} /></div>
        <dl>{cols.map(([l, f]) => <div key={f}><dt>{l}</dt><dd>{s[f]}</dd></div>)}<div><dt>Montant</dt><dd>{eur(s.montant)}</dd></div><div><dt>Présence</dt><dd>{fmt(s.presence)}</dd></div></dl></div>)}</div>
      <div className="cl-table"><table><thead><tr><th>Closer</th>{cols.map(([l]) => <th key={l}>{l}</th>)}<th>Montant</th><th>Présence</th><th>Closing</th></tr></thead>
        <tbody>{byCloser.map(([k, s]) => <tr key={k}><td><b>{cname(k)}</b></td>{cols.map(([, f]) => <td key={f}>{s[f]}</td>)}<td>{eur(s.montant)}</td><td>{fmt(s.presence)}</td><td><b>{fmt(s.closing)}</b></td></tr>)}
          <tr className="tot"><td><b>Total</b></td>{cols.map(([, f]) => <td key={f}>{total[f]}</td>)}<td>{eur(total.montant)}</td><td>{fmt(total.presence)}</td><td><b>{fmt(total.closing)}</b></td></tr></tbody></table></div></>}

    {weeks.length > 0 && <><h3 className="cl-h">Semaine par semaine</h3>
      <div className="cl-weeks">{weeks.map(([k, s]) => <div key={k} className="cl-w"><span>{wlabel(k)}</span><div className="cl-bar"><i style={{ width: (s.closing || 0) + '%' }} /></div><b>{fmt(s.closing)}</b><small>{s.signes}/{s.realises}</small></div>)}</div></>}
    {total.sans > 0 && <p className="muted small">{total.sans} appel{total.sans > 1 ? 's' : ''} réalisé{total.sans > 1 ? 's' : ''} sans résultat : il{total.sans > 1 ? 's' : ''} comptent comme non signé{total.sans > 1 ? 's' : ''} tant que tu ne les renseignes pas.</p>}
  </div>
}
