import LoadErr from './LoadErr'
import { usePS } from './persist'
import Portal from './Portal'
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase, friendlyError } from './supabase'
import { openWA, fillMsg, waWeb, NURTURE_MSG, NURTURE_URL } from './whatsapp'
import PrepTrack, { usePrep } from './PrepTrack'
import { copyText } from './copy'

const TZ = 'Europe/Paris'
const STAGE = { rdv: 'Appel prévu', qualifie: 'Qualifié', potentiel: 'Potentiel', incomplet: 'Incomplet', disqualifie: 'Disqualifié', fait: 'Appel fait', absent: 'Absent', annule: 'Annulé' }
const CAPL = { lt500: '- 500 €', '500-1000': '500–1 000 €', '1000-3000': '1 000–3 000 €', gt3000: '+ 3 000 €' }
const CAPO = { lt500: 0, '500-1000': 1, '1000-3000': 2, gt3000: 3 }
const CST = { reserve: 'À confirmer', confirme: 'Confirmé', fait: 'Fait', absent: 'Absent', annule: 'Annulé' }
const STEPL = { who: 'Coordonnées', situ: 'Situation', budget: 'Budget', slot: 'Créneaux vus' }
const FOLL = { new: 'À relancer', done: 'Déjà relancé', skip: 'Écarté' }
const PAGE = 50

const VIEWS = [['all', 'Tous les prospects'], ['relance', 'À relancer'], ['rdv', 'Appel prévu'], ['fait', 'Appels faits'], ['noshow', 'Absents & annulés'], ['qualifie', 'Qualifiés'], ['incomplet', 'Incomplets'], ['froid', 'Disqualifiés']]
const inView = (v, r) => ({
  all: () => true,
  relance: () => !r.call_id && r.follow === 'new' && (r.phone || r.email) && ['potentiel', 'qualifie'].includes(r.stage) && ['500-1000', '1000-3000', 'gt3000'].includes(r.capital),
  rdv: () => r.stage === 'rdv', fait: () => r.stage === 'fait', noshow: () => r.stage === 'absent' || r.stage === 'annule',
  qualifie: () => r.stage === 'qualifie', incomplet: () => r.stage === 'incomplet', froid: () => r.stage === 'disqualifie',
}[v]())

const dt = (iso) => iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
const dd = (iso) => iso ? new Date(iso).toLocaleDateString('fr-FR', { timeZone: TZ, day: 'numeric', month: 'short', year: '2-digit' }) : ''
const dcall = (iso) => iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
const full = (r) => [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Sans nom'
const wa = (p) => { const d = String(p || '').replace(/[^\d]/g, ''); return d ? 'https://wa.me/' + d : '' }
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const digits = (s) => String(s || '').replace(/\D/g, '')
const okMail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(s)

// [clé, titre, largeur, valeur de tri/affichage]
const COLS = [
  ['stage', 'Statut', 130, (r) => STAGE[r.stage]],
  ['phone', 'Téléphone', 150, (r) => r.phone || r.phone_raw || ''],
  ['email', 'Email', 230, (r) => r.email || r.email_raw || ''],
  ['situation', 'Situation', 150, (r) => r.situation || ''],
  ['capital', 'Budget', 120, (r) => CAPO[r.capital] ?? ''],
  ['source', 'Source', 110, (r) => r.source || ''],
  ['call_at', 'Appel', 160, (r) => r.call_at || ''],
  ['calls', 'Nb appels', 90, (r) => r.calls],
  ['closer', 'Closer', 110, (r) => r.closer || ''],
  ['tags', 'Tags', 160, (r) => (r.tags || []).join(', ')],
  ['step', 'Avancement', 140, (r) => STEPL[r.step]],
  ['follow', 'Suivi', 100, (r) => FOLL[r.follow]],
  ['created_at', 'Ajouté le', 120, (r) => r.created_at],
  ['updated_at', 'Dernière activité', 140, (r) => r.updated_at],
]
const DEF = ['stage', 'phone', 'email', 'source', 'capital', 'call_at', 'created_at']
const lsGet = () => { try { const v = JSON.parse(localStorage.getItem('calio_pr_cols')); if (Array.isArray(v) && v.length) return v } catch { /* */ } return DEF }

// Une personne = un numéro. Si elle s'est inscrite deux fois (autre email, même téléphone), on n'affiche qu'une fiche
// (celle qui a un appel, sinon la plus avancée, sinon la plus récente) et on garde les autres en `dupIds` pour les fusionner.
const RANK = { rdv: 8, fait: 7, absent: 6, annule: 2, qualifie: 5, potentiel: 4, disqualifie: 3, incomplet: 1 }
const last9 = (s) => { const d = digits(s); return d.length >= 9 ? d.slice(-9) : '' }
function dedupe(all) {
  const g = new Map(), out = []
  for (const r of all) { const k = last9(r.phone || r.phone_raw); if (!k) { out.push(r); continue } if (!g.has(k)) g.set(k, []); g.get(k).push(r) }
  for (const a of g.values()) {
    if (a.length === 1) { out.push(a[0]); continue }
    const best = [...a].sort((x, y) => (RANK[y.stage] || 0) - (RANK[x.stage] || 0) || (y.updated_at > x.updated_at ? 1 : -1))[0]
    out.push({ ...best, dupIds: a.filter((x) => x.id !== best.id).map((x) => x.id), dupEmails: a.filter((x) => x.id !== best.id).map((x) => x.email || x.email_raw).filter(Boolean) })
  }
  return out.sort((x, y) => (y.updated_at > x.updated_at ? 1 : -1))
}

function Badge({ s }) { return <span className={`prb st-${s}`}>{STAGE[s]}</span> }

function parseCSV(txt) {
  txt = txt.replace(/^﻿/, '')
  const first = txt.split(/\r?\n/)[0] || ''
  const d = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ','
  const out = []; let row = [], cur = '', q = false
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i]
    if (q) { if (c === '"') { if (txt[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c }
    else if (c === '"') q = true
    else if (c === d) { row.push(cur); cur = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && txt[i + 1] === '\n') i++; row.push(cur); cur = ''; out.push(row); row = [] }
    else cur += c
  }
  if (cur !== '' || row.length) { row.push(cur); out.push(row) }
  return out.filter((r) => r.some((x) => x.trim()))
}
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
const normPhone = (raw) => {
  let s = String(raw || '').trim(); if (!s) return ''
  const plus = s.startsWith('+') || s.startsWith('00'); let d = digits(s); if (s.startsWith('00')) d = d.replace(/^00/, '')
  if (!plus) { if (d.startsWith('0')) d = '33' + d.slice(1); else if (d.length === 9 && /^[67]/.test(d)) d = '33' + d }
  if (plus && /^330\d{9}$/.test(d)) d = '33' + d.slice(3) // « +33 (0)6… » : le 0 entre parenthèses ne fait pas partie du numéro
  return d.length >= 8 ? '+' + d : ''
}

/** « Prospects » : la base de contacts (toutes les personnes qui ont laissé leurs infos, même en partie). */
export default function Prospects({ toast, focus }) {
  const [rows, setRows] = useState(null)
  const [view, setView] = usePS('pr_view', 'all'); const [q, setQ] = useState(''); const [fSrc, setFSrc] = usePS('pr_src', ''); const [fSit, setFSit] = usePS('pr_sit', '')
  const [sort, setSort] = useState({ k: 'updated_at', dir: -1 }); const [page, setPage] = useState(0)
  const [cols, setCols] = useState(lsGet); const [colMenu, setColMenu] = useState(false)
  const [sel, setSel] = useState(() => new Set()); const [openId, setOpenId] = usePS('pr_open', null)
  const [oq, setOq] = useState(null)
  const [add, setAdd] = useState(false); const [imp, setImp] = useState(null); const [tagIn, setTagIn] = useState('')
  const file = useRef(null)
  useEffect(() => { if (!(add || imp)) return; const b = document.body, h = document.documentElement; const o = [b.style.overflow, h.style.overflow]; b.style.overflow = h.style.overflow = 'hidden'; return () => { b.style.overflow = o[0]; h.style.overflow = o[1] } }, [!!(add || imp)])

  const [lerr, setLerr] = useState('')
  const load = async () => {
    let all = [], from = 0, bad = ''
    try {
      for (;;) {
        const { data, error } = await supabase.from('prospects_v').select('*').order('updated_at', { ascending: false }).range(from, from + 999)
        if (error) { bad = friendlyError(error); break }
        all = all.concat(data || []); if (!data || data.length < 1000) break; from += 1000
      }
    } catch (e) { bad = friendlyError(e) }
    setLerr(bad); if (!bad) setRows(dedupe(all))
  }
  useEffect(() => { load(); const i = setInterval(load, 60000); return () => clearInterval(i) }, [])
  useEffect(() => { if (focus?.id) { setView('all'); setOpenId(focus.id) } }, [focus])
  useEffect(() => { try { localStorage.setItem('calio_pr_cols', JSON.stringify(cols)) } catch { /* */ } }, [cols])
  useEffect(() => { setPage(0); setSel(new Set()) }, [view, q, fSrc, fSit])

  const R = rows || []
  const counts = useMemo(() => Object.fromEntries(VIEWS.map(([k]) => [k, R.filter((r) => inView(k, r)).length])), [rows])
  const sources = useMemo(() => [...new Set(R.map((r) => r.source).filter(Boolean))].sort(), [rows])
  const sits = useMemo(() => [...new Set(R.map((r) => r.situation).filter(Boolean))].sort(), [rows])
  const list = useMemo(() => {
    const nq = norm(q), dq = digits(q)
    const f = R.filter((r) => inView(view, r) && (!fSrc || r.source === fSrc) && (!fSit || r.situation === fSit) &&
      (!nq || norm(full(r) + ' ' + (r.email || r.email_raw || '') + ' ' + (r.note || '') + ' ' + (r.tags || []).join(' ')).includes(nq) || (dq.length > 2 && (digits(r.phone || r.phone_raw).includes(dq) || digits(r.phone || r.phone_raw).includes(dq.replace(/^00?/, ''))))))
    const col = sort.k === 'name' ? [0, 0, 0, full] : COLS.find((c) => c[0] === sort.k)
    const val = (r) => { const v = col[3](r); return typeof v === 'string' ? norm(v) : v }
    return [...f].sort((a, b) => { const x = val(a), y = val(b); const ex = x === '' || x == null, ey = y === '' || y == null; if (ex || ey) return ex === ey ? 0 : ex ? 1 : -1; return (x > y ? 1 : x < y ? -1 : 0) * sort.dir })
  }, [rows, view, q, fSrc, fSit, sort])
  const pages = Math.max(1, Math.ceil(list.length / PAGE)); const cur = Math.min(page, pages - 1)
  const slice = list.slice(cur * PAGE, cur * PAGE + PAGE)
  const open = R.find((r) => r.id === openId)
  const pev = usePrep('lead_id', openId)
  const nurture = open ? fillMsg(NURTURE_MSG, { first_name: open.first_name, qtoken: open.qtoken }) : ''
  const copyLink = () => { try { navigator.clipboard.writeText(NURTURE_URL + '?t=' + open.qtoken); toast('Lien personnel copié') } catch { toast('Copie impossible', true) } }
  useEffect(() => { setOq(null); if (!openId) return; supabase.from('cand_questions').select('body,updated_at').eq('lead_id', openId).order('updated_at', { ascending: false }).limit(1).then(({ data }) => { const d = data && data[0]; setOq(d && d.body && d.body.trim() ? d : null) }) }, [openId])

  const week = Date.now() - 7 * 864e5
  const stats = { total: R.length, neu: R.filter((r) => new Date(r.created_at).getTime() > week).length, rdv: R.filter((r) => r.stage === 'rdv').length, relance: counts.relance || 0 }
  const booked = R.filter((r) => r.call_id).length

  const upd = async (ids, patch, quiet) => {
    const { error } = await supabase.from('cand_leads').update(patch).in('id', ids)
    if (error) return toast(friendlyError(error), true)
    setRows((rs) => rs.map((r) => ids.includes(r.id) ? { ...r, ...patch } : r)); if (!quiet) toast('Enregistré'); load()
  }
  const sortBy = (k) => setSort((s) => s.k === k ? { k, dir: -s.dir } : { k, dir: k === 'name' ? 1 : -1 })
  const toggleCol = (k) => setCols((c) => c.includes(k) ? c.filter((x) => x !== k) : COLS.map((x) => x[0]).filter((x) => c.includes(x) || x === k))
  const allOn = slice.length > 0 && slice.every((r) => sel.has(r.id))
  const togAll = () => setSel(allOn ? new Set() : new Set(slice.map((r) => r.id)))
  const tog = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const exportCsv = () => {
    const src = sel.size ? list.filter((r) => sel.has(r.id)) : list
    const H = ['Prénom', 'Nom', 'Téléphone', 'Email', 'Statut', 'Situation', 'Budget', 'Source', 'Campagne', 'Prochain/dernier appel', 'Nb appels', 'Closer', 'Tags', 'Suivi', 'Note', 'Ajouté le']
    const L = src.map((r) => [r.first_name, r.last_name, r.phone || r.phone_raw, r.email || r.email_raw, STAGE[r.stage], r.situation, CAPL[r.capital] || '', r.source, r.utm?.campaign || '', r.call_at ? dcall(r.call_at) : '', r.calls, r.closer, (r.tags || []).join(' | '), FOLL[r.follow], r.note, dt(r.created_at)].map(csvCell).join(';'))
    const blob = new Blob(['﻿' + [H.join(';'), ...L].join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `prospects-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000)
    toast(`${src.length} prospect${src.length > 1 ? 's' : ''} exporté${src.length > 1 ? 's' : ''}`)
  }

  const pickFile = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return
    const t = parseCSV(await f.text()); if (t.length < 2) return toast('Fichier vide ou illisible', true)
    const H = t[0].map(norm); const ix = (re) => H.findIndex((h) => re.test(h))
    const iF = ix(/prenom|first/), iL = ix(/^nom$|last|famille|surname|nom de famille/), iN = ix(/^name$|nom complet|full ?name|contact/), iP = ix(/phone|tel|mobile|whatsapp|portable/), iE = ix(/mail/), iS = ix(/source/), iT = ix(/tag/)
    const seenE = new Set(R.map((r) => (r.email || '').toLowerCase()).filter(Boolean)), seenP = new Set(R.map((r) => r.phone).filter(Boolean))
    const out = []; let dup = 0
    t.slice(1).forEach((c) => {
      let fn = iF >= 0 ? (c[iF] || '').trim() : '', ln = iL >= 0 ? (c[iL] || '').trim() : ''
      if (!fn && iN >= 0) { const p = (c[iN] || '').trim().split(/\s+/); fn = p.shift() || ''; ln = ln || p.join(' ') }
      const em = iE >= 0 ? (c[iE] || '').trim().toLowerCase() : '', ph = iP >= 0 ? normPhone(c[iP]) : ''
      if (!fn && !em && !ph) return
      if ((em && seenE.has(em)) || (ph && seenP.has(ph))) { dup++; return }
      if (em) seenE.add(em); if (ph) seenP.add(ph)
      out.push({ first_name: fn || null, last_name: ln || null, phone: ph || null, phone_raw: ph || (iP >= 0 ? (c[iP] || '').trim() || null : null), email: okMail(em) ? em : null, email_raw: em || null, source: (iS >= 0 && (c[iS] || '').trim()) || 'Import', tags: iT >= 0 ? (c[iT] || '').split(/[|,]/).map((x) => x.trim()).filter(Boolean) : [] })
    })
    setImp({ out, dup, relance: false, busy: false })
  }
  const doImport = async () => {
    setImp((i) => ({ ...i, busy: true }))
    const base = Date.now().toString(36)
    const all = imp.out.map((o, i) => ({ ...o, sid: `imp-${base}-${i}-${Math.random().toString(36).slice(2, 6)}`, step: 'who', follow: imp.relance ? 'new' : 'skip' }))
    for (let i = 0; i < all.length; i += 200) {
      const { error } = await supabase.from('cand_leads').insert(all.slice(i, i + 200))
      if (error) { setImp(null); return toast(friendlyError(error), true) }
    }
    setImp(null); toast(`${all.length} prospects importés`); load()
  }
  const doAdd = async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const em = String(f.get('email')).trim().toLowerCase(), ph = normPhone(f.get('phone'))
    const rec = { sid: 'man-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), first_name: String(f.get('first')).trim() || null, last_name: String(f.get('last')).trim() || null, phone: ph || null, phone_raw: String(f.get('phone')).trim() || null, email: okMail(em) ? em : null, email_raw: em || null, source: String(f.get('source')).trim() || 'Ajout manuel', step: 'who' }
    if (!rec.first_name && !rec.phone_raw && !rec.email_raw) return toast('Mets au moins un prénom, un numéro ou un email', true)
    const { error } = await supabase.from('cand_leads').insert(rec); if (error) return toast(friendlyError(error), true)
    setAdd(false); toast('Prospect ajouté'); load()
  }
  const merge = async (r) => {
    if (!window.confirm(`${full(r)} a ${r.dupIds.length + 1} fiches avec le même numéro. On garde celle-ci et on supprime l’autre${r.dupIds.length > 1 ? 's' : ''} (${r.dupEmails.join(', ') || 'sans email'}). Ses rendez-vous ne sont pas touchés. Continuer ?`)) return
    const { error } = await supabase.from('cand_leads').delete().in('id', r.dupIds); if (error) return toast(friendlyError(error), true)
    toast('Fiches fusionnées'); load()
  }
  const del = async (r) => {
    // Seul un appel encore à venir (réservé / confirmé) bloque ; un appel annulé, fait ou absent ne bloque plus.
    if (r.call_status === 'reserve' || r.call_status === 'confirme') return toast('Il a un appel à venir : annule-le d’abord dans « Appels »', true)
    if (!window.confirm(`Supprimer définitivement ${full(r)} ? Impossible d’annuler.${r.calls > 0 ? ' Ses rendez-vous passés ou annulés restent dans « Appels ».' : ''}`)) return
    const { error } = await supabase.from('cand_leads').delete().eq('id', r.id); if (error) return toast(friendlyError(error), true)
    setOpenId(null); toast('Supprimé'); load()
  }
  const addTag = (r, t) => { t = t.trim(); if (!t || (r.tags || []).includes(t)) return; upd([r.id], { tags: [...(r.tags || []), t] }, true) }
  const bulkTag = () => { const t = tagIn.trim(); if (!t) return; const ids = [...sel]; Promise.all(R.filter((r) => sel.has(r.id)).map((r) => supabase.from('cand_leads').update({ tags: [...new Set([...(r.tags || []), t])] }).eq('id', r.id))).then(() => { setTagIn(''); toast('Tag ajouté'); load() }) }

  const cell = (k, r) => {
    switch (k) {
      case 'stage': return <Badge s={r.stage} />
      case 'phone': return r.phone ? <a href={wa(r.phone)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{r.phone}</a> : r.phone_raw ? <i className="raw">{r.phone_raw}</i> : <span className="nil">—</span>
      case 'email': return r.email || (r.email_raw ? <i className="raw">{r.email_raw}</i> : <span className="nil">—</span>)
      case 'capital': return CAPL[r.capital] || <span className="nil">—</span>
      case 'call_at': return r.call_at ? dcall(r.call_at) : <span className="nil">—</span>
      case 'tags': return (r.tags || []).length ? <span className="tags">{r.tags.map((t) => <u key={t}>{t}</u>)}</span> : <span className="nil">—</span>
      case 'step': return STEPL[r.step]
      case 'follow': return FOLL[r.follow]
      case 'created_at': return dd(r.created_at)
      case 'updated_at': return dt(r.updated_at)
      default: { const c = COLS.find((x) => x[0] === k); const v = c[3](r); return v === '' || v == null ? <span className="nil">—</span> : v }
    }
  }
  const vis = COLS.filter((c) => cols.includes(c[0]))
  const th = (k, label, w) => <th key={k} style={{ minWidth: w }} onClick={() => sortBy(k)} className={sort.k === k ? 'on' : ''}>{label}{sort.k === k ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}</th>

  return <div className="pr">
    <aside className="pr-side">
      <div className="pr-vt">Vues</div>
      {VIEWS.map(([k, l]) => <button key={k} className={`pr-v ${view === k ? 'on' : ''}`} onClick={() => setView(k)}><span>{l}</span><b>{counts[k] ?? 0}</b></button>)}
    </aside>
    <section className="pr-main">
      <div className="pr-stats">
        <div><b>{stats.total}</b><span>Prospects</span></div>
        <div><b>{stats.neu}</b><span>Nouveaux (7 j)</span></div>
        <div><b>{stats.relance}</b><span>À relancer</span></div>
        <div><b>{stats.rdv}</b><span>Appels prévus</span></div>
        <div><b>{stats.total ? Math.round(booked / stats.total * 100) : 0} %</b><span>Ont réservé</span></div>
      </div>
      <div className="pr-tools">
        <input className="pr-q" type="search" placeholder="Rechercher un nom, un numéro, un email…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={fSrc} onChange={(e) => setFSrc(e.target.value)}><option value="">Source : toutes</option>{sources.map((s) => <option key={s}>{s}</option>)}</select>
        <select value={fSit} onChange={(e) => setFSit(e.target.value)}><option value="">Situation : toutes</option>{sits.map((s) => <option key={s}>{s}</option>)}</select>
        <div className="pr-colw">
          <button className="btn ghost sm" onClick={() => setColMenu(!colMenu)}>Colonnes</button>
          {colMenu && <div className="pr-colm">{COLS.map((c) => <label key={c[0]}><input type="checkbox" checked={cols.includes(c[0])} onChange={() => toggleCol(c[0])} />{c[1]}</label>)}<button className="linkbtn" onClick={() => { setCols(DEF); setColMenu(false) }}>Remettre par défaut</button></div>}
        </div>
        <button className="btn ghost sm" onClick={exportCsv}>{sel.size ? `Exporter (${sel.size})` : 'Exporter CSV'}</button>
        <button className="btn ghost sm" onClick={() => file.current?.click()}>Importer</button>
        <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={pickFile} />
        <button className="btn sm" onClick={() => setAdd(true)}>+ Prospect</button>
      </div>
      {sel.size > 0 && <div className="pr-bulk"><b>{sel.size} sélectionné{sel.size > 1 ? 's' : ''}</b>
        <button className="btn ghost sm" onClick={() => upd([...sel], { follow: 'done' })}>Marquer relancés</button>
        <button className="btn ghost sm" onClick={() => upd([...sel], { follow: 'skip' })}>Écarter</button>
        <button className="btn ghost sm" onClick={() => upd([...sel], { follow: 'new' })}>Remettre à relancer</button>
        <input placeholder="Nouveau tag" value={tagIn} onChange={(e) => setTagIn(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && bulkTag()} />
        <button className="btn ghost sm" onClick={bulkTag}>Ajouter le tag</button>
        <button className="linkbtn" style={{ padding: 0 }} onClick={() => setSel(new Set())}>Tout désélectionner</button></div>}
      {rows === null && !lerr && <p className="muted">Chargement…</p>}
      <LoadErr msg={lerr} onRetry={load} />
      {rows && !lerr && !list.length && <div className="sys">Aucun prospect ici pour le moment</div>}
      {rows && list.length > 0 && <>
        <div className="pr-tw"><table className="pr-t">
          <thead><tr><th className="ck"><input type="checkbox" checked={allOn} onChange={togAll} /></th>{th('name', 'Prospect', 190)}{vis.map((c) => th(c[0], c[1], c[2]))}</tr></thead>
          <tbody>{slice.map((r) => <tr key={r.id} className={`${sel.has(r.id) ? 'sel' : ''} ${openId === r.id ? 'cur' : ''}`} onClick={() => setOpenId(r.id)}>
            <td className="ck" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(r.id)} onChange={() => tog(r.id)} /></td>
            <td className="nm"><b>{full(r)}</b></td>
            {vis.map((c) => <td key={c[0]}>{cell(c[0], r)}</td>)}</tr>)}</tbody>
        </table></div>
        <div className="pr-cards">{slice.map((r) => <div key={r.id} className="call" onClick={() => setOpenId(r.id)}><div className="crow"><div className="cmain"><b>{full(r)}</b><small>{r.phone || r.phone_raw || r.email || r.email_raw || 'Pas de coordonnées'} · {r.source || '—'}</small></div><Badge s={r.stage} /></div></div>)}</div>
        <div className="pr-foot"><span className="muted">{list.length} prospect{list.length > 1 ? 's' : ''} · page {cur + 1}/{pages}</span>
          <span><button className="btn ghost sm" disabled={cur === 0} onClick={() => setPage(cur - 1)}>← Précédent</button> <button className="btn ghost sm" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Suivant →</button></span></div>
      </>}
    </section>

    {open && <Portal><div className="pr-back" onClick={() => setOpenId(null)} />
      <aside className="pr-dr" key={open.id}>
        <div className="pr-drh"><div><h3>{full(open)}</h3><Badge s={open.stage} /></div><button className="out" style={{ color: '#5B6270' }} onClick={() => setOpenId(null)} aria-label="Fermer">✕</button></div>
        <div className="acts">
          {open.phone && <a className="btn sm" style={{ textDecoration: 'none' }} href={wa(open.phone)} target="_blank" rel="noreferrer" onClick={(e) => openWA(e, open.phone, '')}>WhatsApp</a>}
          {open.phone && <a className="btn ghost sm" style={{ textDecoration: 'none' }} href={`tel:${open.phone}`}>Appeler</a>}
          {(open.phone || open.phone_raw) && <button className="btn ghost sm" onClick={() => copyText(open.phone || open.phone_raw, toast, 'Numéro copié')}>Copier le numéro</button>}
          {open.email && <a className="btn ghost sm" style={{ textDecoration: 'none' }} href={`mailto:${open.email}`}>Email</a>}
        </div>
        {open.dupIds?.length > 0 && <div className="dupnote">Même numéro, {open.dupIds.length + 1} fiches{open.dupEmails.length ? ` (autre email : ${open.dupEmails.join(', ')})` : ''}. <button className="btn ghost sm" onClick={() => merge(open)}>Fusionner</button></div>}
        <h4>Coordonnées</h4>
        <div className="grid2" style={{ marginTop: 0 }}>
          <label className="lq">Prénom<input defaultValue={open.first_name || ''} onBlur={(e) => e.target.value.trim() !== (open.first_name || '') && upd([open.id], { first_name: e.target.value.trim() || null }, true)} /></label>
          <label className="lq">Nom<input defaultValue={open.last_name || ''} onBlur={(e) => e.target.value.trim() !== (open.last_name || '') && upd([open.id], { last_name: e.target.value.trim() || null }, true)} /></label>
        </div>
        <label className="lq">Téléphone<input defaultValue={open.phone || open.phone_raw || ''} onBlur={(e) => { const v = e.target.value.trim(); if (v === (open.phone || open.phone_raw || '')) return; const n = normPhone(v); upd([open.id], { phone: n || null, phone_raw: v || null }, true) }} /></label>
        <label className="lq">Email<input type="email" defaultValue={open.email || open.email_raw || ''} onBlur={(e) => { const v = e.target.value.trim().toLowerCase(); if (v === (open.email || open.email_raw || '')) return; upd([open.id], { email: okMail(v) ? v : null, email_raw: v || null }, true) }} /></label>
        <h4>Suivi</h4>
        <div className="chips" style={{ marginTop: 0 }}>{Object.entries(FOLL).map(([k, l]) => <button key={k} className={`chip ${open.follow === k ? 'sel' : ''}`} onClick={() => upd([open.id], { follow: k }, true)}>{l}</button>)}</div>
        <label className="lq">Closer<input defaultValue={open.closer || ''} placeholder="Qui s'en occupe ?" onBlur={(e) => e.target.value.trim() !== (open.closer || '') && upd([open.id], { closer: e.target.value.trim() || null }, true)} /></label>
        <div className="lq">Tags</div>
        <div className="chips" style={{ marginTop: 0 }}>{(open.tags || []).map((t) => <button key={t} className="chip sel" onClick={() => upd([open.id], { tags: open.tags.filter((x) => x !== t) }, true)}>{t} ✕</button>)}
          <input className="pr-tagin" placeholder="+ tag" onKeyDown={(e) => { if (e.key === 'Enter') { addTag(open, e.target.value); e.target.value = '' } }} /></div>
        <label className="lq">Note<textarea rows={3} defaultValue={open.note || ''} placeholder="Note…" onBlur={(e) => e.target.value !== (open.note || '') && upd([open.id], { note: e.target.value }, true)} /></label>
        <h4>Page de préparation</h4>
        <PrepTrack ev={pev} />
        <div className="acts" style={{ marginTop: 8 }}>
          {open.phone && <a className="btn sm" style={{ textDecoration: 'none' }} href={waWeb(open.phone, nurture)} target="_blank" rel="noreferrer" onClick={(e) => openWA(e, open.phone, nurture)}>Envoyer la page sur WhatsApp</a>}
          <button className="btn ghost sm" onClick={copyLink}>Copier le lien personnel</button>
        </div>
        {oq && <><h4>Ses questions pour l'appel</h4><div className="cq" style={{ marginTop: 0 }}><p>{oq.body}</p><button className="cpy" onClick={() => copyText(oq.body, toast, 'Questions copiées')}>Copier les questions</button></div></>}
        <h4>Parcours</h4>
        <ul className="pr-tl">
          <li><b>{dt(open.created_at)}</b> Première visite{open.source ? ` · via ${open.source}` : ''}</li>
          <li><b>{STEPL[open.step]}</b> dernière étape atteinte · {dt(open.updated_at)}</li>
          {open.call_id && <li><b>{dcall(open.call_at)}</b> Appel · {CST[open.call_status] || open.call_status}{open.calls > 1 ? ` (${open.calls} appels)` : ''}</li>}
        </ul>
        <h4>Ses réponses</h4>
        <div className="drow"><label>Situation</label><span>{open.situation || '—'}</span></div>
        {open.experience && <div className="drow"><label>Expérience</label><span>{open.experience}</span></div>}
        {open.blocage && <div className="drow" style={{ display: 'block' }}><label>Ce qui l'a bloqué</label><p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{open.blocage}</p></div>}
        <div className="drow"><label>Budget</label><span>{CAPL[open.capital] || '—'}{open.budget_confirmed === 'yes' ? ' · dispo maintenant' : open.budget_confirmed === 'soon' ? ' · pas avant quelques semaines' : open.budget_confirmed === 'no' ? ' · pas dispo' : ''}</span></div>
        <h4>Origine</h4>
        <div className="drow"><label>Source</label><span>{open.source || '—'}</span></div>
        {Object.entries(open.utm || {}).map(([k, v]) => <div className="drow" key={k}><label>{k}</label><span>{v}</span></div>)}
        {open.referrer && <div className="drow"><label>Venait de</label><span>{open.referrer}</span></div>}
        <div className="acts" style={{ marginTop: 18 }}><button className="btn danger sm" onClick={() => del(open)}>Supprimer ce prospect</button></div>
      </aside></Portal>}

    {add && <Portal><div className="pr-modal" onClick={() => setAdd(false)}><form className="pr-mb" onClick={(e) => e.stopPropagation()} onSubmit={doAdd}>
      <h3>Nouveau prospect</h3>
      <div className="grid2"><input name="first" placeholder="Prénom" /><input name="last" placeholder="Nom" /></div>
      <input name="phone" placeholder="Téléphone (06… ou +33…)" style={{ marginTop: 10 }} />
      <input name="email" type="email" placeholder="Email" style={{ marginTop: 10 }} />
      <input name="source" placeholder="Source (TikTok, Instagram, bouche-à-oreille…)" style={{ marginTop: 10 }} />
      <div className="acts"><button className="btn">Ajouter</button><button type="button" className="btn ghost" onClick={() => setAdd(false)}>Annuler</button></div></form></div></Portal>}

    {imp && <Portal><div className="pr-modal" onClick={() => !imp.busy && setImp(null)}><div className="pr-mb" onClick={(e) => e.stopPropagation()}>
      <h3>Importer des contacts</h3>
      <p><b>{imp.out.length}</b> nouveau{imp.out.length > 1 ? 'x' : ''} prospect{imp.out.length > 1 ? 's' : ''} à importer{imp.dup ? ` · ${imp.dup} déjà dans la base (ignorés)` : ''}.</p>
      <label className="showpw" style={{ color: '#12151C' }}><input type="checkbox" checked={imp.relance} onChange={(e) => setImp({ ...imp, relance: e.target.checked })} /> Les mettre dans « À relancer »</label>
      <p className="muted" style={{ fontSize: 13 }}>Décoché : ils rejoignent la base sans gonfler ta liste de relances.</p>
      <div className="acts"><button className="btn" disabled={imp.busy || !imp.out.length} onClick={doImport}>{imp.busy ? 'Import…' : 'Importer'}</button><button className="btn ghost" disabled={imp.busy} onClick={() => setImp(null)}>Annuler</button></div></div></div></Portal>}
  </div>
}
