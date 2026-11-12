import { useEffect, useState } from 'react'
import { supabase, friendlyError } from './supabase'
import Portal from './Portal'

const REASONS = [['no_show', 'No-show'], ['silence', 'Plus de nouvelles'], ['autre', 'Manque de respect']]
const RL = Object.fromEntries(REASONS)
const KL = { email: 'Email', phone: 'Téléphone', ip: 'Adresse IP' }
const fmt = (d) => new Date(d).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Fenêtre « Bloquer » : à partir d'une candidature ou d'une fiche prospect. La personne ne pourra plus réserver ni recevoir d'emails. */
export function BlockModal({ who, onClose, toast, onDone }) {
  const [k, setK] = useState({ email: !!who.email, phone: !!who.phone, ip: true })
  const [reason, setReason] = useState('no_show'); const [note, setNote] = useState(''); const [cancel, setCancel] = useState(true); const [busy, setBusy] = useState(false)
  const go = async () => {
    const kinds = Object.keys(k).filter((x) => k[x]); if (!kinds.length) return toast('Coche au moins une chose à bloquer.', true)
    setBusy(true)
    const { data, error } = await supabase.rpc('block_add', { p: { cand_id: who.cand_id || null, lead_id: who.lead_id || null, kinds, reason, note, cancel } })
    setBusy(false)
    if (error) return toast(friendlyError(error), true)
    toast(`Bloqué${data?.cancelled ? ' · rendez-vous annulé' : ''}${data?.ips ? ` · ${data.ips} adresse${data.ips > 1 ? 's' : ''} IP` : ''}`)
    onDone?.(); onClose()
  }
  return <Portal><div className="pr-modal" onClick={onClose}><div className="pr-mb" onClick={(e) => e.stopPropagation()}>
    <h3>Bloquer {who.name || 'cette personne'}</h3>
    <p className="muted" style={{ fontSize: 13 }}>Si elle revient (même avec un autre prénom), elle ne pourra plus réserver d'appel : un message lui explique qu'elle a été bloquée volontairement. Plus aucun email ni relance ne part.</p>
    <div className="lq">Ce qu'on bloque</div>
    <label className="showpw"><input type="checkbox" checked={k.email} disabled={!who.email} onChange={(e) => setK({ ...k, email: e.target.checked })} /> Son email{who.email ? '' : ' (inconnu)'}</label>
    <label className="showpw"><input type="checkbox" checked={k.phone} disabled={!who.phone} onChange={(e) => setK({ ...k, phone: e.target.checked })} /> Son téléphone{who.phone ? '' : ' (inconnu)'}</label>
    <label className="showpw"><input type="checkbox" checked={k.ip} onChange={(e) => setK({ ...k, ip: e.target.checked })} /> Ses adresses IP (si connues)</label>
    <p className="muted" style={{ fontSize: 12, margin: '2px 0 8px' }}>Une IP peut être partagée (4G, wifi d'une famille) : si tu doutes, décoche-la, l'email et le téléphone suffisent déjà.</p>
    <div className="lq">Pourquoi</div>
    <div className="chips">{REASONS.map(([v, l]) => <button key={v} type="button" className={`chip ${reason === v ? 'sel' : ''}`} onClick={() => setReason(v)}>{l}</button>)}</div>
    <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note pour toi (facultatif)" style={{ marginTop: 8 }} />
    <label className="showpw"><input type="checkbox" checked={cancel} onChange={(e) => setCancel(e.target.checked)} /> Annuler son rendez-vous à venir</label>
    <div className="acts"><button className="btn danger" disabled={busy} onClick={go}>{busy ? '…' : 'Bloquer'}</button><button className="btn ghost" onClick={onClose}>Annuler</button></div>
  </div></div></Portal>
}

/** Liste des blocages : voir qui est bloqué, si la personne a retenté, débloquer, ajouter à la main. */
export default function Blocages({ toast }) {
  const [rows, setRows] = useState(null); const [hits, setHits] = useState({}); const [f, setF] = useState({ kind: 'email', value: '', reason: 'no_show', note: '' }); const [busy, setBusy] = useState(false); const [old, setOld] = useState(false)
  const load = async () => {
    const [a, b] = await Promise.all([
      supabase.from('cand_blocks').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('cand_block_hits').select('block_id,at,via,first_name').order('at', { ascending: false }).limit(1000)])
    if (a.error) return toast(friendlyError(a.error), true)
    setRows(a.data || [])
    const m = {}; (b.data || []).forEach((h) => { (m[h.block_id] ||= []).push(h) }); setHits(m)
  }
  useEffect(() => { load() }, [])
  const add = async (e) => {
    e.preventDefault(); const v = f.value.trim(); if (!v) return toast('Indique la valeur à bloquer.', true)
    setBusy(true)
    const p = { reason: f.reason, note: f.note, kinds: [f.kind], cancel: true, [f.kind]: v }
    const { error } = await supabase.rpc('block_add', { p }); setBusy(false)
    if (error) return toast(friendlyError(error), true)
    toast('Bloqué'); setF({ ...f, value: '', note: '' }); load()
  }
  const unblock = async (r) => {
    if (!window.confirm(`Débloquer ${r.shown || r.value} ? La personne pourra de nouveau réserver.`)) return
    const { error } = await supabase.rpc('block_remove', { p_id: r.id }); if (error) return toast(friendlyError(error), true); toast('Débloqué'); load()
  }
  if (!rows) return <p className="muted">Chargement…</p>
  const act = rows.filter((r) => r.active); const past = rows.filter((r) => !r.active)
  const nHits = (r) => (hits[r.id] || []).length
  return <div className="clrs">
    <p className="muted s12">Les personnes bloquées ne peuvent plus réserver d'appel et ne reçoivent plus aucun email. Si elles reviennent, un message leur explique que le blocage est volontaire. Pour bloquer quelqu'un, ouvre sa fiche (Appels ou Prospects) puis « Bloquer ».</p>
    <form className="msgbox clform" onSubmit={add}>
      <b>Bloquer à la main</b>
      <div className="chips">{Object.entries(KL).map(([v, l]) => <button key={v} type="button" className={`chip ${f.kind === v ? 'sel' : ''}`} onClick={() => setF({ ...f, kind: v })}>{l}</button>)}</div>
      <input className="ti" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} placeholder={f.kind === 'email' ? 'prenom@gmail.com' : f.kind === 'phone' ? '06 12 34 56 78' : '203.0.113.42'} inputMode={f.kind === 'phone' ? 'tel' : undefined} autoCapitalize="none" />
      <div className="chips">{REASONS.map(([v, l]) => <button key={v} type="button" className={`chip ${f.reason === v ? 'sel' : ''}`} onClick={() => setF({ ...f, reason: v })}>{l}</button>)}</div>
      <input className="ti" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Note (facultatif)" />
      <button className="btn" disabled={busy}>{busy ? '…' : 'Bloquer'}</button>
    </form>
    <h3 className="cl-h">Bloqués ({act.length})</h3>
    {!act.length && <div className="sys">Personne n'est bloqué pour l'instant</div>}
    {act.map((r) => <div key={r.id} className="cl-card clr">
      <div className="cl-ct"><b>{KL[r.kind]} · {r.shown || r.value}</b><span className="badge wait">{RL[r.reason] || r.reason}</span></div>
      <small className="muted">Le {fmt(r.created_at)}{r.note ? ` · ${r.note}` : ''}</small>
      {nHits(r) > 0 && <small style={{ color: '#92400E', fontWeight: 600 }}>A retenté {nHits(r)} fois · dernière fois le {fmt(hits[r.id][0].at)}</small>}
      <div className="acts"><button className="btn ghost sm" onClick={() => unblock(r)}>Débloquer</button></div>
    </div>)}
    {!!past.length && <button className="linkbtn" onClick={() => setOld(!old)}>{old ? 'Masquer' : 'Voir'} les anciens blocages ({past.length})</button>}
    {old && past.map((r) => <div key={r.id} className="cl-card clr off"><div className="cl-ct"><b>{KL[r.kind]} · {r.shown || r.value}</b><span className="badge off">Débloqué</span></div><small className="muted">Bloqué le {fmt(r.created_at)}</small></div>)}
  </div>
}
