import LoadErr from './LoadErr'
import { usePS } from './persist'
import { useEffect, useState } from 'react'
import { supabase, friendlyError } from './supabase'
import Portal from './Portal'
import { closerName, useCloserNames } from './closerNames'
import { ToSend, ConfSeqEditor } from './ConfSeq'
import { OutcomeChips } from './Closing'
import { DEFAULT_MSG, RESCHEDULE_MSG, fillMsg, waWeb, openWA, NURTURE_URL } from './whatsapp'
import { copyText } from './copy'
import PrepTrack from './PrepTrack'

const ST = { reserve: ['À confirmer', 'wait'], confirme: ['Confirmé', 'ok'], fait: ['Fait', 'done'], absent: ['Absent', 'done'], annule: ['Annulé', 'done'] }
const CAPL = { '500-1000': '500–1 000 €', '1000-3000': '1 000–3 000 €', gt3000: '+ 3 000 €' }
const TZ = 'Europe/Paris'
const timeOf = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
const dayKey = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso))
const dayLabel = (iso) => {
  const k = dayKey(iso), today = dayKey(new Date().toISOString()), tom = dayKey(new Date(Date.now() + 864e5).toISOString())
  if (k === today) return "Aujourd'hui"
  if (k === tom) return 'Demain'
  const s = new Date(iso).toLocaleDateString('fr-FR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// « 2026-11-12T17:30 » (heure de Paris, saisie à la main) → instant précis
const parisISO = (v) => {
  const [d, t] = String(v).split('T'); if (!d || !t) return ''
  const [Y, M, D] = d.split('-').map(Number), [h, m] = t.split(':').map(Number)
  const guess = Date.UTC(Y, M - 1, D, h, m)
  const off = (ts) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ts)).map((x) => [x.type, x.value])); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - ts }
  const a = guess - off(guess); const iso = new Date(guess - off(a)).toISOString(); return iso
}
const dayShort = (iso) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' })
const wa = (p) => { const d = String(p || '').replace(/[^\d]/g, ''); return d ? 'https://wa.me/' + d : '' }
const countdown = (iso) => {
  const m = Math.round((new Date(iso).getTime() - Date.now()) / 60000)
  if (m <= 0) return 'maintenant'
  if (m < 60) return `dans ${m} min`
  const h = Math.floor(m / 60), r = m % 60
  if (h < 24) return `dans ${h} h${r ? ' ' + String(r).padStart(2, '0') : ''}`
  const d = Math.floor(h / 24); return `dans ${d} jour${d > 1 ? 's' : ''}`
}

/** Mes appels : accueil (prochain appel + liste) et disponibilités. `tab` = 'appels' | 'dispos'. */
export default function Candidatures({ toast, tab: main , closer }) {
  useCloserNames()
  const [rows, setRows] = useState([]); const [tab, setTab] = usePS('ca_tab', 'avenir'); const [open, setOpen] = usePS('ca_open', null)
  const [tpl, setTpl] = useState(DEFAULT_MSG); const [edit, setEdit] = usePS('ca_edit', null); const [qs, setQs] = useState({}); const [ev, setEv] = useState({}); const [rep, setRep] = useState(null)
  const [lerr, setLerr] = useState('')
  const load = () => supabase.from('candidatures').select('*').order('starts_at', { ascending: true }).limit(500).then(({ data, error }) => { if (error) return setLerr(friendlyError(error)); setLerr(''); setRows(data || []) }).catch((e) => setLerr(friendlyError(e)))
  useEffect(() => { load(); const i = setInterval(load, 60000); return () => clearInterval(i) }, [])
  const loadQs = () => supabase.from('cand_questions').select('candidature_id,name,body,updated_at').not('candidature_id', 'is', null).then(({ data }) => { const m = {}; (data || []).forEach((q) => { if (q.body && q.body.trim()) m[q.candidature_id] = q }); setQs(m) })
  useEffect(() => { if (edit === null && !rep) return; const b = document.body, h = document.documentElement; const o = [b.style.overflow, h.style.overflow]; b.style.overflow = h.style.overflow = 'hidden'; return () => { b.style.overflow = o[0]; h.style.overflow = o[1] } }, [edit !== null || !!rep])
  const openRep = (c) => setRep({ c, slots: null, day: '', pick: '', custom: '', busy: false, done: '' })
  useEffect(() => { if (!rep || rep.slots) return; supabase.rpc('cand_slots').then(({ data, error }) => setRep((r) => r && ({ ...r, slots: data || [], serr: error ? friendlyError(error) : '', day: r.day || (data && data[0] ? dayKey(data[0]) : '') }))) }, [rep && rep.c.id])
  const doRep = async () => {
    const iso = rep.pick || (rep.custom ? parisISO(rep.custom) : ''); if (!iso) return
    if (new Date(iso).getTime() < Date.now() - 60000) return toast('Choisis un horaire à venir', true)
    setRep({ ...rep, busy: true })
    const patch = { starts_at: iso }; if (['absent', 'annule'].includes(rep.c.status)) patch.status = 'reserve'
    const { error } = await supabase.from('candidatures').update(patch).eq('id', rep.c.id)
    if (error) { setRep((r) => ({ ...r, busy: false })); return toast(error.code === '23505' ? 'Ce créneau est déjà pris' : friendlyError(error), true) }
    load(); setRep((r) => ({ ...r, busy: false, done: iso })); toast('Appel replanifié')
  }
  const loadEv = () => supabase.from('cand_page_events').select('candidature_id,kind,label,created_at').not('candidature_id', 'is', null).order('created_at', { ascending: true }).limit(2000).then(({ data }) => { const m = {}; (data || []).forEach((e) => { (m[e.candidature_id] = m[e.candidature_id] || []).push(e) }); setEv(m) })
  useEffect(() => { loadQs(); loadEv(); const i = setInterval(() => { loadQs(); loadEv() }, 60000); return () => clearInterval(i) }, [])
  useEffect(() => { supabase.from('cand_templates').select('body').eq('key', 'wa_confirm').maybeSingle().then(({ data }) => data?.body && setTpl(data.body)) }, [])
  const saveTpl = async () => { const { error } = await supabase.from('cand_templates').upsert({ key: 'wa_confirm', body: edit, updated_at: new Date().toISOString() }); if (error) return toast(friendlyError(error), true); setTpl(edit); setEdit(null); toast('Message enregistré') }
  const upd = async (c, patch) => { const { error } = await supabase.from('candidatures').update(patch).eq('id', c.id); if (error) return toast(friendlyError(error), true); load() }

  const now = Date.now()
  const live = (c) => ['reserve', 'confirme'].includes(c.status)
  const upcoming = rows.filter(c => live(c) && new Date(c.starts_at).getTime() > now - 3600000).sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  const next = upcoming.find(c => new Date(c.starts_at).getTime() > now - 15 * 60000)
  const nToConfirm = rows.filter(c => c.status === 'reserve').length
  const nWeek = upcoming.filter(c => new Date(c.starts_at).getTime() < now + 7 * 864e5).length
  const nDone = rows.filter(c => c.status === 'fait').length
  const list = tab === 'avenir' ? upcoming
    : tab === 'passes' ? rows.filter(c => (live(c) && new Date(c.starts_at).getTime() <= now - 3600000) || ['fait', 'absent'].includes(c.status)).sort((a, b) => b.starts_at.localeCompare(a.starts_at))
    : rows.filter(c => c.status === 'annule').sort((a, b) => b.starts_at.localeCompare(a.starts_at))
  const groups = []; list.forEach(c => { const k = dayKey(c.starts_at); let g = groups.find(x => x.k === k); if (!g) { g = { k, label: dayLabel(c.starts_at), items: [] }; groups.push(g) } g.items.push(c) })

  return <>
    <div className="top-hero">
      <div className="hero">
        {next ? <>
          <div className="hk">Prochain appel · {countdown(next.starts_at)}</div>
          <div className="hrow">
            <div className="htime">{timeOf(next.starts_at)}</div>
            <div className="hwho"><b>{next.first_name}</b><small>{[next.situation, CAPL[next.capital] || next.capital].filter(Boolean).join(' · ')}{qs[next.id] ? ' · 💬 questions' : ''}</small></div>
            <a className="wabtn" href={waWeb(next.phone, fillMsg(tpl, next))} target="_blank" rel="noreferrer" onClick={(e) => openWA(e, next.phone, fillMsg(tpl, next))}>WhatsApp</a>
          </div>
          <PrepTrack ev={ev[next.id]} compact />
          <div className="hcopy"><a className="hcall" href={`tel:${(next.phone || '').replace(/[^\d+]/g, '')}`}>Appeler</a><button onClick={() => openRep(next)}>Replanifier</button><button onClick={() => copyText(next.phone, toast, 'Numéro copié')}>Copier le numéro</button><button onClick={() => copyText(NURTURE_URL + '?t=' + next.qtoken, toast, 'Lien personnel copié')}>Copier le lien personnel</button></div>
          {qs[next.id] && <div className="hq"><b>💬 Ses questions pour l'appel</b><p>{qs[next.id].body}</p><button className="cpy" onClick={() => copyText(qs[next.id].body, toast, 'Questions copiées')}>Copier les questions</button></div>}
        </> : lerr && !rows.length ? <><div className="hk">Appels indisponibles</div><div className="hempty">Je n'arrive pas à charger tes appels pour le moment (voir plus bas).</div></> : <><div className="hk">Aucun appel à venir</div><div className="hempty">Dès qu'une personne réserve depuis ta bio, elle apparaît ici.</div></>}
      </div>
      {next && !closer && <button className="linkbtn mlink" onClick={() => setEdit(tpl)}>Modifier le message WhatsApp prérempli</button>}
      <div className="stats"><span><b className="y">{nToConfirm}</b> à confirmer</span><span><b>{nWeek}</b> cette semaine</span><span><b className="g">{nDone}</b> faits</span></div>
    </div>
    <div className="sheet-body">
      <LoadErr msg={lerr} onRetry={load} />
      <div className="pills">{[['avenir', 'À venir'], ['passes', 'Passés'], ['annules', 'Annulés']].map(([k, l]) => <button key={k} className={`pill ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'avenir' && <ToSend rows={rows} toast={toast} reload={load} />}
      {!groups.length && !lerr && <div className="sys">Aucun appel ici pour l'instant</div>}
      {groups.map(g => <div key={g.k} className="dgroup"><div className="dlabel">{g.label}</div>
        {g.items.map(c => <div key={c.id} className={`call ${open === c.id ? 'open' : ''}`}>
          <div className="crow" onClick={() => setOpen(open === c.id ? null : c.id)}>
            <div className="ctime">{timeOf(c.starts_at)}</div>
            <div className="cmain"><b>{c.first_name}</b><small>{[c.situation, CAPL[c.capital] || c.capital].filter(Boolean).join(' · ')}</small></div>
            <span className={`badge ${c.status === 'fait' && c.outcome === 'signe' ? 'ok' : c.status === 'fait' && c.outcome === 'reflechit' ? 'wait' : (ST[c.status] || [c.status, 'done'])[1]}`}>{c.status === 'fait' && c.outcome ? (c.outcome === 'signe' ? 'Signé' : c.outcome === 'reflechit' ? 'Il réfléchit' : 'Pas signé') : (ST[c.status] || [c.status, 'done'])[0]}</span>
          </div>
          {open === c.id && <div className="cdet">
            <div className="drow"><label>WhatsApp</label><a href={waWeb(c.phone, fillMsg(tpl, c))} target="_blank" rel="noreferrer" onClick={(e) => openWA(e, c.phone, fillMsg(tpl, c))}>{c.phone}</a> <button className="cpy" onClick={() => copyText(c.phone, toast, 'Numéro copié')}>Copier</button></div>
            <div className="drow"><label>Email</label><a href={`mailto:${c.email}`}>{c.email}</a></div>
            <div className="cq"><label>Page de préparation</label><PrepTrack ev={ev[c.id]} /></div>
            {qs[c.id] && <div className="cq"><label>💬 Ses questions pour l'appel</label><p>{qs[c.id].body}</p><button className="cpy" onClick={() => copyText(qs[c.id].body, toast, 'Questions copiées')}>Copier les questions</button></div>}
            <div className="drow"><label>Budget</label><span>{CAPL[c.capital] || c.capital} · confirmé disponible</span></div>
            {c.closer && (c.closer !== 'clement' || c.route_note) && <div className="drow"><label>Avec</label><span><b>{closerName(c.closer)}</b>{c.closer !== 'clement' ? ' · c’est son WhatsApp qui confirme' : ''}{c.route_note ? ` · ${c.route_note}` : ''}</span></div>}
            {c.status === 'reserve' && <div className="drow"><label>Confirmation</label><span style={{ color: c.wa_clicked_at ? '#166534' : '#92400E', fontWeight: 600 }}>{c.wa_clicked_at ? 'A ouvert WhatsApp pour t\'écrire' : 'N\'a pas encore cliqué sur WhatsApp'}</span></div>}
            <div className="drow"><label>Réservé le</label><span>{new Date(c.created_at).toLocaleString('fr-FR', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
            {c.status === 'fait' && <div className="drow col"><label>Résultat de l'appel</label><OutcomeChips c={c} onPick={(x, v) => upd(x, { outcome: v, outcome_at: v ? new Date().toISOString() : null })} /></div>}
            <div className="acts">
              {live(c) && <a className="btn sm" style={{ textDecoration: 'none' }} href={waWeb(c.phone, fillMsg(tpl, c))} target="_blank" rel="noreferrer" onClick={(e) => openWA(e, c.phone, fillMsg(tpl, c))}>Envoyer le message WhatsApp</a>}
              {c.status === 'reserve' && <button className="btn sm" onClick={() => upd(c, { status: 'confirme' })}>✓ Message WhatsApp reçu</button>}
              {live(c) && c.phone && <a className="btn ghost sm" style={{ textDecoration: 'none' }} href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>Appeler</a>}
              {live(c) && c.phone && <a className="btn ghost sm" style={{ textDecoration: 'none' }} href={`sms:${c.phone.replace(/[^\d+]/g, '')}`}>SMS</a>}
              {live(c) && <>
                <button className="btn ghost sm" onClick={() => openRep(c)}>Replanifier</button>
                <button className="btn ghost sm" onClick={() => upd(c, { status: 'fait' })}>Appel fait</button>
                <button className="btn ghost sm" onClick={() => upd(c, { status: 'absent' })}>Absent</button>
                <button className="btn ghost sm" onClick={() => confirm('Annuler et libérer ce créneau ?') && upd(c, { status: 'annule' })}>Annuler</button></>}
              {c.status === 'annule' && <button className="btn ghost sm" onClick={() => upd(c, { status: 'reserve' })}>Rétablir</button>}
              {['absent', 'annule'].includes(c.status) && <button className="btn ghost sm" onClick={() => openRep(c)}>Replanifier</button>}
            </div>
            <textarea rows={2} defaultValue={c.note} placeholder="Note (objection, suite à donner…)" onBlur={e => e.target.value !== c.note && upd(c, { note: e.target.value })} />
          </div>}
        </div>)}
      </div>)}
      <p className="muted small">Sans message WhatsApp reçu dans le délai réglé, le créneau est libéré automatiquement.</p>
      {tab === 'avenir' && !closer && <ConfSeqEditor toast={toast} />}
    </div>
    {rep && <Portal><div className="pr-modal" onClick={() => setRep(null)}><div className="pr-mb" onClick={(e) => e.stopPropagation()}>
      {rep.done ? <>
        <h3>✓ Appel replanifié</h3>
        <p>{rep.c.first_name} : {dayLabel(rep.done)} à {timeOf(rep.done)}.</p>
        <p className="muted" style={{ fontSize: 13 }}>Prévenez la personne tout de suite, avec le nouveau jour et la nouvelle heure déjà écrits.</p>
        <div className="acts">
          <a className="btn" style={{ textDecoration: 'none' }} href={waWeb(rep.c.phone, fillMsg(RESCHEDULE_MSG, { first_name: rep.c.first_name, starts_at: rep.done }))} target="_blank" rel="noreferrer" onClick={(e) => openWA(e, rep.c.phone, fillMsg(RESCHEDULE_MSG, { first_name: rep.c.first_name, starts_at: rep.done }))}>Prévenir sur WhatsApp</a>
          <button className="btn ghost" onClick={() => setRep(null)}>Fermer</button></div>
      </> : <>
        <h3>Replanifier l'appel de {rep.c.first_name}</h3>
        <p className="muted" style={{ fontSize: 13 }}>Prévu : {dayLabel(rep.c.starts_at)} à {timeOf(rep.c.starts_at)}</p>
        {rep.slots === null && <p className="muted">Je regarde les disponibilités…</p>}
        {rep.slots && !rep.slots.length && <p className="muted">{rep.serr ? `Impossible de charger tes créneaux (${rep.serr}). ` : 'Aucun créneau libre dans tes horaires. '}Choisis un autre horaire ci-dessous.</p>}
        {!!(rep.slots && rep.slots.length) && <>
          <div className="lq">Jour</div>
          <div className="chips rp-days">{[...new Set(rep.slots.map(dayKey))].slice(0, 21).map((k) => { const iso = rep.slots.find((x) => dayKey(x) === k); return <button key={k} className={`chip ${rep.day === k && !rep.custom ? 'sel' : ''}`} onClick={() => setRep({ ...rep, day: k, pick: '', custom: '' })}>{dayShort(iso)}</button> })}</div>
          <div className="lq">Heure</div>
          <div className="chips rp-slots">{rep.slots.filter((x) => dayKey(x) === rep.day).map((x) => <button key={x} className={`chip ${rep.pick === x ? 'sel' : ''}`} onClick={() => setRep({ ...rep, pick: x, custom: '' })}>{timeOf(x)}</button>)}</div>
        </>}
        <label className="lq">Ou un autre horaire (heure de Paris)<input type="datetime-local" value={rep.custom} onChange={(e) => setRep({ ...rep, custom: e.target.value, pick: '' })} /></label>
        <div className="acts"><button className="btn" disabled={rep.busy || !(rep.pick || rep.custom)} onClick={doRep}>{rep.busy ? 'Déplacement…' : "Déplacer l'appel"}</button><button className="btn ghost" onClick={() => setRep(null)}>Annuler</button></div>
      </>}
    </div></div></Portal>}
    {edit !== null && <Portal><div className="pr-modal" onClick={() => setEdit(null)}><div className="pr-mb" onClick={(e) => e.stopPropagation()}>
      <h3>Message WhatsApp prérempli</h3>
      <p className="muted" style={{ fontSize: 13 }}>S'ouvre dans WhatsApp Business quand tu touches le bouton. Tu peux utiliser <b>{'{prenom}'}</b> <b>{'{jour}'}</b> <b>{'{heure}'}</b> et <b>{'{lien}'}</b> (la page Découvre).</p>
      <textarea rows={9} value={edit} onChange={(e) => setEdit(e.target.value)} style={{ fontSize: 16 }} />
      <div className="lq">Aperçu</div><div className="wprev">{fillMsg(edit, next || { first_name: 'Karim', starts_at: new Date(Date.now() + 864e5).toISOString() })}</div>
      <div className="acts"><button className="btn" onClick={saveTpl}>Enregistrer</button><button className="btn ghost" onClick={() => setEdit(null)}>Annuler</button><button className="linkbtn" style={{ padding: 0 }} onClick={() => setEdit(DEFAULT_MSG)}>Message d'origine</button></div></div></div></Portal>}
  </>
}
