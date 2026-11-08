import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/data'
import { CoIcon } from './Coaching'

const ago = (d) => { if (!d) return '—'; const s = (Date.now() - new Date(d)) / 1000; if (s < 60) return "à l'instant"; if (s < 3600) return `${Math.floor(s / 60)} min`; if (s < 86400) return `${Math.floor(s / 3600)} h`; return `${Math.floor(s / 86400)} j` }
const mins = (m) => m == null ? '—' : m < 60 ? `${Math.round(m)} min` : m < 1440 ? `${(m / 60).toFixed(1).replace('.0', '')} h` : `${Math.round(m / 1440)} j`
const initials = (n) => (n || '?').split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase()
const DAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']

function Spark({ v }) { const max = Math.max(1, ...(v || [])); return <span className="cospark">{(v || []).map((x, i) => <i key={i} className={x ? '' : 'z'} style={{ height: `${Math.max(12, (x / max) * 100)}%` }} />)}</span> }

export default function CoTrack({ me, settings, isAdmin, toast, go, refresh }) {
  const [d, setD] = useState(null); const [days, setDays] = useState(7); const [tab, setTab] = useState('students'); const [st, setSt] = useState(null)
  const load = async () => { const { data, error } = await supabase.rpc('co_tracking', { p_days: days }); if (error) return toast(friendlyError(error), true); setD(data) }
  const loadSt = () => supabase.from('coach_status').select('*').eq('user_id', me.id).maybeSingle().then(({ data }) => setSt(data || { user_id: me.id, available: true, hours: { start: '09:00', end: '20:00', days: [1, 2, 3, 4, 5, 6] }, sla_min: 120, ai_relay: true }))
  useEffect(() => { load() }, [days]); useEffect(() => { loadSt() }, [])
  const saveSt = async (patch) => { const next = { ...st, ...patch, user_id: me.id }; setSt(next); const { error } = await supabase.from('coach_status').upsert(next); if (error) toast(friendlyError(error), true) }
  const saveSettings = async (patch) => { const { error } = await supabase.from('settings').update(patch).eq('id', 1); if (error) return toast(friendlyError(error), true); toast('Enregistré'); refresh?.() }
  const sla = d?.sla_min || 120
  const open = (s) => { if (s.thread) { history.replaceState(null, '', '#co/' + s.thread); go('co') } }
  return <div className="co cotrack">
    <div className="cohead hd"><div className="t"><b>Suivi</b><small>{d ? `${d.students.length} élève${d.students.length > 1 ? 's' : ''} · ${days} derniers jours` : 'Chargement…'}</small></div>
      <div className="cochips" style={{ margin: 0 }}>{[7, 14, 30].map(n => <button key={n} className={n === days ? 'on' : ''} onClick={() => setDays(n)}>{n} j</button>)}</div></div>
    <div className="cobody list">
      {d && <>
        <div className="cocard gold"><small>Temps de réponse · médian</small><div className="big"><b>{mins(d.median_resp)}</b><em className={`cotag ${d.median_resp == null || d.median_resp <= sla ? 'ok' : 'warn'}`}>objectif {mins(sla)} {d.median_resp == null || d.median_resp <= sla ? '✓' : '✗'}</em></div>
          <span>{(d.by_coach || []).map(c => `${c.name} ${mins(c.median)}`).join(' · ') || 'Pas encore de réponse mesurée'}</span></div>
        <div className="cokp four"><div><small>Sans réponse</small><b className={d.waiting_over ? 'warn' : ''}>{d.waiting_over}</b><span>au-delà de {mins(sla)}</span></div><div><small>Inactifs 24 h</small><b className={d.inactive_24 ? 'warn' : ''}>{d.inactive_24}<i>/{d.students.length}</i></b><span>{d.inactive_72} depuis 72 h</span></div><div><small>Questions</small><b>{d.answered}<i>/{d.questions}</i></b><span>{d.questions ? Math.round((d.within_sla / d.questions) * 100) : 0} % dans l'objectif</span></div><div><small>Messages</small><b className="g">{d.msgs_total || 0}</b><span>{d.voices} vocaux · {d.photos} photos</span></div></div>
        <div className="cochips"><button className={tab === 'students' ? 'on' : ''} onClick={() => setTab('students')}>Élèves</button><button className={tab === 'coaches' ? 'on' : ''} onClick={() => setTab('coaches')}>Coachs</button><button className={tab === 'rules' ? 'on' : ''} onClick={() => setTab('rules')}>Règles & dispo</button></div>

        {tab === 'students' && <div className="cocard">
          {!d.students.length && <p className="muted" style={{ margin: 0 }}>Aucun élève de l'accompagnement pour l'instant.</p>}
          {d.students.map(s => {
            const waiting = s.waiting_since && (Date.now() - new Date(s.waiting_since)) / 60000
            const inact = s.inactive_h
            const status = waiting ? { cls: waiting > sla ? 'warn' : 'gold', txt: `attend ${ago(s.waiting_since)}` } : inact > 168 ? { cls: 'warn', txt: `inactif 7 j+` } : inact > 72 ? { cls: 'warn', txt: `inactif ${Math.floor(inact / 24)} j` } : inact > 24 ? { cls: 'gold', txt: `silence ${Math.floor(inact)} h` } : null
            return <button key={s.id} className="corow" onClick={() => open(s)}>
              <div className="coav">{s.avatar ? <img src={s.avatar} alt="" /> : initials(s.name)}</div>
              <div className="t"><b>{s.name}</b><small>{s.coach ? `Coach ${s.coach}` : 'Pas de coach'}{s.next?.step ? ` · ${s.next.step}` : ''}</small></div>
              {status && <em className={`cotag ${status.cls}`}>{status.txt}</em>}
            </button>
          })}
        </div>}

        {tab === 'coaches' && <div className="cocard">
          {!(d.by_coach || []).length && <p className="muted" style={{ margin: 0 }}>Aucune réponse mesurée sur la période.</p>}
          {(d.by_coach || []).map(c => <div key={c.id} className="corow static"><div className="coav">{initials(c.name)}</div><div className="t"><b>{c.name}</b><small>{c.students} élève{c.students > 1 ? 's' : ''} · {c.n} réponse{c.n > 1 ? 's' : ''}</small></div><em className={`cotag ${c.median <= sla ? 'ok' : 'warn'}`}>médiane {mins(c.median)}</em></div>)}
          <div className="codaily">{(d.daily || []).map(x => { const max = Math.max(1, ...d.daily.map(y => y.msgs)); return <div key={x.d} title={`${x.d} · ${x.msgs}`}><i style={{ height: `${Math.max(6, (x.msgs / max) * 100)}%` }} /><small>{x.d.slice(8)}</small></div> })}</div>
          <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>Messages par jour (élèves + équipe)</p>
        </div>}

        {tab === 'rules' && st && <>
          <div className="cocard"><b className="h">Mes heures de réponse</b>
            <div className="codays">{DAYS.map((l, i) => <button key={i} className={(st.hours?.days || []).includes(i) ? 'on' : ''} onClick={() => { const cur = st.hours?.days || []; saveSt({ hours: { ...st.hours, days: cur.includes(i) ? cur.filter(x => x !== i) : [...cur, i].sort() } }) }}>{l}</button>)}</div>
            <div className="cohours"><label>de <input type="time" value={st.hours?.start || '09:00'} onChange={e => saveSt({ hours: { ...st.hours, start: e.target.value } })} /></label><label>à <input type="time" value={st.hours?.end || '20:00'} onChange={e => saveSt({ hours: { ...st.hours, end: e.target.value } })} /></label></div>
            <small className="muted">En dehors, tes élèves reçoivent automatiquement « te répond à partir de … » quand ils t'écrivent.</small>
            {isAdmin && <label className="corowopt"><span><b>Recevoir l'alerte « élève qui attend »</b><small>Ton réglage perso (le seuil est dans « Règles de l'équipe »)</small></span><button className={`cosw ${st.alert_waiting !== false ? 'on' : ''}`} onClick={() => saveSt({ alert_waiting: st.alert_waiting === false })} aria-label="Mon alerte" /></label>}
            <label className="corowopt"><span><b>Coach IA prend le relais quand je suis indisponible</b><small>Étape 3 · il répond avec ta méthode, tu relis à ton retour</small></span><button className={`cosw ${st.ai_relay ? 'on' : ''}`} onClick={() => saveSt({ ai_relay: !st.ai_relay })} aria-label="Relais IA" /></label>
          </div>
          {isAdmin && <div className="cocard"><b className="h">Règles de l'équipe</b>
            <label className="cofieldrow"><span>Objectif de réponse</span><select value={settings.co_sla_min || 120} onChange={e => saveSettings({ co_sla_min: +e.target.value })}>{[30, 60, 120, 180, 240, 480].map(v => <option key={v} value={v}>{mins(v)}</option>)}</select></label>
            <label className="corowopt"><span><b>Alerter les admins quand un élève attend</b><small>Notification à Clément & Jérémy dès que la réponse tarde</small></span><button className={`cosw ${settings.co_alert_admin_on !== false ? 'on' : ''}`} onClick={() => saveSettings({ co_alert_admin_on: settings.co_alert_admin_on === false })} aria-label="Alerte attente" /></label>
            {settings.co_alert_admin_on !== false && <label className="cofieldrow"><span>Alerter au bout de</span><select value={settings.co_alert_admin_h || 5} onChange={e => saveSettings({ co_alert_admin_h: +e.target.value })}>{[1, 2, 3, 5, 8, 12, 24, 48].map(v => <option key={v} value={v}>{v} h</option>)}</select></label>}
            <label className="corowopt"><span><b>Relances automatiques des élèves silencieux</b><small>24 h puis 72 h, en semaine 9 h–20 h, envoyées au nom du coach · alerte à 7 j</small></span><button className={`cosw ${settings.co_relance_on !== false ? 'on' : ''}`} onClick={() => saveSettings({ co_relance_on: settings.co_relance_on === false })} aria-label="Relances" /></label>
            <label className="cotext"><span>Message à 24 h <small>{'{prenom}'} et {'{action}'} sont remplacés</small></span><textarea defaultValue={settings.co_relance_24h || ''} rows={3} onBlur={e => e.target.value !== (settings.co_relance_24h || '') && saveSettings({ co_relance_24h: e.target.value })} /></label>
            <label className="cotext"><span>Message à 72 h</span><textarea defaultValue={settings.co_relance_72h || ''} rows={3} onBlur={e => e.target.value !== (settings.co_relance_72h || '') && saveSettings({ co_relance_72h: e.target.value })} /></label>
            <small className="muted">Bilan de la semaine : chaque lundi à 9 h, en push et par email aux admins.</small>
          </div>}
        </>}
      </>}
    </div>
  </div>
}
