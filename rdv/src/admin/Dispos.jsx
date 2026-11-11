import { useEffect, useMemo, useRef, useState } from 'react'
import { usePS } from './persist'
import { supabase, friendlyError } from './supabase'
import Closers from './Closers'
import Repartition from './Routage'

const TZ = 'Europe/Paris'
const DOW = [[1, 'Lundi'], [2, 'Mardi'], [3, 'Mercredi'], [4, 'Jeudi'], [5, 'Vendredi'], [6, 'Samedi'], [0, 'Dimanche']]
const DNAME = { 0: 'dimanche', 1: 'lundi', 2: 'mardi', 3: 'mercredi', 4: 'jeudi', 5: 'vendredi', 6: 'samedi' }
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']
const hm = (t) => String(t || '').slice(0, 5)
const pad = (n) => String(n).padStart(2, '0')
const key = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`
const parisKey = (iso) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map(x => [x.type, x.value])); return [`${p.year}-${p.month}-${p.day}`, `${p.hour}:${p.minute}`] }
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
const fromMin = (n) => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`
const dowOf = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay() }
const addDays = (k, n) => { const [y, m, d] = k.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return key(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) }
const longDay = (k) => { const [y, m, d] = k.split('-').map(Number); const s = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }); return s.charAt(0).toUpperCase() + s.slice(1) }
const badRange = (rs) => rs.some(r => !r[0] || !r[1] || r[0] >= r[1])

/** Petit éditeur de plages horaires (début – fin, + ajouter, ✕ supprimer). */
function Ranges({ ranges, onChange }) {
  const set = (i, k, v) => onChange(ranges.map((r, j) => j === i ? (k ? [r[0], v] : [v, r[1]]) : r))
  return <>
    {ranges.map((r, i) => <div key={i} className="hrange" style={{ marginLeft: 0 }}>
      <input type="time" value={r[0]} onChange={e => set(i, 0, e.target.value)} /><span>–</span><input type="time" value={r[1]} onChange={e => set(i, 1, e.target.value)} />
      <button type="button" className="btn ghost sm" aria-label="Supprimer la plage" onClick={() => onChange(ranges.filter((_, j) => j !== i))}>✕</button></div>)}
    {ranges.length < 4 && <button type="button" className="linkbtn" style={{ paddingLeft: 0 }} onClick={() => onChange([...ranges, ranges.length ? ['17:00', '18:00'] : ['10:00', '11:00']])}>+ Ajouter une plage</button>}
  </>
}

/** Disponibilités : Horaires (semaine type) · Dates (calendrier + exceptions) · Agenda (Google Agenda). */
export default function Dispos({ toast }) {
  const todayK = parisKey(new Date().toISOString())[0]
  const [ty, tm] = todayK.split('-').map(Number)
  const [sub, setSub] = usePS('di_sub', 'horaires')
  const [ym, setYm] = useState({ y: ty, m: tm - 1 })
  const [sel, setSel] = useState(todayK)
  const [week, setWeek] = useState(null); const [cfg, setCfg] = useState(null); const [blocked, setBlocked] = useState([]); const [over, setOver] = useState({})
  const [free, setFree] = useState(new Set()); const [taken, setTaken] = useState(new Set())
  const [gcal, setGcal] = useState(null); const [busy, setBusy] = useState([])
  const [copy, setCopy] = useState(null); const [copyTo, setCopyTo] = useState([])
  const [editDay, setEditDay] = useState(false); const [dayRanges, setDayRanges] = useState([])

  const load = async () => {
    supabase.rpc('gcal_status').then(({ data }) => setGcal(data))
    supabase.from('busy_times').select('starts_at,ends_at,title').gte('ends_at', new Date().toISOString()).then(({ data }) => setBusy((data || []).map(e => { const [dk, a] = parisKey(e.starts_at), [dk2, b] = parisKey(e.ends_at); return { dk, a: toMin(a), b: dk2 === dk ? toMin(b) : 1440 } })))
    const [h, s, b, o, sl, cd] = await Promise.all([
      supabase.from('cand_hours').select('*').order('start_time'), supabase.from('cand_settings').select('*').eq('id', 1).single(),
      supabase.from('cand_blocked').select('day').order('day'), supabase.from('cand_overrides').select('*').order('start_time'), supabase.rpc('cand_slots'),
      supabase.from('candidatures').select('starts_at,status').in('status', ['reserve', 'confirme']).gte('starts_at', new Date(Date.now() - 864e5).toISOString())])
    const w = {}; DOW.forEach(([d]) => { w[d] = [] }); (h.data || []).forEach(r => w[r.weekday].push([hm(r.start_time), hm(r.end_time)]))
    const ov = {}; (o.data || []).forEach(r => { (ov[r.day] = ov[r.day] || []).push([hm(r.start_time), hm(r.end_time)]) })
    setWeek(w); setCfg(s.data); setBlocked((b.data || []).map(x => x.day)); setOver(ov)
    setFree(new Set((sl.data || []).map(i => parisKey(i).join('|')))); setTaken(new Set((cd.data || []).map(c => parisKey(c.starts_at).join('|'))))
  }
  useEffect(() => {
    load()
    try {
      const p = new URLSearchParams(window.location.search).get('agenda')
      if (p) {
        setSub('agenda'); window.history.replaceState({}, '', window.location.pathname)
        if (p === 'ok') { toast('Google Agenda connecté'); supabase.rpc('gcal_sync_now').then(() => setTimeout(load, 5000)) }
        else toast(p === 'refuse' ? 'Connexion refusée côté Google' : 'La connexion à Google n\u2019a pas abouti, réessaie', true)
      }
    } catch (e) { /* rien */ }
  }, [])

  const rangesFor = (k) => over[k] || (week && week[dowOf(k)]) || []
  const slotsFor = (k) => {
    if (!week || !cfg) return []
    const out = []; const dur = +cfg.slot_min, step = +cfg.step_min
    for (const [a, b] of rangesFor(k)) for (let t = toMin(a); t + dur <= toMin(b); t += step) out.push(fromMin(t))
    return out
  }
  const horizonK = cfg ? addDays(todayK, +cfg.horizon_days) : todayK
  const cells = useMemo(() => {
    if (!week || !cfg) return []
    const first = key(ym.y, ym.m, 1); const lead = (dowOf(first) + 6) % 7; const start = addDays(first, -lead)
    return Array.from({ length: 42 }, (_, i) => {
      const k = addDays(start, i); const inMonth = +k.slice(5, 7) - 1 === ym.m
      const sl = slotsFor(k); const isBlocked = blocked.includes(k)
      let st = 'open'
      if (k < todayK) st = 'past'; else if (isBlocked) st = 'closed'; else if (!sl.length) st = 'off'; else if (k > horizonK) st = 'far'
      const nFree = st === 'open' ? sl.filter(t => free.has(k + '|' + t)).length : 0
      return { k, d: +k.slice(8), inMonth, st, n: nFree, ovr: !!over[k] }
    })
  }, [week, cfg, blocked, free, ym, over])

  const saveWeek = async () => {
    for (const rs of Object.values(week)) if (badRange(rs)) return toast('Vérifie les horaires : le début doit précéder la fin', true)
    const { error: e1 } = await supabase.from('cand_hours').delete().gte('id', 0); if (e1) return toast(friendlyError(e1), true)
    const ins = Object.entries(week).flatMap(([d, rs]) => rs.map(r => ({ weekday: +d, start_time: r[0], end_time: r[1] })))
    if (ins.length) { const { error } = await supabase.from('cand_hours').insert(ins); if (error) return toast(friendlyError(error), true) }
    toast('Horaires enregistrés'); load()
  }
  const hz0 = useRef(0)
  const setHorizon = async (n) => {
    const prev = cfg.horizon_days; setCfg((c) => ({ ...c, horizon_days: n }))
    const { error } = await supabase.from('cand_settings').update({ horizon_days: n }).eq('id', 1)
    if (error) { setCfg((c) => ({ ...c, horizon_days: prev })); return toast(friendlyError(error), true) }
    toast(`Réservable jusqu'à ${n} jour${n > 1 ? 's' : ''} à l'avance`); load()
  }
  const waDigits = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.startsWith('00') ? d.slice(2) : d.startsWith('0') ? '33' + d.slice(1) : d }
  const saveCfg = async () => {
    if (!/^\d{10,15}$/.test(waDigits(cfg.wa_number))) return toast('Numéro WhatsApp invalide', true)
    const { error } = await supabase.from('cand_settings').update({ slot_min: +cfg.slot_min, step_min: +cfg.step_min, notice_min: Math.round(+(cfg.notice_h ?? cfg.notice_min / 60) * 60), horizon_days: +cfg.horizon_days, release_hours: +cfg.release_hours, wa_number: waDigits(cfg.wa_number) }).eq('id', 1)
    if (error) return toast(friendlyError(error), true); toast('Réglages enregistrés'); load()
  }
  const toggleBlock = async () => {
    if (blocked.includes(sel)) await supabase.from('cand_blocked').delete().eq('day', sel)
    else { const { error } = await supabase.from('cand_blocked').upsert({ day: sel }); if (error) return toast(friendlyError(error), true) }
    load()
  }
  const openDayEditor = () => { setDayRanges(rangesFor(sel).map(r => [...r])); setEditDay(true) }
  const saveDay = async () => {
    if (badRange(dayRanges)) return toast('Vérifie les horaires : le début doit précéder la fin', true)
    await supabase.from('cand_overrides').delete().eq('day', sel)
    if (!dayRanges.length) { await supabase.from('cand_blocked').upsert({ day: sel }); toast('Jour fermé'); setEditDay(false); return load() }
    const { error } = await supabase.from('cand_overrides').insert(dayRanges.map(r => ({ day: sel, start_time: r[0], end_time: r[1] }))); if (error) return toast(friendlyError(error), true)
    await supabase.from('cand_blocked').delete().eq('day', sel)
    toast('Horaires de ce jour enregistrés'); setEditDay(false); load()
  }
  const resetDay = async () => { await supabase.from('cand_overrides').delete().eq('day', sel); toast('Horaires habituels rétablis'); setEditDay(false); load() }
  const saveGcal = async (e) => {
    e.preventDefault(); const v = e.target.ics.value.trim()
    if (!v) return toast('Colle d\u2019abord l\u2019adresse secrète de ton agenda dans le champ', true)
    const { error } = await supabase.rpc('set_gcal_ics', { p_url: v }); if (error) return toast(friendlyError(error), true)
    e.target.reset(); toast('Agenda connecté, synchro en cours…'); setTimeout(load, 4000); load()
  }
  const unplug = async () => { const { error } = await supabase.rpc('gcal_disconnect'); if (error) return toast(friendlyError(error), true); toast('Agenda déconnecté'); load() }
  const syncNow = async () => { const { error } = await supabase.rpc('gcal_sync_now'); if (error) return toast(friendlyError(error), true); toast('Synchro lancée'); setTimeout(load, 4000) }
  const saveOauth = async (e) => {
    e.preventDefault(); const f = new FormData(e.target)
    const { error } = await supabase.rpc('set_google_oauth', { p_client_id: String(f.get('cid') || ''), p_client_secret: String(f.get('csec') || '') }); if (error) return toast(friendlyError(error), true)
    e.target.reset(); toast('Identifiants Google enregistrés'); load()
  }
  const connectGoogle = async () => {
    const { data, error } = await supabase.rpc('gcal_oauth_start'); if (error) return toast(friendlyError(error), true)
    const q = new URLSearchParams({ client_id: data.client_id, redirect_uri: 'https://jfournnrqewntnfyptic.supabase.co/functions/v1/gcal-oauth', response_type: 'code', scope: 'https://www.googleapis.com/auth/calendar.freebusy', access_type: 'offline', prompt: 'consent', state: data.state })
    window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + q.toString()
  }
  const nav = (n) => setYm(({ y, m }) => { const t = new Date(Date.UTC(y, m + n, 1)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() } })
  const applyCopy = () => { setWeek(w => { const n = { ...w }; copyTo.forEach(d => { n[d] = w[copy].map(r => [...r]) }); return n }); setCopy(null); setCopyTo([]); toast('Copié : pense à enregistrer') }

  if (!week || !cfg) return <div className="sheet-body"><p className="muted">Chargement…</p></div>
  const d = dowOf(sel); const sl = slotsFor(sel); const isBlocked = blocked.includes(sel); const past = sel < todayK
  const nFreeSel = sl.filter(t => free.has(sel + '|' + t)).length

  return <div className="sheet-body">
    <div className="pills" style={{ marginBottom: 12 }}>{[['horaires', 'Horaires'], ['dates', 'Dates'], ['agenda', 'Agenda'], ['closers', 'Closers'], ['repartition', 'Répartition']].map(([k, l]) => <button key={k} className={`pill ${sub === k ? 'on' : ''}`} onClick={() => setSub(k)}>{l}{k === 'agenda' && gcal && !gcal.set ? ' •' : ''}</button>)}</div>

    {sub === 'horaires' && <>
      {cfg && <div className="settings hz">
        <b>Jusqu'à combien de jours à l'avance peut-on réserver ?</b>
        <p className="muted small" style={{ margin: '4px 0 0' }}>Aujourd'hui + {+cfg.horizon_days} jour{+cfg.horizon_days > 1 ? 's' : ''} : les candidats ne voient aucun créneau au-delà du {new Date(Date.now() + +cfg.horizon_days * 864e5).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' })}.</p>
        <div className="chips">{[1, 2, 3, 5, 7, 14, 21, 30].map((n) => <button key={n} type="button" className={`chip ${+cfg.horizon_days === n ? 'sel' : ''}`} onClick={() => setHorizon(n)}>{n} jour{n > 1 ? 's' : ''}</button>)}</div>
        <div className="hz-c"><label className="lq" htmlFor="hz">Autre nombre de jours</label><input id="hz" type="number" inputMode="numeric" min="1" max="60" value={cfg.horizon_days} onChange={(e) => setCfg({ ...cfg, horizon_days: e.target.value })} onBlur={(e) => { const n = Math.min(60, Math.max(1, Math.round(+e.target.value || 14))); if (n !== +hz0.current) setHorizon(n); else setCfg((c) => ({ ...c, horizon_days: n })) }} onFocus={(e) => { hz0.current = e.target.value }} /></div>
      </div>}
      <h2 className="sh">Mes horaires habituels</h2>
      <p className="muted" style={{ margin: '2px 0 10px' }}>Heure de Paris. C'est ce que voient les candidats chaque semaine.</p>
      <div className="wlist">{DOW.map(([dd, name]) => { const on = week[dd].length > 0; return <div key={dd} className="wrow">
        <div className="whead">
          <button type="button" className={`tg ${on ? 'on' : ''}`} aria-label={on ? `Fermer le ${DNAME[dd]}` : `Ouvrir le ${DNAME[dd]}`} onClick={() => setWeek(w => ({ ...w, [dd]: on ? [] : [['10:00', '11:00']] }))}><i /></button>
          <b>{name}</b>{!on && <span className="muted">Indisponible</span>}
          {on && <button type="button" className="cpy" aria-label={`Copier les horaires du ${DNAME[dd]}`} onClick={() => { setCopy(copy === dd ? null : dd); setCopyTo([]) }}>Copier</button>}
        </div>
        {on && <Ranges ranges={week[dd]} onChange={rs => setWeek(w => ({ ...w, [dd]: rs }))} />}
        {copy === dd && <div className="copybox"><span className="muted small">Copier sur :</span><div className="chips">{DOW.filter(([x]) => x !== dd).map(([x, n]) => <button key={x} type="button" className={`chip ${copyTo.includes(x) ? 'sel' : ''}`} onClick={() => setCopyTo(c => c.includes(x) ? c.filter(y => y !== x) : [...c, x])}>{n.slice(0, 3)}.</button>)}</div>
          <button type="button" className="btn sm" disabled={!copyTo.length} onClick={applyCopy}>Appliquer</button></div>}
      </div> })}</div>
      <button className="btn big" onClick={saveWeek}>Enregistrer mes horaires</button>
      <details className="settings"><summary>Réglages des appels</summary>
        <div className="grid2">
          <div><label className="lq">Durée de l'appel (min)</label><input type="number" min="15" max="120" value={cfg.slot_min} onChange={e => setCfg({ ...cfg, slot_min: e.target.value })} /></div>
          <div><label className="lq">Un créneau toutes les (min)</label><input type="number" min="5" max="120" value={cfg.step_min} onChange={e => setCfg({ ...cfg, step_min: e.target.value })} /></div>
          <div><label className="lq">Délai minimum (heures)</label><input type="number" min="0" max="72" value={cfg.notice_h ?? Math.round(cfg.notice_min / 60)} onChange={e => setCfg({ ...cfg, notice_h: e.target.value })} /></div>
          <div><label className="lq">Réservable jusqu'à (jours à l'avance)</label><input type="number" min="1" max="60" value={cfg.horizon_days} onChange={e => setCfg({ ...cfg, horizon_days: e.target.value })} /></div>
          <div style={{ gridColumn: '1 / -1' }}><label className="lq">Ton numéro WhatsApp (celui où les candidats t'écrivent)</label><input type="tel" inputMode="tel" value={cfg.wa_number || ''} onChange={e => setCfg({ ...cfg, wa_number: e.target.value })} placeholder="07 56 84 94 21" />
            <a className="muted small" href={`https://wa.me/${waDigits(cfg.wa_number)}`} target="_blank" rel="noopener noreferrer">Tester : ouvrir WhatsApp sur ce numéro (+{waDigits(cfg.wa_number)})</a></div>
          <div><label className="lq">Libérer sans message après (h)</label><input type="number" min="1" max="48" value={cfg.release_hours} onChange={e => setCfg({ ...cfg, release_hours: e.target.value })} /></div>
        </div>
        <button className="btn big" onClick={saveCfg}>Enregistrer les réglages</button>
      </details>
    </>}

    {sub === 'dates' && <>
      <div className="mhead"><h2 className="sh">{MONTHS[ym.m]} {ym.y}</h2><div className="mnav"><button onClick={() => nav(-1)} aria-label="Mois précédent">‹</button><button onClick={() => nav(1)} aria-label="Mois suivant">›</button></div></div>
      <div className="mcal">
        {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((w, i) => <div key={i} className="mw">{w}</div>)}
        {cells.map(c => <button key={c.k} className={`mc ${c.st} ${c.inMonth ? '' : 'out'} ${c.k === sel ? 'sel' : ''} ${c.k === todayK ? 'today' : ''} ${c.ovr ? 'ovr' : ''}`} onClick={() => { setSel(c.k); setEditDay(false); if (!c.inMonth) setYm({ y: +c.k.slice(0, 4), m: +c.k.slice(5, 7) - 1 }) }}>
          <b>{c.d}</b><i>{c.st === 'open' ? c.n : c.st === 'closed' ? 'fermé' : c.st === 'far' ? '—' : ''}</i></button>)}
      </div>
      <div className="mleg"><span><u className="g" /> Ouvert (créneaux libres)</span><span><u className="r" /> Fermé</span><span><u className="d" /> Horaires particuliers</span></div>

      <div className="daycard">
        <div className="dchead"><b>{longDay(sel)}</b><span>{past ? 'Passé' : isBlocked ? 'Fermé' : sl.length ? `${nFreeSel} libre${nFreeSel > 1 ? 's' : ''} sur ${sl.length}` : 'Aucun horaire'}</span></div>
        {over[sel] && !isBlocked && <p className="small" style={{ margin: '6px 0 0', color: '#1D4ED8' }}>Horaires particuliers pour cette date : {over[sel].map(r => r.join('–')).join(' · ')}</p>}
        {!isBlocked && !past && sl.length > 0 && <div className="slotchips">{sl.map(t => { const k = sel + '|' + t; const m0 = toMin(t); const inAgenda = busy.some(e => e.dk === sel && m0 < e.b && m0 + +cfg.slot_min > e.a); const st = free.has(k) ? 'ok' : taken.has(k) ? 'res' : 'off'; return <span key={t} className={`sc ${st}`}>{t}{st === 'res' ? ' · réservé' : st === 'off' && inAgenda ? ' · Agenda' : ''}</span> })}</div>}
        {!isBlocked && !past && !sl.length && <p className="muted small" style={{ margin: '8px 0 0' }}>Pas d'horaire le {DNAME[d]}.</p>}
        {isBlocked && <p className="muted small" style={{ margin: '8px 0 0' }}>Ce jour est fermé : personne ne peut réserver.</p>}
        {!past && <div className="dcbtns">
          <button className="btn ghost sm" onClick={() => editDay ? setEditDay(false) : openDayEditor()}>{editDay ? 'Annuler' : 'Horaires différents'}</button>
          <button className={`btn sm ${isBlocked ? '' : 'danger'}`} onClick={toggleBlock}>{isBlocked ? 'Rouvrir ce jour' : 'Fermer ce jour'}</button>
        </div>}
        {editDay && <div className="editor">
          <p className="muted small" style={{ margin: '0 0 6px' }}>Horaires uniquement pour le <b>{longDay(sel).toLowerCase()}</b>. Sans plage, le jour est fermé.</p>
          <Ranges ranges={dayRanges} onChange={setDayRanges} />
          <button className="btn big" onClick={saveDay}>Enregistrer pour ce jour</button>
          {over[sel] && <button className="btn ghost big" style={{ marginTop: 8 }} onClick={resetDay}>Remettre les horaires habituels</button>}
        </div>}
      </div>
    </>}

    {sub === 'closers' && <Closers toast={toast} />}
    {sub === 'repartition' && <Repartition toast={toast} />}
    {sub === 'agenda' && <>
      <h2 className="sh">Google Agenda</h2>
      <div className="gcard" style={{ marginTop: 10 }}>
        <div className="dchead"><b>Calendrier connecté</b>{gcal?.set ? <span className="gok">● Connecté</span> : <span className="gno">Non connecté</span>}</div>
        {gcal?.set && <p className="muted small" style={{ margin: '6px 0 0' }}>{gcal.mode === 'google' ? 'Connexion Google directe. ' : 'Adresse iCal. '}{gcal.busy} créneau(x) occupé(s) à venir{gcal.synced_at ? ` · dernière synchro ${new Date(gcal.synced_at).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })}` : ''}. Mise à jour toutes les 10 min.</p>}
        <p className="muted small" style={{ margin: '6px 0 10px' }}>Quand tu es occupé dans Google Agenda, les créneaux correspondants disparaissent automatiquement de ta page de réservation. Seules les plages occupées sont lues, jamais le titre ni le contenu de tes événements.</p>
        {gcal?.set ? <div className="dcbtns"><button className="btn ghost sm" onClick={syncNow}>Synchroniser maintenant</button><button className="btn ghost sm" onClick={unplug}>Déconnecter</button></div>
          : gcal?.oauth_ready ? <button className="btn big" style={{ marginTop: 0 }} onClick={connectGoogle}>Se connecter avec Google</button>
          : <p className="muted small" style={{ margin: 0 }}>Une configuration unique est nécessaire (voir ci-dessous).</p>}
      </div>
      {!gcal?.set && !gcal?.oauth_ready && <div className="gcard"><b>Configuration unique</b>
        <p className="muted small" style={{ margin: '6px 0 8px' }}>Colle ici les deux informations du « client OAuth » créé dans Google Cloud. Elles sont gardées côté serveur.</p>
        <form onSubmit={saveOauth}>
          <input name="cid" placeholder="ID client (…apps.googleusercontent.com)" autoComplete="off" />
          <input name="csec" type="password" placeholder="Code secret du client" autoComplete="off" style={{ marginTop: 8 }} />
          <button className="btn big">Enregistrer</button>
        </form></div>}
      {!gcal?.set && <details className="gcard"><summary style={{ fontWeight: 600, cursor: 'pointer' }}>Autre méthode : adresse iCal secrète</summary>
        <form onSubmit={saveGcal} style={{ marginTop: 10 }}>
          <input name="ics" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" />
          <div className="dcbtns"><button className="btn sm">Connecter avec l'adresse</button></div>
        </form></details>}
    </>}
  </div>
}
