import { useEffect, useState } from 'react'
import { supabase, friendlyError } from './supabase'
import { DEFAULT_MSG, fillMsg, waWeb, openWA } from './whatsapp'
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
export default function Candidatures({ toast, tab: main }) {
  const [rows, setRows] = useState([]); const [tab, setTab] = useState('avenir'); const [open, setOpen] = useState(null)
  const [tpl, setTpl] = useState(DEFAULT_MSG); const [edit, setEdit] = useState(null); const [qs, setQs] = useState({}); const [ev, setEv] = useState({})
  const load = () => supabase.from('candidatures').select('*').order('starts_at', { ascending: true }).limit(500).then(({ data }) => setRows(data || []))
  useEffect(() => { load(); const i = setInterval(load, 60000); return () => clearInterval(i) }, [])
  const loadQs = () => supabase.from('cand_questions').select('candidature_id,name,body,updated_at').not('candidature_id', 'is', null).then(({ data }) => { const m = {}; (data || []).forEach((q) => { if (q.body && q.body.trim()) m[q.candidature_id] = q }); setQs(m) })
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
          {qs[next.id] && <div className="hq"><b>💬 Ses questions pour l'appel</b><p>{qs[next.id].body}</p></div>}
        </> : <><div className="hk">Aucun appel à venir</div><div className="hempty">Dès qu'une personne réserve depuis ta bio, elle apparaît ici.</div></>}
      </div>
      {next && <button className="linkbtn mlink" onClick={() => setEdit(tpl)}>Modifier le message WhatsApp prérempli</button>}
      <div className="stats"><span><b className="y">{nToConfirm}</b> à confirmer</span><span><b>{nWeek}</b> cette semaine</span><span><b className="g">{nDone}</b> faits</span></div>
    </div>
    <div className="sheet-body">
      <div className="pills">{[['avenir', 'À venir'], ['passes', 'Passés'], ['annules', 'Annulés']].map(([k, l]) => <button key={k} className={`pill ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      {!groups.length && <div className="sys">Aucun appel ici pour l'instant</div>}
      {groups.map(g => <div key={g.k} className="dgroup"><div className="dlabel">{g.label}</div>
        {g.items.map(c => <div key={c.id} className={`call ${open === c.id ? 'open' : ''}`}>
          <div className="crow" onClick={() => setOpen(open === c.id ? null : c.id)}>
            <div className="ctime">{timeOf(c.starts_at)}</div>
            <div className="cmain"><b>{c.first_name}</b><small>{[c.situation, CAPL[c.capital] || c.capital].filter(Boolean).join(' · ')}</small></div>
            <span className={`badge ${ST[c.status][1]}`}>{ST[c.status][0]}</span>
          </div>
          {open === c.id && <div className="cdet">
            <div className="drow"><label>WhatsApp</label><a href={waWeb(c.phone, fillMsg(tpl, c))} target="_blank" rel="noreferrer" onClick={(e) => openWA(e, c.phone, fillMsg(tpl, c))}>{c.phone}</a></div>
            <div className="drow"><label>Email</label><a href={`mailto:${c.email}`}>{c.email}</a></div>
            <div className="cq"><label>Page de préparation</label><PrepTrack ev={ev[c.id]} /></div>
            {qs[c.id] && <div className="cq"><label>💬 Ses questions pour l'appel</label><p>{qs[c.id].body}</p></div>}
            <div className="drow"><label>Budget</label><span>{CAPL[c.capital] || c.capital} · confirmé disponible</span></div>
            <div className="drow"><label>Réservé le</label><span>{new Date(c.created_at).toLocaleString('fr-FR', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
            <div className="acts">
              {live(c) && <a className="btn sm" style={{ textDecoration: 'none' }} href={waWeb(c.phone, fillMsg(tpl, c))} target="_blank" rel="noreferrer" onClick={(e) => openWA(e, c.phone, fillMsg(tpl, c))}>Envoyer le message WhatsApp</a>}
              {c.status === 'reserve' && <button className="btn sm" onClick={() => upd(c, { status: 'confirme' })}>✓ Message WhatsApp reçu</button>}
              {live(c) && <>
                <button className="btn ghost sm" onClick={() => upd(c, { status: 'fait' })}>Appel fait</button>
                <button className="btn ghost sm" onClick={() => upd(c, { status: 'absent' })}>Absent</button>
                <button className="btn ghost sm" onClick={() => confirm('Annuler et libérer ce créneau ?') && upd(c, { status: 'annule' })}>Annuler</button></>}
              {c.status === 'annule' && <button className="btn ghost sm" onClick={() => upd(c, { status: 'reserve' })}>Rétablir</button>}
            </div>
            <textarea rows={2} defaultValue={c.note} placeholder="Note (objection, suite à donner…)" onBlur={e => e.target.value !== c.note && upd(c, { note: e.target.value })} />
          </div>}
        </div>)}
      </div>)}
      <p className="muted small">Sans message WhatsApp reçu dans le délai réglé, le créneau est libéré automatiquement.</p>
    </div>
    {edit !== null && <div className="pr-modal" onClick={() => setEdit(null)}><div className="pr-mb" onClick={(e) => e.stopPropagation()}>
      <h3>Message WhatsApp prérempli</h3>
      <p className="muted" style={{ fontSize: 13 }}>S'ouvre dans WhatsApp Business quand tu touches le bouton. Tu peux utiliser <b>{'{prenom}'}</b> <b>{'{jour}'}</b> <b>{'{heure}'}</b> et <b>{'{lien}'}</b> (la page Découvre).</p>
      <textarea rows={9} value={edit} onChange={(e) => setEdit(e.target.value)} style={{ fontSize: 15 }} />
      <div className="lq">Aperçu</div><div className="wprev">{fillMsg(edit, next || { first_name: 'Karim', starts_at: new Date(Date.now() + 864e5).toISOString() })}</div>
      <div className="acts"><button className="btn" onClick={saveTpl}>Enregistrer</button><button className="btn ghost" onClick={() => setEdit(null)}>Annuler</button><button className="linkbtn" style={{ padding: 0 }} onClick={() => setEdit(DEFAULT_MSG)}>Message d'origine</button></div></div></div>}
  </>
}
