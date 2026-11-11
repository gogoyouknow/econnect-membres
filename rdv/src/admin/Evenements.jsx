import { useEffect, useMemo, useState } from 'react'
import { usePS } from './persist'
import { supabase, friendlyError } from './supabase'
import { copyText } from './copy'
import { Routing, useClosers } from './Routage'

const BASE = 'https://rdv.theambitiousman.fr'
const linkOf = (e) => (e.main ? BASE : `${BASE}/e/${e.slug}`)
const slugify = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) + ' %' : '–')

/** Événements : un lien de réservation par pub / page, avec sa propre répartition des appels. Ordinateur uniquement. */
export default function Evenements({ toast }) {
  const closers = useClosers(); const [rows, setRows] = useState(null); const [st, setSt] = useState([]); const [sel, setSel] = usePS('ev_sel', 0)
  const [nn, setNn] = useState({ name: '', from: 'main' }); const [busy, setBusy] = useState(false); const [q, setQ] = useState('')
  const load = async () => {
    const [a, b] = await Promise.all([
      supabase.from('cand_events').select('*').order('main', { ascending: false }).order('created_at'),
      supabase.from('candidatures').select('event_id,status,outcome,starts_at').limit(5000),
    ])
    if (a.error) return toast(friendlyError(a.error), true)
    setRows(a.data || []); setSt(b.data || [])
  }
  useEffect(() => { load() }, [])
  const cur = useMemo(() => rows?.find((r) => r.id === sel) || rows?.[0] || null, [rows, sel])
  const stats = (e) => {
    const mainId = rows.find((r) => r.main)?.id
    const l = st.filter((c) => (e.main ? c.event_id == null || c.event_id === mainId : c.event_id === e.id) && c.status !== 'annule')
    const done = l.filter((c) => c.status === 'fait'); const sig = done.filter((c) => c.outcome === 'signe').length
    return { total: l.length, avenir: l.filter((c) => (c.status === 'reserve' || c.status === 'confirme') && new Date(c.starts_at) > new Date()).length, done: done.length, sig, rate: pct(sig, done.length) }
  }
  const create = async (e) => {
    e.preventDefault(); const name = nn.name.trim(); if (!name) return toast('Donne un nom à l’événement.', true)
    let slug = slugify(name); if (slug.length < 2) slug = 'evenement'
    const taken = new Set(rows.map((r) => r.slug)); let s = slug, i = 2; while (taken.has(s)) s = `${slug.slice(0, 56)}-${i++}`
    const src = rows.find((r) => String(r.id) === String(nn.from)) || rows.find((r) => r.main)
    setBusy(true)
    const { data, error } = await supabase.from('cand_events').insert({ name, slug: s, pool: src?.pool || [], rules: src?.rules || [] }).select().single()
    setBusy(false); if (error) return toast(friendlyError(error), true)
    toast('Événement créé'); setNn({ name: '', from: 'main' }); await load(); setSel(data.id)
  }
  if (!rows || !closers) return <p className="muted">Chargement…</p>

  return <div className="ev">
    <div className="ev-head"><div><h2 className="sh">Événements</h2><p className="muted">Un lien de réservation par pub ou par page, avec ses propres closers, priorités et règles par profil.</p></div></div>
    <div className="ev-grid">
      <aside className="ev-list">
        <input className="ti ev-q" type="search" placeholder="Rechercher un événement…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="ev-items">{rows.filter((e) => !q.trim() || (e.name + ' ' + (e.slug || '') + ' ' + (e.notes || '')).toLowerCase().includes(q.trim().toLowerCase())).map((e) => { const s = stats(e); return <button key={e.id} className={`ev-item ${cur?.id === e.id ? 'on' : ''} ${e.active ? '' : 'off'}`} onClick={() => setSel(e.id)}>
          <b>{e.name}</b><small>{e.main ? 'Lien habituel' : `/e/${e.slug}`}{e.active ? '' : ' · désactivé'}</small>{e.notes && <small className="ev-note">{e.notes}</small>}
          <span className="ev-mini"><i>{s.total}</i> réservations · <i>{s.sig}</i> signés</span></button> })}</div>
        <form className="ev-new" onSubmit={create}>
          <b>Nouvel événement</b>
          <input className="ti" placeholder="Nom (ex. Pub TikTok novembre)" value={nn.name} onChange={(e) => setNn({ ...nn, name: e.target.value })} autoComplete="off" />
          <label className="muted s12">Copier la répartition de
            <select value={nn.from} onChange={(e) => setNn({ ...nn, from: e.target.value })}>{rows.map((r) => <option key={r.id} value={r.main ? 'main' : r.id}>{r.name}</option>)}</select></label>
          <button className="btn" disabled={busy}>{busy ? '…' : 'Créer l’événement'}</button>
        </form>
      </aside>
      {cur && <Editor key={cur.id} ev={cur} rows={rows} closers={closers} toast={toast} stats={stats(cur)} onChange={(d) => { setRows(rows.map((r) => (r.id === d.id ? d : r))) }} onDeleted={async () => { setSel(0); await load() }} />}
    </div>
  </div>
}

function Editor({ ev, rows, closers, toast, stats, onChange, onDeleted }) {
  const [f, setF] = useState({ name: ev.name, slug: ev.slug || '', source: ev.source || '', notes: ev.notes || '', active: ev.active }); const [busy, setBusy] = useState(false)
  const dirty = f.name !== ev.name || f.slug !== (ev.slug || '') || f.source !== (ev.source || '') || f.notes !== (ev.notes || '') || f.active !== ev.active
  const save = async () => {
    const name = f.name.trim(); if (!name) return toast('Le nom ne peut pas être vide.', true)
    const patch = { name, source: f.source.trim() || null, notes: f.notes.trim() || null, active: f.active, updated_at: new Date().toISOString() }
    if (!ev.main) {
      const slug = slugify(f.slug); if (slug.length < 2) return toast('Le lien doit faire au moins 2 caractères (lettres, chiffres, tirets).', true)
      if (rows.some((r) => r.id !== ev.id && r.slug === slug)) return toast('Ce lien existe déjà, choisis-en un autre.', true)
      patch.slug = slug
    }
    setBusy(true); const { data, error } = await supabase.from('cand_events').update(patch).eq('id', ev.id).select().single(); setBusy(false)
    if (error) return toast(friendlyError(error), true)
    toast('Événement enregistré'); onChange(data); setF({ name: data.name, slug: data.slug || '', source: data.source || '', notes: data.notes || '', active: data.active })
  }
  const del = async () => {
    if (!window.confirm(`Supprimer l’événement « ${ev.name} » ? Son lien ne sera plus personnalisé (il bascule sur la répartition habituelle). Les rendez-vous déjà pris restent dans Calio.`)) return
    const { error } = await supabase.from('cand_events').delete().eq('id', ev.id); if (error) return toast(friendlyError(error), true)
    toast('Événement supprimé'); onDeleted()
  }
  const url = linkOf({ ...ev, slug: slugify(f.slug) || ev.slug })
  return <div className="ev-edit">
    <section className="rt-card">
      <div className="ev-top"><h3 className="rt-h" style={{ margin: 0 }}>{ev.main ? 'Lien habituel' : 'Réglages'}</h3>
        {!ev.main && <label className="ev-act"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Actif</label>}</div>
      <div className="ev-f"><label>Nom<input className="ti" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        {!ev.main && <label>Lien personnalisé<span className="ev-slug"><i>{BASE.replace('https://', '')}/e/</i><input className="ti" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} autoCapitalize="none" autoComplete="off" /></span></label>}
        <label>Origine affichée sur les fiches prospects <small className="muted">(optionnel)</small><input className="ti" placeholder="ex. Pub TikTok" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} /></label>
        <label>Note interne <small className="muted">(pour toi, personne ne la voit)</small><input className="ti" placeholder="ex. VSL FB COD" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      </div>
      <div className="ev-link"><code>{url}</code><button type="button" className="btn ghost sm" onClick={() => copyText(url, toast, 'Lien copié')}>Copier le lien</button><a className="btn ghost sm" href={url} target="_blank" rel="noreferrer">Ouvrir</a></div>
      <p className="muted s12">{ev.main ? 'C’est le lien que tu utilises déjà. Les liens avec ?closer_id=… (lien personnel d’un closer) restent prioritaires.' : 'Tu peux ajouter tes paramètres de pub au bout du lien (?utm_campaign=…). Si tu désactives l’événement, le lien continue de marcher avec la répartition habituelle.'}</p>
      <div className="acts">{!ev.main && <button type="button" className="btn danger sm" onClick={del}>Supprimer</button>}<span style={{ flex: 1 }} /><button type="button" className="btn" disabled={!dirty || busy} onClick={save}>{busy ? '…' : 'Enregistrer'}</button></div>
    </section>
    <div className="ev-stats">{[['Réservations', stats.total], ['À venir', stats.avenir], ['Appels faits', stats.done], ['Signés', stats.sig], ['Taux de closing', stats.rate]].map(([l, v]) => <div key={l}><b>{v}</b><span>{l}</span></div>)}</div>
    <Routing event={ev} closers={closers} toast={toast} onSaved={onChange} />
  </div>
}
