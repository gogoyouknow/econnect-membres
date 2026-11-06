import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/data'
import { ago } from '../lib/ui'

export const SITUATIONS = [['etudiant', 'Étudiant(e)'], ['salarie', 'Salarié(e)'], ['chomage', 'Au chômage'], ['entrepreneur', 'Entrepreneur(e)']]
export const COACHING = [['oui', 'Oui, je veux être accompagné(e)'], ['non', 'Non, je préfère avancer seul(e) pour l\'instant']]
export const BUDGETS = ['Moins de 300 €', '300 à 1 000 €', '1 000 à 3 000 €', 'Plus de 3 000 €']
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
  const wa = (p) => { const d = String(p || '').replace(/[^\d+]/g, '').replace(/^00/, '+'); return d ? 'https://wa.me/' + d.replace('+', '') : '' }
  return <>
    <div className="head"><div style={{ flex: 1 }}><h2>Prospects</h2><small>Réponses au formulaire après paiement · {rows.filter(hot).length} chauds sur {rows.length}</small></div></div>
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
