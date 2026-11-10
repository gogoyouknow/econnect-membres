import { useEffect, useState } from 'react'
import { supabase } from './supabase'

const TZ = 'Europe/Paris'
const day = (d, o) => d.toLocaleDateString('fr-FR', { timeZone: TZ, ...o })
/** « aujourd'hui à 20h14 », « hier à 9h05 », « lun. 9 nov. à 20h14 » */
export function when(iso) {
  const d = new Date(iso); const h = d.toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).replace(':', 'h')
  const k = day(d, { day: 'numeric', month: 'numeric', year: 'numeric' }); const now = new Date()
  if (k === day(now, { day: 'numeric', month: 'numeric', year: 'numeric' })) return `aujourd'hui à ${h}`
  if (k === day(new Date(now.getTime() - 864e5), { day: 'numeric', month: 'numeric', year: 'numeric' })) return `hier à ${h}`
  return `${day(d, { weekday: 'short', day: 'numeric', month: 'short' })} à ${h}`
}

/** Événements de la page de préparation d'une personne (col = 'lead_id' ou 'candidature_id'). */
export function usePrep(col, id) {
  const [ev, setEv] = useState(null)
  useEffect(() => {
    setEv(null); if (!id) return
    let dead = false
    const go = () => supabase.from('cand_page_events').select('kind,label,created_at').eq(col, id).order('created_at', { ascending: true }).limit(80).then(({ data }) => !dead && setEv(data || []))
    go(); const i = setInterval(go, 60000)
    return () => { dead = true; clearInterval(i) }
  }, [col, id])
  return ev
}

/** Résumé : page ouverte ? vidéo lancée ? questions écrites ? avec l'heure de chaque étape. */
export default function PrepTrack({ ev, compact }) {
  const list = ev || []
  const opens = list.filter((e) => e.kind === 'open'); const plays = list.filter((e) => e.kind === 'play'); const notes = list.filter((e) => e.kind === 'notes')
  const rows = [
    ['👁', 'Page ouverte', opens.length ? when(opens[opens.length - 1].created_at) + (opens.length > 1 ? ` · ${opens.length} fois` : '') : null, 'pas encore ouverte'],
    ['▶', 'Vidéo lancée', plays.length ? when(plays[plays.length - 1].created_at) + (plays[plays.length - 1].label ? ` · ${plays[plays.length - 1].label}` : '') : null, 'pas lancée'],
    ['✎', 'Questions écrites', notes.length ? when(notes[notes.length - 1].created_at) : null, 'pas encore'],
  ]
  if (compact) return <div className="pt pt-c">{rows.map(([i, l, t]) => <span key={l} className={t ? 'ok' : ''}>{i} {l}{t && <small> · {t.split(' · ')[0]}</small>}</span>)}</div>
  return <ul className="pt">{rows.map(([i, l, t, no]) => <li key={l} className={t ? 'ok' : ''}><span className="pti">{t ? '✓' : '○'}</span><span><b>{l}</b><small>{t || no}</small></span></li>)}</ul>
}
