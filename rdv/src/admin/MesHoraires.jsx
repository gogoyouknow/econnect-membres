import { useEffect, useState } from 'react'
import { supabase, friendlyError } from './supabase'

const DOW = [[1, 'Lundi'], [2, 'Mardi'], [3, 'Mercredi'], [4, 'Jeudi'], [5, 'Vendredi'], [6, 'Samedi'], [0, 'Dimanche']]
const hm = (t) => String(t || '').slice(0, 5)
const badRange = (rs) => rs.some((r) => !r[0] || !r[1] || r[0] >= r[1])
const todayK = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' })
const longDay = (k) => { const [y, m, d] = k.split('-').map(Number); const s = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }); return s.charAt(0).toUpperCase() + s.slice(1) }

/** Plages horaires d'un jour : début – fin, + ajouter, ✕ supprimer. */
function Ranges({ ranges, onChange }) {
  const set = (i, k, v) => onChange(ranges.map((r, j) => (j === i ? (k ? [r[0], v] : [v, r[1]]) : r)))
  return <>
    {ranges.map((r, i) => <div key={i} className="hrange" style={{ marginLeft: 0 }}>
      <input type="time" value={r[0]} onChange={(e) => set(i, 0, e.target.value)} /><span>–</span><input type="time" value={r[1]} onChange={(e) => set(i, 1, e.target.value)} />
      <button type="button" className="btn ghost sm" aria-label="Supprimer la plage" onClick={() => onChange(ranges.filter((_, j) => j !== i))}>✕</button></div>)}
    {ranges.length < 4 && <button type="button" className="linkbtn" style={{ paddingLeft: 0 }} onClick={() => onChange([...ranges, ranges.length ? ['17:00', '18:00'] : ['10:00', '11:00']])}>+ Ajouter une plage</button>}
  </>
}

/** Relier son Google Agenda : adresse secrète iCal → ses rendez-vous / événements perso bloquent ses créneaux. */
function AgendaGoogle({ closer, toast, who }) {
  const [st, setSt] = useState(null); const [url, setUrl] = useState(''); const [busy, setBusy] = useState(false); const [help, setHelp] = useState(false)
  const load = () => supabase.rpc('closer_cal_status', { p_closer: closer }).then(({ data }) => setSt(data || null))
  useEffect(() => { setSt(null); setUrl(''); load() }, [closer]) // eslint-disable-line
  useEffect(() => { if (!st?.set || st.synced_at || st.err) return; const i = setInterval(load, 8000); return () => clearInterval(i) }, [st]) // eslint-disable-line
  const save = async (v) => {
    setBusy(true)
    const { error } = await supabase.rpc('closer_cal_set', { p_closer: closer, p_url: v })
    setBusy(false)
    if (error) return toast(friendlyError(error), true)
    setUrl(''); toast(v ? 'Agenda relié : synchronisation en cours' : 'Agenda retiré'); load()
  }
  const ago = st?.synced_at ? new Date(st.synced_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
  return <>
    <h3 className="cl-h" style={{ marginTop: 22 }}>{who} Google Agenda</h3>
    <p className="muted small">Relie l’agenda : ses rendez-vous et événements bloquent automatiquement les créneaux proposés (rien n’est écrit dans l’agenda, il est seulement lu). Mise à jour toutes les 10 minutes.</p>
    {st?.set && <div className="sys" style={{ margin: '8px 0' }}>
      {st.err ? <>Agenda relié, mais la lecture a échoué : {st.err}. Vérifie l’adresse ci-dessous.</> : st.synced_at ? <>✓ Agenda relié · dernière lecture {ago} · {st.busy} événement{st.busy > 1 ? 's' : ''} à venir bloque{st.busy > 1 ? 'nt' : ''} des créneaux</> : <>Agenda relié · première lecture en cours…</>}
      {' '}<button type="button" className="linkbtn" disabled={busy} onClick={() => save('')}>Retirer</button></div>}
    <div className="hrange" style={{ marginLeft: 0 }}><input type="url" inputMode="url" style={{ flex: 1, minWidth: 0 }} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" value={url} onChange={(e) => setUrl(e.target.value)} /><button type="button" className="btn sm" disabled={busy || !url.trim()} onClick={() => save(url)}>{st?.set ? 'Remplacer' : 'Relier'}</button></div>
    <button type="button" className="linkbtn" style={{ paddingLeft: 0 }} onClick={() => setHelp(!help)}>{help ? 'Masquer' : 'Où trouver cette adresse ?'}</button>
    {help && <ol className="muted small" style={{ margin: '6px 0 0 18px', lineHeight: 1.6 }}>
      <li>Sur ordinateur, ouvre <b>calendar.google.com</b> (l’appli mobile ne montre pas cette option).</li>
      <li>À gauche, passe la souris sur ton agenda → <b>⋮ → Paramètres et partage</b>.</li>
      <li>Descends jusqu’à <b>« Adresse secrète au format iCal »</b> et copie le lien.</li>
      <li>Colle-le ci-dessus et appuie sur <b>Relier</b>. Ne le partage à personne : il donne accès à ton agenda.</li>
    </ol>}
  </>
}

/** Horaires d'un closer : semaine type, jours off, dates particulières. Pour le closer lui-même, ou pour Clément (avec un choix du closer). */
export default function MesHoraires({ toast, staff }) {
  const [list, setList] = useState([]); const [key, setKey] = useState(null); const [err, setErr] = useState('')
  const [week, setWeek] = useState(null); const [over, setOver] = useState({}); const [off, setOff] = useState([]); const [busy, setBusy] = useState(false)
  const [nd, setNd] = useState(''); const [dayK, setDayK] = useState(''); const [dayR, setDayR] = useState([['10:00', '11:00']])

  useEffect(() => {
    if (staff) {
      supabase.from('cand_closers').select('key,name,active').eq('active', true).order('key').then(({ data, error }) => {
        if (error) return setErr(friendlyError(error))
        const l = (data || []).filter((c) => c.key !== 'clement'); setList(l); setKey(l[0]?.key || null)
        if (!l.length) setErr('Invite d’abord un closer (onglet Closers).')
      })
    } else {
      supabase.rpc('calio_my_closer').then(({ data, error }) => { if (error) return setErr('Cette partie arrive dans quelques minutes : la mise à jour est en cours. Réessaie bientôt.'); if (!data) return setErr('Ton compte n’est pas relié à un closer.'); setKey(data) })
    }
  }, [staff])

  const load = async () => {
    if (!key) return
    const [h, o, b] = await Promise.all([
      supabase.from('cand_closer_hours').select('weekday,start_time,end_time').eq('closer', key).order('start_time'),
      supabase.from('cand_closer_overrides').select('day,start_time,end_time').eq('closer', key).gte('day', todayK()).order('day').order('start_time'),
      supabase.from('cand_closer_blocked').select('day').eq('closer', key).gte('day', todayK()).order('day')])
    const bad = h.error || o.error || b.error
    if (bad) return setErr(friendlyError(bad))
    setErr('')
    const w = {}; DOW.forEach(([d]) => { w[d] = [] }); (h.data || []).forEach((r) => w[r.weekday].push([hm(r.start_time), hm(r.end_time)]))
    const ov = {}; (o.data || []).forEach((r) => { (ov[r.day] = ov[r.day] || []).push([hm(r.start_time), hm(r.end_time)]) })
    setWeek(w); setOver(ov); setOff((b.data || []).map((x) => x.day))
  }
  useEffect(() => { setWeek(null); load() }, [key]) // eslint-disable-line

  const saveWeek = async () => {
    for (const [d] of DOW) if (badRange(week[d])) return toast('Une plage a une heure de fin avant son début. Corrige-la.', true)
    setBusy(true)
    const p = DOW.flatMap(([d]) => week[d].map((r) => ({ weekday: d, start: r[0], end: r[1] })))
    const { error } = await supabase.rpc('closer_set_week', { p_closer: key, p })
    setBusy(false)
    if (error) return toast(friendlyError(error), true)
    toast('Horaires enregistrés'); load()
  }
  const addOff = async () => {
    if (!nd) return
    const { error } = await supabase.from('cand_closer_blocked').upsert({ closer: key, day: nd })
    if (error) return toast(friendlyError(error), true)
    setNd(''); toast('Jour off ajouté'); load()
  }
  const rmOff = async (day) => { const { error } = await supabase.from('cand_closer_blocked').delete().eq('closer', key).eq('day', day); if (error) return toast(friendlyError(error), true); load() }
  const saveDay = async () => {
    if (!dayK) return toast('Choisis une date.', true)
    if (!dayR.length || badRange(dayR)) return toast('Ajoute au moins une plage valide (fin après le début).', true)
    setBusy(true)
    const { error } = await supabase.rpc('closer_set_day', { p_closer: key, p_day: dayK, p: dayR.map((r) => ({ start: r[0], end: r[1] })) })
    setBusy(false)
    if (error) return toast(friendlyError(error), true)
    setDayK(''); setDayR([['10:00', '11:00']]); toast('Date enregistrée'); load()
  }
  const rmDay = async (day) => { const { error } = await supabase.rpc('closer_set_day', { p_closer: key, p_day: day, p: [] }); if (error) return toast(friendlyError(error), true); load() }

  if (err && !week) return <div className="sheet-body"><p className="muted">{err}</p></div>
  if (!key || !week) return <div className="sheet-body"><p className="muted">Chargement…</p></div>
  return <div className="sheet-body">
    {staff && list.length > 1 && <div className="pills" style={{ marginBottom: 12 }}>{list.map((c) => <button key={c.key} className={`pill ${key === c.key ? 'on' : ''}`} onClick={() => setKey(c.key)}>{c.name}</button>)}</div>}
    <h2 className="sh">{staff ? `Horaires de ${list.find((c) => c.key === key)?.name || ''}` : 'Mes horaires'}</h2>
    <p className="muted" style={{ margin: '2px 0 10px' }}>Heure de Paris. Ces créneaux s’ajoutent à ceux de Clément : quand quelqu’un réserve un de {staff ? 'ses' : 'tes'} créneaux, l’appel {staff ? 'lui' : 'te'} revient. Un créneau déjà réservé disparaît tout seul.</p>
    <h3 className="cl-h">Semaine type</h3>
    <div className="wlist">{DOW.map(([dd, name]) => { const on = week[dd].length > 0; return <div key={dd} className="wrow">
      <div className="whead">
        <button type="button" className={`tg ${on ? 'on' : ''}`} aria-label={on ? `Fermer le ${name}` : `Ouvrir le ${name}`} onClick={() => setWeek((w) => ({ ...w, [dd]: on ? [] : [['10:00', '11:00']] }))}><i /></button>
        <b>{name}</b>{!on && <span className="muted">Indisponible</span>}
      </div>
      {on && <Ranges ranges={week[dd]} onChange={(rs) => setWeek((w) => ({ ...w, [dd]: rs }))} />}
    </div> })}</div>
    <button className="btn big" disabled={busy} onClick={saveWeek}>{busy ? '…' : 'Enregistrer les horaires'}</button>

    <h3 className="cl-h" style={{ marginTop: 22 }}>Jours off</h3>
    <p className="muted small">Un jour où {staff ? 'il/elle n’est' : 'tu n’es'} pas disponible, même si la semaine type dit le contraire.</p>
    <div className="hrange" style={{ marginLeft: 0 }}><input type="date" min={todayK()} value={nd} onChange={(e) => setNd(e.target.value)} /><button type="button" className="btn sm" disabled={!nd} onClick={addOff}>Ajouter</button></div>
    {off.map((d) => <div key={d} className="hrange" style={{ marginLeft: 0 }}><b style={{ flex: 1 }}>{longDay(d)}</b><button type="button" className="btn ghost sm" aria-label="Retirer ce jour off" onClick={() => rmOff(d)}>✕</button></div>)}

    <h3 className="cl-h" style={{ marginTop: 22 }}>Date particulière</h3>
    <p className="muted small">Des horaires précis pour une seule date (ils remplacent la semaine type ce jour-là).</p>
    <div className="hrange" style={{ marginLeft: 0 }}><input type="date" min={todayK()} value={dayK} onChange={(e) => setDayK(e.target.value)} /></div>
    {dayK && <><Ranges ranges={dayR} onChange={setDayR} /><button type="button" className="btn" style={{ marginTop: 8 }} disabled={busy} onClick={saveDay}>Enregistrer cette date</button></>}
    {Object.keys(over).map((d) => <div key={d} className="wrow"><div className="whead"><b style={{ flex: 1 }}>{longDay(d)}</b><span className="muted">{over[d].map((r) => `${r[0]}–${r[1]}`).join(' · ')}</span>
      <button type="button" className="btn ghost sm" aria-label="Supprimer cette date" onClick={() => rmDay(d)}>✕</button></div></div>)}

    <AgendaGoogle closer={key} toast={toast} who={staff ? 'Son' : 'Mon'} />
  </div>
}
