import LoadErr from './LoadErr'
import { usePS } from './persist'
import { useEffect, useState } from 'react'
import { supabase, friendlyError } from './supabase'
import { openWA, waWeb } from './whatsapp'

const TZ = 'Europe/Paris'
const CAPL = { lt500: '- 500 €', '500-1000': '500–1 000 €', '1000-3000': '1 000–3 000 €', gt3000: '+ 3 000 €' }
const STEP = { who: 'A laissé ses coordonnées', situ: 'S’est arrêté après la situation', budget: 'S’est arrêté à la question budget', slot: 'A vu les créneaux sans réserver' }
const RESULT = { repondu: ['A répondu', 'ok'], pas_reponse: ['Pas de réponse', 'wait'], reserve: ['A réservé', 'ok'], pas_interesse: ['Pas intéressé', 'done'] }
const CHAN = { whatsapp: 'WhatsApp', 'email-auto': 'Email auto', tel: 'Appel', sms: 'SMS' }
const LINK = 'https://rdv.theambitiousman.fr/'
const DEF_WA = "Salut {prenom}, c'est Clément 👋\nJe vois que tu as commencé à réserver ton appel mais que tu n'es pas allé au bout. Tu as eu un souci ?\nTu peux reprendre ici quand tu veux : {lien}\nOu réponds-moi directement ici, je suis là pour en parler."

const ago = (iso) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (m < 2) return "à l'instant"
  if (m < 60) return `il y a ${m} min`
  const h = Math.floor(m / 60); if (h < 24) return `il y a ${h} h`
  const d = Math.floor(h / 24); return `il y a ${d} jour${d > 1 ? 's' : ''}`
}
const dayFr = (d) => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: TZ })
const todayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const diffDays = (a, b) => Math.round((new Date(a + 'T12:00:00Z') - new Date(b + 'T12:00:00Z')) / 864e5)
const fill = (tpl, l) => String(tpl || '').replace(/\{prenom\}/g, l.first_name || '').replace(/\{lien\}/g, LINK).replace(/\{date\}/g, l.budget_date ? dayFr(l.budget_date) : '').replace(/Salut ,/, 'Salut,')
// pas qualifié = a dit moins de 500 € ou pas de budget disponible maintenant
const unqualified = (l) => l.capital === 'lt500' || ['soon', 'no'].includes(l.budget_confirmed)
const dtm = (iso) => new Date(iso).toLocaleString('fr-FR', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const dayOf = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso))
const autoOk = (l) => !/^(imp|man|cand)-/.test(l.sid || '') && Date.now() - new Date(l.updated_at).getTime() < 30 * 864e5
const KIND = { auto: 'Premier email', rseq: 'Email de suivi', seq: 'Email « plus tard »' }

/** « Relances » : les personnes qui ont laissé leurs coordonnées sans réserver d'appel, leur suivi, les messages modèles et la séquence « plus tard ». */
export default function Leads({ toast, onChange }) {
  const [rows, setRows] = useState(null); const [tab, setTab] = usePS('le_tab', 'todo'); const [open, setOpen] = usePS('le_open', null); const [lerr, setLerr] = useState('')
  const [seq, setSeq] = useState([]); const [rseq, setRseq] = useState([]); const [tpl, setTpl] = useState({}); const [cfg, setCfg] = useState(null)
  const load = () => supabase.from('cand_leads').select('*').order('updated_at', { ascending: false }).limit(500).then(({ data, error }) => { if (error) return setLerr(friendlyError(error)); setLerr(''); setRows(data || []); onChange && onChange((data || []).filter(l => !l.booked && l.follow === 'new' && !unqualified(l)).length) }).catch((e) => setLerr(friendlyError(e)))
  const loadMsgs = () => {
    supabase.from('cand_seq').select('*').order('pos').then(({ data }) => setSeq(data || []))
    supabase.from('cand_rseq').select('*').order('pos').then(({ data }) => setRseq(data || []))
    supabase.from('cand_templates').select('key,body').in('key', ['wa_relance', 'mail_relance', 'mail_relance_sujet']).then(({ data }) => setTpl(Object.fromEntries((data || []).map(r => [r.key, r.body]))))
    supabase.from('cand_settings').select('auto_relance,auto_relance_min').eq('id', 1).maybeSingle().then(({ data }) => setCfg(data))
  }
  useEffect(() => { load(); loadMsgs(); const i = setInterval(load, 60000); return () => clearInterval(i) }, [])
  const upd = async (l, patch) => { const { error } = await supabase.from('cand_leads').update(patch).eq('id', l.id); if (error) return toast(friendlyError(error), true); load() }

  const today = todayKey()
  const open_ = (rows || []).filter(l => !l.booked)
  const usable = (l) => Boolean(l.phone || l.email)
  const later = open_.filter(l => l.budget_date && l.follow !== 'skip')
  const rest = open_.filter(l => !(l.budget_date && l.follow !== 'skip'))
  const todo = rest.filter(l => l.follow === 'new' && usable(l) && !unqualified(l))
  const cold = rest.filter(l => l.follow === 'new' && usable(l) && unqualified(l))
  const part = rest.filter(l => l.follow === 'new' && !usable(l))
  const sent = rest.filter(l => l.follow === 'done')
  const skipped = open_.filter(l => l.follow === 'skip')
  // étapes de la séquence « plus tard » à envoyer aujourd'hui (ou en retard)
  const dueSteps = (l) => seq.filter(s => !(l.seq_sent || []).includes(s.pos) && addDays(l.budget_date, s.offset_days) <= today)
  const laterSorted = [...later].sort((a, b) => (dueSteps(b).length > 0) - (dueSteps(a).length > 0) || a.budget_date.localeCompare(b.budget_date))
  const nDue = later.filter(l => dueSteps(l).length).length
  const list = { todo, sent, later: laterSorted, part, cold, skip: skipped }[tab]
  const tabs = [['todo', `À relancer · ${todo.length}`], ['sent', `Relancés · ${sent.length}`], ['later', `Plus tard · ${later.length}${nDue ? ' · ' + nDue + ' à envoyer' : ''}`], ['part', `Incomplets · ${part.length}`], ['cold', `Pas prêts · ${cold.length}`], ['skip', `Écartés · ${skipped.length}`]]
  const msg = (l) => fill(tpl.wa_relance || DEF_WA, l)

  // Relance : on ouvre WhatsApp ET on note qui / quand / par quel canal.
  const track = (l, channel) => upd(l, { follow: 'done', followed_at: new Date().toISOString(), follow_count: (l.follow_count || 0) + 1, follow_channel: channel, follow_result: null })
  const sendSeq = (l, s) => upd(l, { seq_sent: [...(l.seq_sent || []), s.pos], followed_at: new Date().toISOString(), follow_count: (l.follow_count || 0) + 1, follow_channel: 'whatsapp' })

  const badge = (l) => {
    if (l.follow === 'skip') return <span className="badge done">Écarté</span>
    if (l.follow_result) return <span className={`badge ${RESULT[l.follow_result][1]}`}>{RESULT[l.follow_result][0]}</span>
    if (l.follow === 'done') return <span className="badge ok">{l.follow_channel === 'email-auto' ? 'Relancé par email' : 'Relancé'}{l.follow_count > 1 ? ` · ${l.follow_count}×` : ''}</span>
    if (l.budget_date) return <span className="badge wait">{dueSteps(l).length ? 'À envoyer' : 'Le ' + dayFr(l.budget_date)}</span>
    return <span className="badge wait">{!usable(l) ? 'Incomplet' : unqualified(l) ? 'Pas prêt' : l.email ? (autoOk(l) ? 'Email auto en route' : 'À relancer') : 'Sans email'}</span>
  }

  // Prochain email automatique prévu pour une personne (ou pourquoi il n'y en a plus).
  const nextMail = (l) => {
    if (l.follow === 'skip') return 'Aucun : écarté'
    if (!l.email) return 'Aucun : pas d’email (impossible de relancer automatiquement)'
    if (l.budget_date) { const st = seq.filter(x => !(l.seq_sent || []).includes(x.pos)).map(x => ({ x, d: addDays(l.budget_date, x.offset_days) })).filter(o => o.d >= addDays(today, -5)).sort((a, b) => a.d.localeCompare(b.d))[0]; return st ? `${st.x.label} · ${st.d <= today ? 'aujourd’hui' : 'le ' + dayFr(st.d)}` : 'Séquence terminée' }
    if (unqualified(l)) return 'Aucun : budget pas disponible'
    if (['repondu', 'pas_interesse', 'reserve'].includes(l.follow_result)) return 'Aucun : ' + RESULT[l.follow_result][0].toLowerCase()
    if (!l.auto_sent_at) return autoOk(l) ? 'Premier email dans quelques minutes' : 'Aucun : fiche trop ancienne ou importée à la main'
    const st = rseq.filter(r => r.active && !(l.rseq_sent || []).includes(r.id)).sort((a, b) => a.pos - b.pos)[0]
    if (!st) return 'Séquence terminée : aucun autre email prévu'
    return `${st.label} · à partir du ${dtm(new Date(new Date(l.auto_sent_at).getTime() + st.after_hours * 36e5).toISOString())}`
  }
  const logs = (rows || []).flatMap(l => l.mail_log || [])
  const nToday = logs.filter(e => dayOf(e.at) === today).length
  const n7 = logs.filter(e => Date.now() - new Date(e.at).getTime() < 7 * 864e5).length
  const nBooked = (rows || []).filter(l => l.booked && (l.mail_log || []).length > 0).length

  return <div className="sheet-body">
    <h2 className="sh">Relances</h2>
    <p className="muted">Les personnes qui ont laissé leurs coordonnées sans réserver d'appel. Rien n'est perdu.</p>
    <div className="pills" style={{ marginTop: 14 }}>{tabs.map(([k, l]) => <button key={k} className={`pill ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
    {rows && <div className="rl-stats">
      <div><b>{nToday}</b><span>emails envoyés aujourd’hui</span></div>
      <div><b>{n7}</b><span>sur 7 jours</span></div>
      <div><b>{nBooked}</b><span>ont réservé après un email</span></div>
      <div className={!cfg ? '' : cfg.auto_relance ? 'on' : 'off'}><b>{!cfg ? '…' : cfg.auto_relance ? 'Activées' : 'Coupées'}</b><span>relances automatiques par email</span></div>
    </div>}
    {rows === null && !lerr && <p className="muted">Chargement…</p>}
    <LoadErr msg={lerr} onRetry={load} />
    {rows && !list.length && <div className="sys">{{ todo: 'Rien à faire : les emails de relance partent tout seuls', sent: 'Personne relancée pour le moment', later: 'Personne n\'a donné de date de budget', part: 'Aucune saisie incomplète', cold: 'Personne ici', skip: 'Aucune personne écartée' }[tab]}</div>}
    {list.map(l => <div key={l.id} className={`call ${open === l.id ? 'open' : ''}`}>
      <div className="crow" onClick={() => setOpen(open === l.id ? null : l.id)}>
        <div className="cmain"><b>{l.first_name || 'Sans prénom'}</b>
          <small>{tab === 'later' && l.budget_date ? `Budget disponible le ${dayFr(l.budget_date)}` : l.followed_at ? `${CHAN[l.follow_channel] || 'Relancé'}${(l.mail_log || []).length > 1 ? ' ×' + l.mail_log.length : ''} ${ago(l.followed_at)}` : `${STEP[l.step]} · ${ago(l.updated_at)}`}</small></div>
        {badge(l)}
      </div>
      {open === l.id && <div className="cdet">
        {l.phone ? <div className="drow"><label>WhatsApp</label><a href={waWeb(l.phone)} target="_blank" rel="noreferrer">{l.phone}</a></div>
          : l.phone_raw ? <div className="drow"><label>Numéro tapé</label><span>{l.phone_raw} · incomplet</span></div> : null}
        {l.email ? <div className="drow"><label>Email</label><a href={`mailto:${l.email}`}>{l.email}</a></div>
          : l.email_raw ? <div className="drow"><label>Email tapé</label><span>{l.email_raw} · incomplet</span></div> : null}
        <div className="drow"><label>Situation</label><span>{l.situation || '—'}</span></div>
        <div className="drow"><label>Budget</label><span>{CAPL[l.capital] || '—'}{l.budget_confirmed === 'yes' ? ' · disponible maintenant' : l.budget_confirmed === 'soon' ? ' · pas avant quelques semaines' : l.budget_confirmed === 'no' ? ' · non disponible' : ''}</span></div>
        {l.budget_date && <div className="drow"><label>Date de budget</label><span><b>{dayFr(l.budget_date)}</b> · {diffDays(l.budget_date, today) >= 0 ? `dans ${diffDays(l.budget_date, today)} j` : `il y a ${-diffDays(l.budget_date, today)} j`}</span></div>}
        <div className="drow"><label>1ère visite</label><span>{new Date(l.created_at).toLocaleString('fr-FR', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
        {(l.mail_log || []).length > 0 && <div className="maillog">
          <div className="lq">Emails envoyés automatiquement</div>
          {l.mail_log.map((e, i) => <div key={i} className="mlrow"><b>{e.label || KIND[e.k] || 'Email'}</b><small>{dtm(e.at)}{e.subject ? ` · « ${e.subject} »` : ''}</small></div>)}
        </div>}
        <div className="drow"><label>Prochain email</label><span>{nextMail(l)}</span></div>
        {l.followed_at && <div className="drow"><label>Dernière relance</label><span>{CHAN[l.follow_channel] || '—'} · {ago(l.followed_at)}{l.follow_count > 1 ? ` · ${l.follow_count} relances` : ''}</span></div>}
        {l.follow === 'done' && !l.follow_result && l.followed_at && Date.now() - new Date(l.followed_at).getTime() > 2 * 864e5 && <div className="drow"><label></label><span style={{ color: '#92400E', fontWeight: 600 }}>Sans réponse depuis {Math.floor((Date.now() - new Date(l.followed_at).getTime()) / 864e5)} jours</span></div>}

        {l.budget_date && <div className="seqbox">
          <div className="lq">Séquence de messages</div>
          {seq.map(s => { const due = addDays(l.budget_date, s.offset_days); const isSent = (l.seq_sent || []).includes(s.pos); const isDue = !isSent && due <= today
            return <div key={s.pos} className={`seqrow ${isSent ? 'sent' : isDue ? 'due' : ''}`}>
              <div><b>{s.label}</b><small>{isSent ? 'Envoyé ✓' : isDue ? `À envoyer (prévu le ${dayFr(due)})` : `Le ${dayFr(due)}`}</small></div>
              {isDue && l.phone && <a className="btn sm" style={{ textDecoration: 'none' }} href={waWeb(l.phone, fill(s.body, l))} target="_blank" rel="noreferrer" onClick={(e) => { openWA(e, l.phone, fill(s.body, l)); sendSeq(l, s) }}>Envoyer</a>}
              {!isSent && <button className="btn ghost sm" onClick={() => sendSeq(l, s)}>Déjà fait</button>}
            </div> })}
        </div>}

        {l.follow === 'done' && <div className="resrow"><div className="lq">Résultat de la relance</div>
          <div className="chips2">{Object.entries(RESULT).map(([k, [lab]]) => <button key={k} className={`chip ${l.follow_result === k ? 'sel' : ''}`} onClick={() => upd(l, { follow_result: l.follow_result === k ? null : k })}>{lab}</button>)}</div></div>}

        <div className="acts">
          {l.phone && <a className="btn sm" style={{ textDecoration: 'none' }} href={waWeb(l.phone, msg(l))} target="_blank" rel="noreferrer" onClick={(e) => { openWA(e, l.phone, msg(l)); track(l, 'whatsapp') }}>{l.follow === 'done' ? 'Relancer à nouveau' : 'Relancer sur WhatsApp'}</a>}
          {l.phone && <a className="btn ghost sm" style={{ textDecoration: 'none' }} href={`tel:${l.phone.replace(/[^\d+]/g, '')}`} onClick={() => track(l, 'tel')}>Appeler</a>}
          {l.phone && <a className="btn ghost sm" style={{ textDecoration: 'none' }} href={`sms:${l.phone.replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(msg(l))}`} onClick={() => track(l, 'sms')}>SMS</a>}
          {l.follow === 'new' && <><button className="btn ghost sm" onClick={() => track(l, 'whatsapp')}>Marquer relancé</button><button className="btn ghost sm" onClick={() => upd(l, { follow: 'skip' })}>Écarter</button></>}
          {l.follow === 'done' && <button className="btn ghost sm" onClick={() => upd(l, { follow: 'skip' })}>Écarter</button>}
          {l.follow !== 'new' && <button className="btn ghost sm" onClick={() => upd(l, { follow: 'new', follow_result: null })}>Remettre à relancer</button>}
        </div>
        <textarea rows={2} defaultValue={l.note} placeholder="Note…" onBlur={e => e.target.value !== l.note && upd(l, { note: e.target.value })} />
      </div>}
    </div>)}

    <Messages toast={toast} seq={seq} rseq={rseq} tpl={tpl} cfg={cfg} reload={loadMsgs} />
  </div>
}

/** Messages modèles (relance WhatsApp, email automatique, séquence « plus tard »), modifiables. */
function Messages({ toast, seq, rseq, tpl, cfg, reload }) {
  const [wa, setWa] = useState(null); const [sub, setSub] = useState(null); const [mail, setMail] = useState(null); const [rows, setRows] = useState(null); const [rrows, setRrows] = useState(null); const [min, setMin] = useState(null)
  useEffect(() => { setWa(tpl.wa_relance ?? DEF_WA); setSub(tpl.mail_relance_sujet ?? ''); setMail(tpl.mail_relance ?? '') }, [tpl])
  useEffect(() => { setRows(seq.map(s => ({ ...s }))) }, [seq])
  useEffect(() => { setRrows(rseq.map(s => ({ ...s }))) }, [rseq])
  useEffect(() => { if (cfg) setMin(cfg.auto_relance_min) }, [cfg])
  const ok = async (p) => { const { error } = await p; if (error) { toast(friendlyError(error), true); return false } return true }
  const saveTpl = async (key, body) => { if (await ok(supabase.from('cand_templates').upsert({ key, body, updated_at: new Date().toISOString() }))) { toast('Enregistré'); reload() } }
  const setAuto = async (patch) => { if (await ok(supabase.from('cand_settings').update(patch).eq('id', 1))) { toast('Enregistré'); reload() } }
  const saveSeq = async (s) => { if (await ok(supabase.from('cand_seq').upsert({ pos: s.pos, label: s.label, offset_days: Number(s.offset_days) || 0, subject: s.subject || null, body: s.body }))) { toast('Enregistré'); reload() } }
  const delSeq = async (s) => { if (await ok(supabase.from('cand_seq').delete().eq('pos', s.pos))) reload() }
  const addSeq = async () => { const pos = Math.max(0, ...rows.map(r => r.pos)) + 1; if (await ok(supabase.from('cand_seq').insert({ pos, label: 'Nouveau message', offset_days: 7, body: "Salut {prenom}, c'est Clément. " }))) reload() }
  const chg = (pos, k, v) => setRows(rows.map(r => r.pos === pos ? { ...r, [k]: v } : r))
  const chgR = (id, k, v) => setRrows(rrows.map(r => r.id === id ? { ...r, [k]: v } : r))
  const saveR = async (r) => { if (await ok(supabase.from('cand_rseq').update({ label: r.label, after_hours: Math.max(1, Math.round((Number(r.days) || 1) * 24)), subject: r.subject, body: r.body, active: r.active }).eq('id', r.id))) { toast('Enregistré'); reload() } }
  const delR = async (r) => { if (window.confirm('Supprimer cet email de suivi ?') && await ok(supabase.from('cand_rseq').delete().eq('id', r.id))) reload() }
  const addR = async () => { const pos = Math.max(0, ...rrows.map(r => r.pos)) + 1; if (await ok(supabase.from('cand_rseq').insert({ pos, label: 'Nouvel email de suivi', after_hours: 24 * 10, subject: '{prenom}, un dernier mot', body: 'Salut {prenom},\n\nTu peux réserver ton appel ici : {lien}\n\nClément' }))) reload() }
  if (wa === null || rows === null || rrows === null) return null
  return <details className="settings msgs">
    <summary>Messages et relance automatique</summary>

    <div className="msgbox">
      <div className="lq">Relance automatique par email</div>
      <label className="tgl"><input type="checkbox" checked={Boolean(cfg?.auto_relance)} onChange={e => setAuto({ auto_relance: e.target.checked })} /> Relances automatiques par email (premier email quand quelqu'un s'arrête, puis les emails de suivi)</label>
      <div className="inl">Délai d'attente (minutes)<input type="number" min="2" max="1440" value={min ?? 5} onChange={e => setMin(e.target.value)} onBlur={() => Number(min) >= 2 && Number(min) !== cfg?.auto_relance_min && setAuto({ auto_relance_min: Number(min) })} /></div>
      <p className="muted s12">Il contient tes prochaines disponibilités, le lien pour réserver et un lien WhatsApp pour t'écrire. Variables : {'{prenom}'} {'{creneaux}'} {'{lien}'} {'{lien_wa}'}. C’est le premier email : il n’est envoyé qu’une seule fois par personne, et pas aux personnes sans budget.</p>
      <input className="ti" value={sub} onChange={e => setSub(e.target.value)} placeholder="Objet de l'email" />
      <textarea rows={9} value={mail} onChange={e => setMail(e.target.value)} />
      <button className="btn sm" onClick={async () => { await saveTpl('mail_relance_sujet', sub); await saveTpl('mail_relance', mail) }}>Enregistrer l'email</button>
    </div>

    <div className="msgbox">
      <div className="lq">Emails de suivi automatiques</div>
      <p className="muted s12">Envoyés tout seuls après le premier email, tant que la personne n’a pas réservé, répondu ou été écartée. Jamais la nuit (8 h – 21 h), et au moins 20 h entre deux emails. « Jour » = nombre de jours après le premier email. Variables : {'{prenom}'} {'{creneaux}'} {'{lien}'}</p>
      {rrows.map(r => { const d = r.days ?? Math.round(r.after_hours / 24 * 10) / 10; return <div key={r.id} className="seqedit">
        <div className="seqhead"><input className="ti" value={r.label} onChange={e => chgR(r.id, 'label', e.target.value)} />
          <label className="inl">Jour<input type="number" min="1" step="0.5" value={d} onChange={e => chgR(r.id, 'days', e.target.value)} /></label></div>
        <input className="ti" value={r.subject} onChange={e => chgR(r.id, 'subject', e.target.value)} placeholder="Objet de l'email" />
        <textarea rows={6} value={r.body} onChange={e => chgR(r.id, 'body', e.target.value)} />
        <label className="tgl"><input type="checkbox" checked={r.active} onChange={e => chgR(r.id, 'active', e.target.checked)} /> Actif</label>
        <div className="acts"><button className="btn sm" onClick={() => saveR({ ...r, days: d })}>Enregistrer</button><button className="btn ghost sm" onClick={() => delR(r)}>Supprimer</button></div>
      </div> })}
      <button className="btn ghost sm" onClick={addR}>+ Ajouter un email de suivi</button>
    </div>

    <div className="msgbox">
      <div className="lq">Message de relance WhatsApp</div>
      <p className="muted s12">Variables : {'{prenom}'} {'{lien}'}</p>
      <textarea rows={6} value={wa} onChange={e => setWa(e.target.value)} />
      <div className="wprev">{fill(wa, { first_name: 'Karim' })}</div>
      <button className="btn sm" onClick={() => saveTpl('wa_relance', wa)}>Enregistrer le message</button>
    </div>

    <div className="msgbox">
      <div className="lq">Séquence « Plus tard » (personnes qui n'ont pas encore le budget)</div>
      <p className="muted s12">Chaque message part par email, tout seul, par rapport à la date de budget donnée (sans email : il reste à envoyer à la main). « -7 » = 7 jours avant, « 0 » = le jour même, « 3 » = 3 jours après. Variables : {'{prenom}'} {'{date}'} {'{lien}'}</p>
      {rows.map(s => <div key={s.pos} className="seqedit">
        <div className="seqhead"><input className="ti" value={s.label} onChange={e => chg(s.pos, 'label', e.target.value)} />
          <label className="inl">Jour<input type="number" value={s.offset_days} onChange={e => chg(s.pos, 'offset_days', e.target.value)} /></label></div>
        <input className="ti" value={s.subject || ''} onChange={e => chg(s.pos, 'subject', e.target.value)} placeholder="Objet de l'email" />
        <textarea rows={4} value={s.body} onChange={e => chg(s.pos, 'body', e.target.value)} />
        <div className="acts"><button className="btn sm" onClick={() => saveSeq(s)}>Enregistrer</button><button className="btn ghost sm" onClick={() => delSeq(s)}>Supprimer</button></div>
      </div>)}
      <button className="btn ghost sm" onClick={addSeq}>+ Ajouter un message</button>
    </div>
  </details>
}
