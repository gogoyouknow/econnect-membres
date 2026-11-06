import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/data'
import { ago } from '../lib/ui'

export const GOALS = ['Lancer ma première boutique', 'Faire mes premières ventes', 'Me faire un complément de revenu', 'Remplacer mon salaire à terme', 'Faire grandir une boutique qui vend déjà']
export const COACHING = [['oui', 'Oui, je veux être accompagné'], ['peut-etre', 'Peut-être, j\'aimerais en savoir plus'], ['non', 'Non, je préfère avancer seul pour l\'instant']]
export const BUDGETS = ['Moins de 300 €', '300 à 1 000 €', '1 000 à 3 000 €', 'Plus de 3 000 €']
const STATUS = [['nouveau', 'Nouveau'], ['contacte', 'Contacté'], ['rdv', 'Appel prévu'], ['close', 'Closé'], ['perdu', 'Pas intéressé']]
const hot = (l) => l.wants_coaching === 'oui' || (l.wants_coaching === 'peut-etre' && ['1 000 à 3 000 €', 'Plus de 3 000 €'].includes(l.budget))

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
          <span className="pill">{(COACHING.find(c => c[0] === l.wants_coaching) || ['', '—'])[1].split(',')[0]}</span>
          <span className="pill gold">{l.budget || '—'}</span>
        </div>
        {open === l.id && <div className="leaddet">
          <div className="row"><label>Email</label><a href={`mailto:${l.email}`}>{l.email}</a></div>
          {l.phone && <div className="row"><label>WhatsApp</label><a className="btn sm" href={wa(l.phone)} target="_blank" rel="noreferrer">💬 {l.phone}</a></div>}
          <div className="row col"><label>Objectifs</label><div>{(l.goals || []).join(' · ') || '—'}{l.goals_text ? <p className="muted" style={{ margin: '6px 0 0' }}>« {l.goals_text} »</p> : null}</div></div>
          <div className="row"><label>Suivi</label><select value={l.status} onChange={e => upd(l, { status: e.target.value })}>{STATUS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
          <textarea rows={2} defaultValue={l.note} placeholder="Note (rappel, objection, date d'appel…)" onBlur={e => e.target.value !== l.note && upd(l, { note: e.target.value })} />
        </div>}
      </div>)}
    </div>
  </>
}
