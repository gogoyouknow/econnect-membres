import LoadErr from './LoadErr'
import { useEffect, useState } from 'react'
import { supabase, friendlyError } from './supabase'
import { openWA } from './whatsapp'

const TZ = 'Europe/Paris'
const CAPL = { lt500: '- 500 €', '500-1000': '500–1 000 €', '1000-3000': '1 000–3 000 €', gt3000: '+ 3 000 €' }
const STEP = { who: 'A laissé ses coordonnées', situ: 'S’est arrêté après la situation', budget: 'S’est arrêté à la question budget', slot: 'A vu les créneaux sans réserver' }
const wa = (p, text) => { const d = String(p || '').replace(/[^\d]/g, ''); return d ? 'https://wa.me/' + d + (text ? '?text=' + encodeURIComponent(text) : '') : '' }
const ago = (iso) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (m < 2) return "à l'instant"
  if (m < 60) return `il y a ${m} min`
  const h = Math.floor(m / 60); if (h < 24) return `il y a ${h} h`
  const d = Math.floor(h / 24); return `il y a ${d} jour${d > 1 ? 's' : ''}`
}
// pas qualifié = a dit moins de 500 € ou pas de budget disponible maintenant
const unqualified = (l) => l.capital === 'lt500' || ['soon', 'no'].includes(l.budget_confirmed)

/** « Relances » : toutes les personnes qui ont laissé leurs coordonnées sans réserver d'appel. */
export default function Leads({ toast, onChange }) {
  const [rows, setRows] = useState(null); const [tab, setTab] = useState('todo'); const [open, setOpen] = useState(null); const [lerr, setLerr] = useState('')
  const load = () => supabase.from('cand_leads').select('*').order('updated_at', { ascending: false }).limit(500).then(({ data, error }) => { if (error) return setLerr(friendlyError(error)); setLerr(''); setRows(data || []); onChange && onChange((data || []).filter(l => !l.booked && l.follow === 'new' && !unqualified(l)).length) }).catch((e) => setLerr(friendlyError(e)))
  useEffect(() => { load(); const i = setInterval(load, 60000); return () => clearInterval(i) }, [])
  const upd = async (l, patch) => { const { error } = await supabase.from('cand_leads').update(patch).eq('id', l.id); if (error) return toast(friendlyError(error), true); load() }

  const open_ = (rows || []).filter(l => !l.booked)
  const usable = (l) => Boolean(l.phone || l.email)
  const todo = open_.filter(l => l.follow === 'new' && usable(l) && !unqualified(l))
  const cold = open_.filter(l => l.follow === 'new' && usable(l) && unqualified(l))
  const part = open_.filter(l => l.follow === 'new' && !usable(l))
  const done = open_.filter(l => l.follow !== 'new')
  const list = { todo, cold, part, done }[tab]
  const link = 'https://rdv.theambitiousman.fr/'
  const msg = (l) => `Salut ${l.first_name || ''}, c'est Clément. Je vois que tu as commencé à réserver ton appel, mais tu n'es pas allé au bout. Tu as eu un souci ? Tu peux reprendre ici : ${link}`.replace('  ', ' ')

  return <div className="sheet-body">
    <h2 className="sh">À relancer</h2>
    <p className="muted">Les personnes qui ont laissé leurs coordonnées sans réserver d'appel. Rien n'est perdu.</p>
    <div className="pills" style={{ marginTop: 14 }}>{[['todo', `À relancer · ${todo.length}`], ['part', `Incomplets · ${part.length}`], ['cold', `Pas prêts · ${cold.length}`], ['done', 'Traités']].map(([k, l]) => <button key={k} className={`pill ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
    {rows === null && !lerr && <p className="muted">Chargement…</p>}
    <LoadErr msg={lerr} onRetry={load} />
    {rows && !list.length && <div className="sys">{tab === 'todo' ? 'Personne à relancer pour le moment' : tab === 'cold' ? 'Personne ici' : tab === 'part' ? 'Aucune saisie incomplète' : 'Rien de traité pour le moment'}</div>}
    {list.map(l => <div key={l.id} className={`call ${open === l.id ? 'open' : ''}`}>
      <div className="crow" onClick={() => setOpen(open === l.id ? null : l.id)}>
        <div className="cmain"><b>{l.first_name || 'Sans prénom'}</b><small>{STEP[l.step]} · {ago(l.updated_at)}</small></div>
        {l.follow === 'done' ? <span className="badge ok">Relancé</span> : l.follow === 'skip' ? <span className="badge done">Écarté</span> : <span className="badge wait">{!usable(l) ? 'Incomplet' : unqualified(l) ? 'Pas prêt' : 'À relancer'}</span>}
      </div>
      {open === l.id && <div className="cdet">
        {l.phone ? <div className="drow"><label>WhatsApp</label><a href={wa(l.phone)} target="_blank" rel="noreferrer">{l.phone}</a></div>
          : l.phone_raw ? <div className="drow"><label>Numéro tapé</label><span>{l.phone_raw} · incomplet</span></div> : null}
        {l.email ? <div className="drow"><label>Email</label><a href={`mailto:${l.email}`}>{l.email}</a></div>
          : l.email_raw ? <div className="drow"><label>Email tapé</label><span>{l.email_raw} · incomplet</span></div> : null}
        <div className="drow"><label>Situation</label><span>{l.situation || '—'}</span></div>
        <div className="drow"><label>Budget</label><span>{CAPL[l.capital] || '—'}{l.budget_confirmed === 'yes' ? ' · disponible maintenant' : l.budget_confirmed === 'soon' ? ' · pas avant quelques semaines' : l.budget_confirmed === 'no' ? ' · non disponible' : ''}</span></div>
        <div className="drow"><label>1ère visite</label><span>{new Date(l.created_at).toLocaleString('fr-FR', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
        <div className="acts">
          {l.phone && <a className="btn sm" style={{ textDecoration: 'none' }} href={wa(l.phone, msg(l))} target="_blank" rel="noreferrer" onClick={(e) => { openWA(e, l.phone, msg(l)); if (l.follow === 'new') upd(l, { follow: 'done' }) }}>Relancer sur WhatsApp</a>}
          {l.follow === 'new' && <><button className="btn ghost sm" onClick={() => upd(l, { follow: 'done' })}>Marquer relancé</button><button className="btn ghost sm" onClick={() => upd(l, { follow: 'skip' })}>Écarter</button></>}
          {l.follow !== 'new' && <button className="btn ghost sm" onClick={() => upd(l, { follow: 'new' })}>Remettre à relancer</button>}
        </div>
        <textarea rows={2} defaultValue={l.note} placeholder="Note…" onBlur={e => e.target.value !== l.note && upd(l, { note: e.target.value })} />
      </div>}
    </div>)}
  </div>
}
