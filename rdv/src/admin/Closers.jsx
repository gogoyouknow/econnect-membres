import { useEffect, useState } from 'react'
import { supabase, friendlyError } from './supabase'
import { copyText } from './copy'

const BOOK = (k) => `https://rdv.theambitiousman.fr/?closer_id=${k}`
const INVITE = (e) => `https://rdv.theambitiousman.fr/admin?join=1&email=${encodeURIComponent(e)}`
const fmtWa = (n) => { const d = String(n || '').replace(/\D/g, ''); return d.startsWith('33') ? '0' + d.slice(2).replace(/(\d)(?=(\d\d)+$)/g, '$1 ').trim() : '+' + d }

/** Équipe de closers : inviter par email, voir qui a créé son compte, copier les liens, retirer. */
export default function Closers({ toast }) {
  const [rows, setRows] = useState(null); const [f, setF] = useState({ name: '', email: '', wa: '' }); const [busy, setBusy] = useState(false); const [last, setLast] = useState(null)
  const load = () => supabase.from('cand_closers').select('*').order('key').then(({ data, error }) => { if (error) toast(friendlyError(error), true); else setRows(data || []) })
  useEffect(() => { load() }, [])
  const invite = async (p) => {
    setBusy(true)
    const { data, error } = await supabase.rpc('closer_invite', { p })
    setBusy(false)
    if (error) return toast(friendlyError(error), true)
    setLast({ ...data, name: p.name, email: p.email }); toast(`Invitation envoyée à ${p.email}`); setF({ name: '', email: '', wa: '' }); load()
  }
  const submit = (e) => { e.preventDefault(); if (!f.name.trim() || !f.email.trim() || !f.wa.trim()) return toast('Renseigne le prénom, l’email et le WhatsApp.', true); invite({ name: f.name, email: f.email, wa: f.wa }) }
  const remove = async (r) => {
    if (!window.confirm(`Retirer ${r.name} ? Son accès à Calio est coupé tout de suite. Ses rendez-vous restent dans Calio.`)) return
    const { error } = await supabase.rpc('closer_remove', { p_key: r.key }); if (error) return toast(friendlyError(error), true); toast(`${r.name} retiré`); load()
  }
  const saveWa = async (r, wa) => { const d = wa.replace(/\D/g, '').replace(/^0(?=\d{9}$)/, '33'); if (d.length < 9) return toast('Numéro WhatsApp invalide.', true); const { error } = await supabase.from('cand_closers').update({ wa_number: d }).eq('key', r.key); if (error) return toast(friendlyError(error), true); toast('Numéro enregistré'); load() }
  const copy = (t, m) => copyText(t, toast, m || 'Lien copié')
  if (!rows) return <p className="muted">Chargement…</p>
  const status = (r) => !r.active ? ['off', 'Retiré'] : r.key === 'clement' ? ['ok', 'Toi'] : r.user_id ? ['ok', 'Compte créé'] : r.email ? ['wait', 'Invitation envoyée'] : ['', 'Sans compte']
  return <div className="clrs">
    <p className="muted s12">Invite tes closers : ils reçoivent un email, créent leur compte, et ne voient que <b>leurs</b> appels et <b>leur</b> closing. Chaque closer a son lien de réservation : les rendez-vous pris avec ce lien lui sont attribués, et la confirmation WhatsApp va sur <b>son</b> numéro. Pour l’instant tous les closers partagent le même calendrier de disponibilités.</p>
    <form className="msgbox clform" onSubmit={submit}>
      <b>Inviter un closer</b>
      <input className="ti" placeholder="Prénom" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="off" />
      <input className="ti" type="email" inputMode="email" placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoCapitalize="none" autoComplete="off" />
      <input className="ti" inputMode="tel" placeholder="WhatsApp Business (06 12 34 56 78)" value={f.wa} onChange={(e) => setF({ ...f, wa: e.target.value })} autoComplete="off" />
      <button className="btn" disabled={busy}>{busy ? '…' : 'Envoyer l’invitation'}</button>
    </form>
    {last && <div className="cs-send clsent"><b>Invitation envoyée à {last.name}</b>
      <p className="muted s12">Si l’email n’arrive pas (spams…), envoie-lui directement ce lien :</p>
      <div className="acts"><button className="btn ghost sm" onClick={() => copy(last.link, 'Lien d’invitation copié')}>Copier le lien d’invitation</button><button className="btn ghost sm" onClick={() => copy(last.booking, 'Lien de réservation copié')}>Copier son lien de réservation</button></div></div>}
    <h3 className="cl-h">L’équipe</h3>
    {rows.map((r) => { const [cls, lab] = status(r); return <div key={r.key} className={`cl-card clr ${r.active ? '' : 'off'}`}>
      <div className="cl-ct"><b>{r.name}</b><span className={`badge ${cls}`}>{lab}</span></div>
      {r.email && <small className="muted">{r.email}</small>}
      <label className="clwa">WhatsApp Business
        <input className="ti" inputMode="tel" defaultValue={fmtWa(r.wa_number)} onBlur={(e) => e.target.value.replace(/\D/g, '') !== String(r.wa_number).replace(/\D/g, '') && e.target.value.replace(/\D/g, '') !== fmtWa(r.wa_number).replace(/\D/g, '') && saveWa(r, e.target.value)} /></label>
      <div className="acts">
        {r.active && <button className="btn ghost sm" onClick={() => copy(BOOK(r.key))}>Copier son lien de réservation</button>}
        {r.active && r.email && !r.user_id && <button className="btn ghost sm" onClick={() => invite({ name: r.name, email: r.email, wa: r.wa_number })}>Renvoyer l’invitation</button>}
        {r.active && r.email && !r.user_id && <button className="btn ghost sm" onClick={() => copy(INVITE(r.email), 'Lien d’invitation copié')}>Copier le lien d’invitation</button>}
        {r.active && !r.email && r.key !== 'clement' && <button className="btn sm" onClick={() => { setF({ name: r.name, email: '', wa: fmtWa(r.wa_number) }); window.scrollTo?.(0, 0); toast('Ajoute son email puis « Envoyer l’invitation »') }}>Inviter</button>}
        {r.key !== 'clement' && r.active && <button className="btn ghost sm" onClick={() => remove(r)}>Retirer</button>}
      </div></div> })}
  </div>
}
