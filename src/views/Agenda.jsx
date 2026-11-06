import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/data'
import { Avatar, Switch } from '../lib/ui'
import { agenda, fmtDay, fmtHour } from './Booking'

const DAYS = [['1', 'Lundi'], ['2', 'Mardi'], ['3', 'Mercredi'], ['4', 'Jeudi'], ['5', 'Vendredi'], ['6', 'Samedi'], ['7', 'Dimanche']]
const STATUS = [['confirme', 'Prévu'], ['fait', 'Fait'], ['absent', 'Absent'], ['annule', 'Annulé']]
const toTxt = (ranges) => (ranges || []).map(r => r.join('-')).join(', ')
const fromTxt = (t) => t.split(',').map(x => x.trim()).filter(Boolean).map(x => x.split('-').map(y => y.trim().replace('h', ':').replace(/^(\d):/, '0$1:').replace(/:$/, ':00'))).filter(r => r.length === 2 && r.every(v => /^\d{2}:\d{2}$/.test(v)))

/** Agenda : rendez-vous à venir, connexion Google, réglages des créneaux */
export default function Agenda({ me, profiles, isAdmin, toast }) {
  const [list, setList] = useState([]); const [mine, setMine] = useState(false)
  const [hosts, setHosts] = useState([]); const [s, setS] = useState(null); const [ready, setReady] = useState(false)
  const load = async () => {
    const since = new Date(Date.now() - 2 * 864e5).toISOString()
    const [{ data: b }, { data: h }, { data: st }, { data: r }] = await Promise.all([
      supabase.from('bookings').select('*').gte('starts_at', since).order('starts_at').limit(300),
      supabase.from('agenda_hosts').select('*'), supabase.from('agenda_settings').select('*').eq('id', 1).single(), supabase.rpc('google_client_ready')])
    setList(b || []); setHosts(h || []); setS(st); setReady(!!r)
  }
  useEffect(() => { load() }, [])
  const myHost = hosts.find(h => h.profile_id === me.id)
  async function connect() {
    try { const r = await agenda({ action: 'oauth_url', redirect_uri: location.origin + '/agenda-google' }); location.href = r.url } catch (e) { toast(e.message, true) }
  }
  async function setStatus(b, status) { const { error } = await supabase.from('bookings').update({ status }).eq('id', b.id); if (error) return toast(friendlyError(error), true); setList(l => l.map(x => x.id === b.id ? { ...x, status } : x)) }
  async function hostActive(h, active) { const { error } = await supabase.from('agenda_hosts').update({ active }).eq('profile_id', h.profile_id); if (error) return toast(friendlyError(error), true); load() }
  async function saveSettings(patch) { const { error } = await supabase.from('agenda_settings').update(patch).eq('id', 1); if (error) return toast(friendlyError(error), true); toast('Réglage enregistré'); load() }
  async function saveGoogle(e) {
    e.preventDefault(); const f = new FormData(e.target)
    const { error } = await supabase.rpc('set_google_client', { p_id: String(f.get('id')).trim(), p_secret: String(f.get('secret')).trim() }); if (error) return toast(friendlyError(error), true)
    toast('Connexion Google enregistrée'); e.target.reset(); load()
  }
  const now = Date.now()
  const shown = list.filter(b => (!mine || b.host_id === me.id) && b.status !== 'annule')
  const up = shown.filter(b => Date.parse(b.ends_at) > now), past = shown.filter(b => Date.parse(b.ends_at) <= now).reverse()
  const Row = ({ b }) => { const h = profiles.map[b.host_id]; return <div className="post bk">
    <div className="bkd"><b>{fmtHour(b.starts_at)}</b><small>{fmtDay(b.starts_at)}</small></div>
    <div style={{ flex: 1, minWidth: 0 }}><b>{b.name || b.email}</b><small className="muted" style={{ display: 'block' }}>{b.email}{b.phone ? ` · ${b.phone}` : ''}</small>{h && <small className="muted">avec {h.first_name || h.name}</small>}</div>
    <div className="bka">{b.meet_url && b.status === 'confirme' && <a className="btn sm" href={b.meet_url} target="_blank" rel="noreferrer">Rejoindre</a>}
      <select value={b.status} onChange={e => setStatus(b, e.target.value)}>{STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
  </div> }
  return <>
    <div className="head"><div style={{ flex: 1 }}><h2>Agenda</h2><small>Appels réservés depuis le formulaire après paiement</small></div>
      <label className="dmtoggle"><span>Mes appels seulement</span><Switch on={mine} label="Mes appels" onChange={setMine} /></label></div>
    <div className="body">
      {!ready && isAdmin && <div className="post"><b>1 · Relier l'app à Google</b>
        <p className="small muted">À faire une seule fois. Colle ici l'identifiant et la clé secrète du « client OAuth » créé dans Google Cloud.</p>
        <form onSubmit={saveGoogle} className="grid2"><input name="id" placeholder="ID client (…apps.googleusercontent.com)" defaultValue={s?.google_client_id || ''} required /><input name="secret" type="password" placeholder="Code secret du client" required /><button className="btn">Enregistrer</button></form></div>}
      <div className="post"><b>{ready ? 'Mon Google Agenda' : '2 · Mon Google Agenda'}</b>
        {myHost?.connected_at ? <div className="row"><label>Connecté : {myHost.google_email}<small>Tes créneaux pris sont bloqués, les appels arrivent dans ton agenda avec un lien Google Meet.</small></label><button className="btn ghost sm" onClick={connect}>Reconnecter</button></div>
          : <div className="row"><label>Pas encore connecté<small>Connecte ton agenda pour recevoir des appels.</small></label><button className="btn sm" disabled={!ready} onClick={connect}>Connecter Google Agenda</button></div>}
      </div>
      <h3 className="h3">À venir · {up.length}</h3>
      {up.length === 0 && <div className="sys">Aucun appel prévu</div>}
      {up.map(b => <Row key={b.id} b={b} />)}
      {past.length > 0 && <><h3 className="h3" style={{ marginTop: 10 }}>Passés</h3>{past.slice(0, 20).map(b => <Row key={b.id} b={b} />)}</>}
      {isAdmin && s && <>
        <div className="post"><b>Qui prend les appels</b><small className="muted" style={{ display: 'block', marginBottom: 6 }}>Les appels sont répartis à tour de rôle entre les personnes actives, selon leurs disponibilités.</small>
          {hosts.length === 0 && <small className="muted">Personne n'a encore connecté son agenda. Chaque coach se connecte à l'app et clique sur « Connecter Google Agenda ».</small>}
          {hosts.map(h => { const p = profiles.map[h.profile_id]; return <div key={h.profile_id} className="row"><label style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Avatar p={p} /><span>{p?.name}<small>{h.google_email || 'non connecté'}</small></span></label><Switch on={h.active} label="Actif" onChange={v => hostActive(h, v)} /></div> })}
        </div>
        <div className="post"><b>Réglages des créneaux</b>
          <div className="row"><label>Durée d'un appel (min)</label><input type="number" min={10} max={120} defaultValue={s.duration_min} style={{ width: 80 }} onBlur={e => +e.target.value !== s.duration_min && saveSettings({ duration_min: +e.target.value || 30 })} /></div>
          <div className="row"><label>Pause entre deux appels (min)</label><input type="number" min={0} max={60} defaultValue={s.buffer_min} style={{ width: 80 }} onBlur={e => +e.target.value !== s.buffer_min && saveSettings({ buffer_min: +e.target.value || 0 })} /></div>
          <div className="row"><label>Réservable au plus tôt (heures avant)</label><input type="number" min={0} max={72} defaultValue={s.min_notice_h} style={{ width: 80 }} onBlur={e => +e.target.value !== s.min_notice_h && saveSettings({ min_notice_h: +e.target.value || 0 })} /></div>
          <div className="row"><label>Réservable jusqu'à (jours)</label><input type="number" min={1} max={60} defaultValue={s.horizon_days} style={{ width: 80 }} onBlur={e => +e.target.value !== s.horizon_days && saveSettings({ horizon_days: +e.target.value || 14 })} /></div>
          <div className="row"><label>Maximum d'appels par jour et par personne</label><input type="number" min={1} max={20} defaultValue={s.max_per_day} style={{ width: 80 }} onBlur={e => +e.target.value !== s.max_per_day && saveSettings({ max_per_day: +e.target.value || 6 })} /></div>
          <div className="row col"><label>Horaires (heure de Paris)<small>Format : 10:00-12:30, 14:00-19:00 · vide = pas d'appel ce jour-là</small></label>
            {DAYS.map(([k, l]) => <div key={k} className="hrow"><span>{l}</span><input defaultValue={toTxt(s.hours?.[k])} placeholder="fermé" onBlur={e => { const v = fromTxt(e.target.value); if (toTxt(v) === toTxt(s.hours?.[k])) return; const h = { ...(s.hours || {}) }; if (v.length) h[k] = v; else delete h[k]; saveSettings({ hours: h }) }} /></div>)}
          </div>
        </div>
      </>}
    </div>
  </>
}
