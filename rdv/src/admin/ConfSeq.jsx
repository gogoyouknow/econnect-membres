import { useEffect, useMemo, useState } from 'react'
import { supabase, friendlyError } from './supabase'
import { openWA, waWeb } from './whatsapp'

const CN = { clement: 'Clément', amandine: 'Amandine' }
const cname = (k) => CN[k] || (k ? k[0].toUpperCase() + k.slice(1) : 'Clément')
const TZ = 'Europe/Paris'
const heure = (d) => d.toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).replace(':', 'h')
const dateFr = (d) => d.toLocaleDateString('fr-FR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }) + ' à ' + heure(d)
const fill = (tpl, c) => { const d = new Date(c.starts_at); return String(tpl || '').replace(/\{prenom\}/g, c.first_name || '').replace(/\{date\}/g, dateFr(d)).replace(/\{heure\}/g, heure(d)).replace(/\{closer\}/g, cname(c.closer)).replace(/\{(lien_wa|bouton)\}/g, '') }
const ANCHOR = { after: 'après la réservation', before: 'avant l’appel', release: 'avant la libération du créneau' }
export const human = (m) => { const n = Number(m) || 0; if (n === 0) return '0 min'; if (n % 1440 === 0) return n / 1440 + ' j'; if (n % 60 === 0) return n / 60 + ' h'; return n + ' min' }
const dueAt = (st, c, relH) => { const cr = new Date(c.created_at).getTime(), s = new Date(c.starts_at).getTime(), m = st.minutes * 60000
  return st.anchor === 'after' ? cr + m : st.anchor === 'before' ? s - m : cr + relH * 3600000 - m }

function useSeq() {
  const [seq, setSeq] = useState(null); const [relH, setRelH] = useState(4)
  const load = () => Promise.all([supabase.from('cand_cseq').select('*').order('pos'), supabase.from('cand_settings').select('release_hours').eq('id', 1).maybeSingle()])
    .then(([a, b]) => { setSeq(a.data || []); if (b.data) setRelH(b.data.release_hours) })
  useEffect(() => { load() }, [])
  return { seq, relH, load }
}

/** Messages WhatsApp de la séquence arrivés à échéance : un tap pour ouvrir WhatsApp avec le texte prêt. */
export function ToSend({ rows, toast, reload }) {
  const { seq, relH } = useSeq(); const [, tick] = useState(0)
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 60000); return () => clearInterval(i) }, [])
  const now = Date.now()
  const todo = useMemo(() => {
    const out = []
    for (const st of (seq || []).filter((s) => s.active && s.channel === 'whatsapp'))
      for (const c of rows) {
        if (!['reserve', 'confirme'].includes(c.status) || !c.phone || (c.cseq_sent || []).includes(st.id) || (st.only_unconfirmed && c.status !== 'reserve')) continue
        const due = dueAt(st, c, relH)
        if (due > now || due < now - 6 * 3600000 || new Date(c.starts_at).getTime() < now || (st.anchor !== 'after' && due < new Date(c.created_at).getTime())) continue
        out.push({ st, c, due })
      }
    return out.sort((a, b) => a.due - b.due)
  }, [seq, rows, relH, Math.floor(now / 60000)])
  const mark = async ({ st, c }) => { const { error } = await supabase.from('candidatures').update({ cseq_sent: [...(c.cseq_sent || []), st.id] }).eq('id', c.id); if (error) return toast(friendlyError(error), true); reload() }
  if (!todo.length) return null
  return <div className="cs-send"><div className="lq">À envoyer sur WhatsApp · {todo.length}</div>
    {todo.map((t) => { const txt = fill(t.st.body, t.c); return <div key={t.st.id + '-' + t.c.id} className="cs-row">
      <div><b>{t.c.first_name || 'Sans nom'}</b><small>{t.st.label} · appel {dateFr(new Date(t.c.starts_at))}</small></div>
      <div className="acts">
        <a className="btn wa sm" style={{ textDecoration: 'none' }} href={waWeb(t.c.phone, txt)} target="_blank" rel="noreferrer" onClick={(e) => { openWA(e, t.c.phone, txt); mark(t) }}>Envoyer</a>
        <button className="btn ghost sm" onClick={() => mark(t)}>Déjà fait</button></div></div> })}
  </div>
}

/** Éditeur de la séquence de confirmation (messages avant / après la réservation). */
export function ConfSeqEditor({ toast }) {
  const { seq, load } = useSeq(); const [rows, setRows] = useState(null)
  useEffect(() => { if (seq) setRows(seq.map((s) => ({ ...s }))) }, [seq])
  if (!rows) return null
  const ok = async (p) => { const { error } = await p; if (error) { toast(friendlyError(error), true); return false } return true }
  const chg = (id, k, v) => setRows(rows.map((r) => (r.id === id ? { ...r, [k]: v } : r)))
  const save = async (s) => { if (await ok(supabase.from('cand_cseq').update({ label: s.label, anchor: s.anchor, minutes: Math.max(0, Number(s.minutes) || 0), channel: s.channel, subject: s.channel === 'email' ? s.subject : '', body: s.body, only_unconfirmed: !!s.only_unconfirmed, active: !!s.active }).eq('id', s.id))) { toast('Enregistré'); load() } }
  const del = async (s) => { if (window.confirm(`Supprimer l’étape « ${s.label} » ?`) && await ok(supabase.from('cand_cseq').delete().eq('id', s.id))) load() }
  const add = async () => { const pos = Math.max(0, ...rows.map((r) => r.pos)) + 1; if (await ok(supabase.from('cand_cseq').insert({ pos, label: 'Nouveau message', anchor: 'before', minutes: 60, channel: 'whatsapp', body: 'Salut {prenom}, c’est {closer}. ' }))) load() }
  const sample = { first_name: 'Karim', starts_at: new Date(Date.now() + 86400000).toISOString(), closer: 'clement' }
  return <details className="settings msgs">
    <summary>Séquence de confirmation ({rows.filter((r) => r.active).length} messages actifs)</summary>
    <p className="muted s12">Ces messages partent autour de chaque rendez-vous. Les <b>emails</b> partent tout seuls. Les messages <b>WhatsApp</b> apparaissent en haut de « À venir » au bon moment : tu n’as qu’à taper « Envoyer ». Variables : {'{prenom}'} {'{date}'} {'{heure}'} {'{closer}'} {'{lien_wa}'} {'{bouton}'} (bouton vert « Je confirme sur WhatsApp », email seulement).</p>
    {[...rows].sort((a, b) => (a.anchor === 'after' ? 0 : a.anchor === 'release' ? 1 : 2) - (b.anchor === 'after' ? 0 : b.anchor === 'release' ? 1 : 2) || (a.anchor === 'before' ? b.minutes - a.minutes : a.minutes - b.minutes)).map((s) => <div key={s.id} className={`seqedit cs-step ${s.active ? '' : 'off'}`}>
      <div className="cs-top"><input className="ti" value={s.label} onChange={(e) => chg(s.id, 'label', e.target.value)} />
        <label className="tgl"><input type="checkbox" checked={s.active} onChange={(e) => chg(s.id, 'active', e.target.checked)} />Actif</label></div>
      <div className="cs-when">
        <select value={s.channel} onChange={(e) => chg(s.id, 'channel', e.target.value)}><option value="email">Email (automatique)</option><option value="whatsapp">WhatsApp (à envoyer)</option></select>
        <label className="inl"><input type="number" min="0" value={s.minutes} onChange={(e) => chg(s.id, 'minutes', e.target.value)} />min</label>
        <select value={s.anchor} onChange={(e) => chg(s.id, 'anchor', e.target.value)}><option value="after">après la réservation</option><option value="before">avant l’appel</option><option value="release">avant la libération du créneau</option></select>
      </div>
      <p className="muted s12">= {human(s.minutes)} {ANCHOR[s.anchor]}{s.anchor === 'before' && Number(s.minutes) >= 60 ? ` (${s.minutes} min)` : ''}</p>
      <label className="tgl"><input type="checkbox" checked={!!s.only_unconfirmed} onChange={(e) => chg(s.id, 'only_unconfirmed', e.target.checked)} />Seulement si la personne n’a pas encore confirmé</label>
      {s.channel === 'email' && <input className="ti" value={s.subject} onChange={(e) => chg(s.id, 'subject', e.target.value)} placeholder="Objet de l’email" />}
      <textarea rows={s.channel === 'email' ? 7 : 4} value={s.body} onChange={(e) => chg(s.id, 'body', e.target.value)} />
      {s.channel === 'whatsapp' && <div className="wprev">{fill(s.body, sample)}</div>}
      <div className="acts"><button className="btn sm" onClick={() => save(s)}>Enregistrer</button><button className="btn ghost sm" onClick={() => del(s)}>Supprimer</button></div>
    </div>)}
    <button className="btn ghost sm" onClick={add}>+ Ajouter un message</button>
  </details>
}
