import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/data'

const MONTHS = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc']
const when = (d) => new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', hour: '2-digit', minute: '2-digit' })
const rel = (d) => { const h = (new Date(d) - Date.now()) / 36e5; if (h < 0) return null; if (h < 1) return 'Dans ' + Math.max(1, Math.round(h * 60)) + ' min'; if (h < 48) return 'Dans ' + Math.round(h) + ' h'; return 'Dans ' + Math.round(h / 24) + ' j' }

export default function Lives({ me, isStaff, toast }) {
  const [lives, setLives] = useState([]); const [form, setForm] = useState(null)
  const load = () => supabase.from('lives').select('*').order('starts_at').then(({ data }) => setLives(data || []))
  useEffect(() => { load() }, [])
  const now = Date.now()
  const upcoming = lives.filter(l => new Date(l.starts_at).getTime() + l.duration_min * 60000 > now)
  const past = lives.filter(l => new Date(l.starts_at).getTime() + l.duration_min * 60000 <= now).reverse()

  async function save(e) {
    e.preventDefault(); const f = new FormData(e.target)
    const row = { title: f.get('title'), starts_at: new Date(f.get('starts_at')).toISOString(), duration_min: +f.get('duration_min') || 45, host: f.get('host'), link: f.get('link') || null, replay_url: f.get('replay_url') || null, tier_required: +f.get('tier') }
    const q = form?.id ? supabase.from('lives').update(row).eq('id', form.id) : supabase.from('lives').insert(row)
    const { error } = await q; if (error) return toast(friendlyError(error), true)
    toast(form?.id ? 'Live modifié' : 'Live programmé'); setForm(null); load()
  }
  async function del(l) { await supabase.from('lives').delete().eq('id', l.id); toast('Live supprimé'); load() }
  const Row = ({ l, replay }) => {
    const d = new Date(l.starts_at); const live = !replay && d <= now
    return <div className={`post lv ${live ? 'now' : ''}`}>
      <div className="d" style={replay ? { background: 'var(--panel-3)' } : {}}>{replay ? <b>▶</b> : <><b>{d.getDate()}</b><small>{MONTHS[d.getMonth()]}</small></>}</div>
      <div className="t"><b>{l.title}</b><small>{replay ? `Replay · ${d.toLocaleDateString('fr-FR')} · ${l.duration_min} min` : `${when(l.starts_at)} · avec ${l.host} · ${l.duration_min} min`}{l.tier_required === 2 ? ' · Accélération' : ''}</small></div>
      {replay ? (l.replay_url ? <a className="btn ghost" href={l.replay_url} target="_blank" rel="noreferrer">Voir</a> : <span className="pill">Bientôt</span>)
        : live ? (l.link ? <a className="btn" href={l.link} target="_blank" rel="noreferrer">🔴 Rejoindre</a> : <span className="pill bad">En direct</span>)
        : <span className="pill">{rel(l.starts_at)}</span>}
      {isStaff && <span style={{ display: 'flex', gap: 4 }}><button className="btn ghost sm" onClick={() => setForm(l)}>✎</button><button className="btn ghost sm" onClick={() => del(l)}>🗑</button></span>}
    </div>
  }
  const toLocal = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16) }
  return <>
    <div className="head"><div style={{ flex: 1 }}><h2>Lives & replays</h2><small>{upcoming.length} à venir · {past.length} replays</small></div>{isStaff && <button className="btn" onClick={() => setForm({})}>+ Programmer</button>}</div>
    <div className="body">
      {form && <form className="post form" onSubmit={save}>
        <b>{form.id ? 'Modifier le live' : 'Nouveau live'}</b>
        <input name="title" placeholder="Titre (ex : Recherche produit)" defaultValue={form.title || ''} required />
        <div className="grid2"><input name="starts_at" type="datetime-local" defaultValue={form.starts_at ? toLocal(form.starts_at) : ''} required /><input name="duration_min" type="number" placeholder="Durée (min)" defaultValue={form.duration_min || 45} /></div>
        <div className="grid2"><input name="host" placeholder="Animé par" defaultValue={form.host || me.name} /><select name="tier" defaultValue={form.tier_required || 1}><option value={1}>Tous les membres</option><option value={2}>Accélération seulement</option></select></div>
        <input name="link" placeholder="Lien Zoom / Meet (optionnel)" defaultValue={form.link || ''} />
        <input name="replay_url" placeholder="Lien du replay (à ajouter après)" defaultValue={form.replay_url || ''} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><button type="button" className="btn ghost" onClick={() => setForm(null)}>Annuler</button><button className="btn">Enregistrer</button></div>
      </form>}
      <h3 className="h3">À venir</h3>
      {upcoming.length === 0 && <div className="sys">Aucun live programmé pour l'instant</div>}
      {upcoming.map(l => <Row key={l.id} l={l} />)}
      <h3 className="h3" style={{ marginTop: 10 }}>Replays</h3>
      {past.length === 0 && <div className="sys">Les replays apparaîtront ici</div>}
      {past.map(l => <Row key={l.id} l={l} replay />)}
    </div>
  </>
}
