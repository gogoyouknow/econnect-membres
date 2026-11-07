import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/data'
import { ago } from '../lib/ui'

export const SITUATIONS = [['etudiant', 'Étudiant(e)'], ['salarie', 'Salarié(e)'], ['chomage', 'Au chômage'], ['entrepreneur', 'Entrepreneur(e)']]
export const COACHING = [['oui', 'Oui, je veux être accompagné(e)'], ['non', 'Non, je préfère avancer seul(e) pour l\'instant']]
export const BUDGETS = ['Moins de 150 €', '150 à 500 €', '500 à 1 500 €', '1 500 à 3 000 €', 'Plus de 3 000 €']
export const BUDGET_OK = ['500 à 1 500 €', '1 500 à 3 000 €', 'Plus de 3 000 €']   // budgets qui ouvrent la prise de rendez-vous
// anciens libellés (formulaires déjà remplis)
export const BUDGETS_OLD = ['Moins de 300 €', '300 à 1 000 €', '1 000 à 3 000 €']
export const CAPITAL = [['oui', 'Oui, je l\'ai aujourd\'hui'], ['non', 'Non, pas encore']]
const label = (list, v) => (list.find(x => x[0] === v) || [null, '—'])[1]
const STATUS = [['nouveau', 'Nouveau'], ['contacte', 'Contacté'], ['rdv', 'Appel prévu'], ['close', 'Closé'], ['perdu', 'Pas intéressé']]
const hot = (l) => l.wants_coaching === 'oui' && l.has_capital === 'oui'

/** Prospects : réponses au formulaire après paiement, à rappeler pour l'accompagnement */
export default function Leads({ toast }) {
  const [rows, setRows] = useState([]); const [f, setF] = useState('tous'); const [open, setOpen] = useState(null)
  const load = () => supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(500).then(({ data }) => setRows(data || []))
  useEffect(() => { load() }, [])
  const upd = async (l, patch) => { const { error } = await supabase.from('leads').update(patch).eq('id', l.id); if (error) return toast(friendlyError(error), true); setRows(r => r.map(x => x.id === l.id ? { ...x, ...patch } : x)) }
  const list = rows.filter(l => f === 'tous' || (f === 'chauds' ? hot(l) && !['close', 'perdu'].includes(l.status) : l.status === f))
  const [bk, setBk] = useState([]); const [hours, setHours] = useState([])
  const loadBk = () => Promise.all([supabase.from('bookings').select('*').gte('starts_at', new Date(Date.now() - 3600000).toISOString()).neq('status', 'annule').order('starts_at'), supabase.from('booking_hours').select('*').order('weekday')]).then(([a, b]) => { setBk(a.data || []); setHours(b.data || []) })
  useEffect(() => { loadBk() }, [])
  const updBk = async (b, patch) => { const { error } = await supabase.from('bookings').update(patch).eq('id', b.id); if (error) return toast(friendlyError(error), true); loadBk() }
  const updH = async (h, patch) => { const { error } = await supabase.from('booking_hours').update(patch).eq('weekday', h.weekday); if (error) return toast(friendlyError(error), true); setHours(x => x.map(y => y.weekday === h.weekday ? { ...y, ...patch } : y)) }
  const fmt = (iso) => new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const DAYN = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']
  const wa = (p) => { const d = String(p || '').replace(/[^\d+]/g, '').replace(/^00/, '+'); return d ? 'https://wa.me/' + d.replace('+', '') : '' }
  return <>
    <div className="head"><div style={{ flex: 1 }}><h2>Prospects</h2><small>Réponses au formulaire après paiement · {rows.filter(hot).length} chauds sur {rows.length}</small></div></div>
    <div className="body" style={{ paddingBottom: 0 }}>
      <div className="post">
        <b>📅 Rendez-vous à venir · {bk.length}</b>
        {!bk.length && <p className="muted" style={{ fontSize: 13 }}>Aucun appel réservé pour l'instant. Les prospects qui veulent être accompagnés et ont le budget choisissent un créneau juste après le formulaire.</p>}
        {bk.map(b => <div key={b.id} className="bkrow"><div><b>{fmt(b.starts_at)}</b> · {b.name || b.email}<small>{b.email}{b.phone ? ` · ${b.phone}` : ''}</small></div><div className="bkact">{b.phone && <a className="btn ghost sm" href={wa(b.phone)} target="_blank" rel="noreferrer">WhatsApp</a>}<select value={b.status} onChange={e => updBk(b, { status: e.target.value })}><option value="confirme">Confirmé</option><option value="fait">Fait</option><option value="absent">Absent</option><option value="annule">Annulé</option></select></div></div>)}
        <details style={{ marginTop: 10 }}><summary className="muted" style={{ cursor: 'pointer', fontSize: 13 }}>Mes disponibilités (heure de Paris, créneaux de 30 min, proposés sur 48 h)</summary>
          <div className="hours">{hours.map(h => <div key={h.weekday} className={h.active ? '' : 'off'}><label><input type="checkbox" checked={h.active} onChange={e => updH(h, { active: e.target.checked })} /> {DAYN[h.weekday]}</label><input type="time" value={h.start_time.slice(0, 5)} onChange={e => updH(h, { start_time: e.target.value })} /><span>→</span><input type="time" value={h.end_time.slice(0, 5)} onChange={e => updH(h, { end_time: e.target.value })} /></div>)}</div>
        </details>
      </div>
    </div>
    <div className="body">
      <div className="chips">{[['tous', 'Tous'], ['chauds', '🔥 Chauds'], ...STATUS].map(([k, l]) => <button key={k} className={`chip ${f === k ? 'on' : ''}`} onClick={() => setF(k)}>{l}</button>)}</div>
      {list.length === 0 && <div className="sys">Aucun prospect ici pour l'instant</div>}
      {list.map(l => <div key={l.id} className={`post lead ${hot(l) ? 'hot' : ''}`}>
        <div className="leadtop" onClick={() => setOpen(open === l.id ? null : l.id)}>
          <div style={{ flex: 1, minWidth: 0 }}><b>{hot(l) ? '🔥 ' : ''}{[l.first_name, l.last_name].filter(Boolean).join(' ') || l.email}</b>
            <small className="muted" style={{ display: 'block' }}>{ago(l.created_at)} · {l.offer || (l.amount ? `paiement ${l.amount} €` : 'paiement')}</small></div>
          <span className="pill">{l.wants_coaching === 'oui' ? 'Veut être accompagné' : l.wants_coaching === 'non' ? 'Seul pour l\'instant' : '—'}</span>
          <span className="pill gold">{l.budget || '—'}{l.has_capital ? (l.has_capital === 'oui' ? ' · dispo' : ' · pas dispo') : ''}</span>
        </div>
        {open === l.id && <div className="leaddet">
          <div className="row"><label>Email</label><a href={`mailto:${l.email}`}>{l.email}</a></div>
          {l.phone && <div className="row"><label>WhatsApp</label><a className="btn sm" href={wa(l.phone)} target="_blank" rel="noreferrer">💬 {l.phone}</a></div>}
          <div className="row"><label>Situation</label><span>{label(SITUATIONS, l.situation)}</span></div>
          <div className="row"><label>Capital disponible aujourd'hui</label><span>{label(CAPITAL, l.has_capital)}</span></div>
          <div className="row"><label>Suivi</label><select value={l.status} onChange={e => upd(l, { status: e.target.value })}>{STATUS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
          <textarea rows={2} defaultValue={l.note} placeholder="Note (rappel, objection, date d'appel…)" onBlur={e => e.target.value !== l.note && upd(l, { note: e.target.value })} />
        </div>}
      </div>)}
    </div>
  </>
}
