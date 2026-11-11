import { useEffect, useMemo, useState } from 'react'
import { supabase, friendlyError } from './supabase'
import { usePS } from './persist'

const TZ = 'Europe/Paris'
const dayKey = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
const addDays = (k, n) => { const x = new Date(k + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const dayFr = (k) => new Date(k + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
const SEQ = { contact: 'A laissé son email ou son numéro', partial: 'A commencé à répondre', noshow: 'Rendez-vous manqué (no-show)', nurture: 'Séquence 30 jours (histoire)' }
const SEQ_ORDER = ['contact', 'partial', 'noshow', 'nurture']
const prev = (b) => String(b || '').replace(/\{prenom\}/g, 'Karim').replace(/\{video\}/g, '▶ [Bouton : Regarder la vidéo]').replace(/\{rdv\}/g, 'rdv.theambitiousman.fr')

/** « Emails automatiques » : tout ce qui part tout seul, avec ta validation jour par jour pendant la période de contrôle. */
export default function MailAuto({ toast }) {
  const [cfg, setCfg] = useState(null); const [steps, setSteps] = useState(null); const [outs, setOuts] = useState([]); const [oks, setOks] = useState([]); const [stats, setStats] = useState([]); const [enr, setEnr] = useState([])
  const [open, setOpen] = usePS('ma_open', false); const [edit, setEdit] = useState(null); const [day, setDay] = usePS('ma_day', 'demain'); const [seeAll, setSeeAll] = usePS('ma_all', false)
  const today = dayKey(new Date()); const tomorrow = addDays(today, 1)
  const load = async () => {
    const [a, b, c, d, e, f] = await Promise.all([
      supabase.from('mail_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('mail_steps').select('*').order('seq').order('pos'),
      supabase.from('mail_out').select('id,step_id,due_at,variant').eq('status', 'attente').limit(2000),
      supabase.from('mail_ok').select('step_id,day').gte('day', today),
      supabase.from('mail_stats_v').select('*'),
      supabase.from('mail_enroll').select('seq,status').limit(5000),
    ])
    if (a.error || b.error) return toast(friendlyError(a.error || b.error), true)
    setCfg(a.data); setSteps(b.data || []); setOuts(c.data || []); setOks(d.data || []); setStats(e.data || []); setEnr(f.data || [])
  }
  useEffect(() => { load(); const i = setInterval(load, 60000); return () => clearInterval(i) }, [])
  const target = day === 'demain' ? tomorrow : today
  const isOk = (sid, k) => oks.some((o) => o.step_id === sid && o.day === k)
  const groups = useMemo(() => {
    const m = {}
    for (const o of outs) { const k = dayKey(new Date(o.due_at)); (m[k] = m[k] || {}); m[k][o.step_id] = (m[k][o.step_id] || 0) + 1 }
    return m
  }, [outs])
  const pendingFor = (k) => (steps || []).filter((s) => groups[k]?.[s.id])
  const toValidate = (k) => pendingFor(k).filter((s) => !isOk(s.id, k))
  const nToday = toValidate(today).length, nTomorrow = toValidate(tomorrow).length

  const run = async (p, msg) => { const { error } = await p; if (error) { toast(friendlyError(error), true); return false } if (msg) toast(msg); load(); return true }
  const validate = (sid, k) => run(supabase.from('mail_ok').upsert({ step_id: sid, day: k }), 'Validé')
  const unvalidate = (sid, k) => run(supabase.from('mail_ok').delete().eq('step_id', sid).eq('day', k), 'Validation retirée')
  const validateAll = (k) => run(supabase.from('mail_ok').upsert(toValidate(k).map((s) => ({ step_id: s.id, day: k }))), 'Tout est validé')
  const setMode = (mode) => run(supabase.from('mail_settings').update({ mode }).eq('id', 1), mode === 'pause' ? 'Envois en pause' : mode === 'auto' ? 'Mode automatique activé' : 'Validation réactivée')
  const save = async (s) => { if (await run(supabase.from('mail_steps').update({ label: s.label, subject_a: s.subject_a, subject_b: s.subject_b || '', body: s.body, video_id: s.video_id || null, video_title: s.video_title || null, delay_h: Number(s.delay_h) || 0, at_hour: s.at_hour === '' || s.at_hour == null ? null : Number(s.at_hour), active: s.active }).eq('id', s.id), 'Enregistré')) setEdit(null) }
  const stat = (sid, v) => stats.find((x) => x.step_id === sid && x.variant === v) || { sent: 0, clicked: 0 }
  if (!cfg || !steps) return null

  const end = new Date(cfg.control_until); const launch = new Date(cfg.launch_at)
  const dayN = Math.min(30, Math.max(1, Math.floor((Date.now() - launch.getTime()) / 864e5) + 1)); const finished = Date.now() >= end.getTime()
  const count = (seq, st) => enr.filter((e) => e.seq === seq && e.status === st).length
  const Card = ({ s, k }) => { const n = groups[k]?.[s.id] || 0; const ok = isOk(s.id, k)
    return <div className={`ma-card ${ok ? 'ok' : ''}`}>
      <div className="ma-top"><b>{s.label}</b><span className="muted s12">{n ? `${n} personne${n > 1 ? 's' : ''}` : 'personne pour l’instant'}</span></div>
      <div className="ma-sub"><span className="ma-tag">A</span>{s.subject_a.replace(/\{prenom\}/g, 'Karim')}</div>
      {s.subject_b && <div className="ma-sub"><span className="ma-tag b">B</span>{s.subject_b.replace(/\{prenom\}/g, 'Karim')}</div>}
      <details><summary className="muted s12">Lire l’email</summary><div className="ma-body">{prev(s.body)}</div></details>
      <div className="acts">{ok ? <button className="btn ghost sm" onClick={() => unvalidate(s.id, k)}>✓ Validé · retirer</button> : <button className="btn sm" onClick={() => validate(s.id, k)}>Valider pour {k === today ? 'aujourd’hui' : 'demain'}</button>}
        <button className="btn ghost sm" onClick={() => setEdit({ ...s })}>Modifier</button></div>
    </div> }

  return <details className="settings msgs ma" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
    <summary>Emails automatiques{(nToday + nTomorrow) > 0 && <span className="ma-badge">{nToday + nTomorrow} à valider</span>}</summary>

    <div className="msgbox">
      {cfg.mode === 'auto' ? <p><b>Mode automatique.</b> Les emails partent tout seuls.</p>
        : cfg.mode === 'pause' ? <p><b>En pause.</b> Aucun email ne part.</p>
        : <p><b>Période de validation : jour {dayN} sur 30.</b> Rien ne part sans ton accord. {finished ? 'Les 30 jours sont terminés, tu peux passer en automatique.' : `Fin le ${dayFr(dayKey(end))}.`}</p>}
      <div className="acts">
        {cfg.mode !== 'pause' && <button className="btn ghost sm" onClick={() => setMode('pause')}>Mettre en pause</button>}
        {cfg.mode === 'pause' && <button className="btn sm" onClick={() => setMode('validation')}>Reprendre (avec validation)</button>}
        {cfg.mode === 'validation' && <button className="btn ghost sm" disabled={!finished} onClick={() => window.confirm('Passer en automatique ? Les emails partiront ensuite sans ton accord.') && setMode('auto')}>Passer en automatique{finished ? '' : ' (après 30 jours)'}</button>}
        {cfg.mode === 'auto' && <button className="btn ghost sm" onClick={() => setMode('validation')}>Revenir à la validation</button>}
      </div>
      <p className="muted s12">Le système te prévient 3 fois la veille (10 h, 15 h, 19 h) et 3 fois le jour même (9 h, 13 h, 16 h) tant que tu n’as pas validé. Pas de validation = pas d’envoi.</p>
    </div>

    <div className="msgbox">
      <div className="lq">À valider</div>
      <div className="acts"><button className={`btn sm ${day === 'demain' ? '' : 'ghost'}`} onClick={() => setDay('demain')}>Demain{nTomorrow ? ` (${nTomorrow})` : ''}</button><button className={`btn sm ${day === 'jour' ? '' : 'ghost'}`} onClick={() => setDay('jour')}>Aujourd’hui{nToday ? ` (${nToday})` : ''}</button></div>
      <p className="muted s12">{dayFr(target)}</p>
      {pendingFor(target).length === 0 && <p className="muted">Aucun email prévu ce jour-là pour l’instant.</p>}
      {pendingFor(target).map((s) => <Card key={s.id} s={s} k={target} />)}
      {toValidate(target).length > 1 && <button className="btn sm" onClick={() => validateAll(target)}>Tout valider ({toValidate(target).length})</button>}
    </div>

    <div className="msgbox">
      <div className="lq">Où en sont les personnes</div>
      <div className="ma-grid">{SEQ_ORDER.map((q) => <div key={q} className="ma-stat"><b>{count(q, 'actif')}</b><span>{SEQ[q]}</span><em>{count(q, 'fini')} terminés · {count(q, 'stop')} arrêtés</em></div>)}</div>
    </div>

    <div className="msgbox">
      <div className="lq">Tous les emails ({steps.length})</div>
      <button className="btn ghost sm" onClick={() => setSeeAll(!seeAll)}>{seeAll ? 'Masquer la liste' : 'Afficher la liste et modifier'}</button>
      {seeAll && SEQ_ORDER.map((q) => <div key={q} className="ma-seq"><h4>{SEQ[q]}</h4>
        {steps.filter((s) => s.seq === q).map((s) => { const a = stat(s.id, 'A'), b = stat(s.id, 'B'); return <div key={s.id} className={`ma-row ${s.active ? '' : 'off'}`}>
          <div className="ma-top"><b>{s.label}</b><button className="btn ghost sm" onClick={() => setEdit({ ...s })}>Modifier</button></div>
          <div className="ma-sub"><span className="ma-tag">A</span>{s.subject_a}</div>{s.subject_b && <div className="ma-sub"><span className="ma-tag b">B</span>{s.subject_b}</div>}
          <p className="muted s12">{s.video_title ? `Vidéo : ${s.video_title} · ` : ''}{s.at_hour != null ? `à ${s.at_hour} h` : 'dès que possible'} · {s.delay_h >= 24 ? `${Math.round(s.delay_h / 24)} j après le précédent` : `${s.delay_h} h après`}
            {(a.sent + b.sent) > 0 && ` · A : ${a.sent} envoi${a.sent > 1 ? 's' : ''}, ${a.clicked} clic${a.clicked > 1 ? 's' : ''}${s.subject_b ? ` · B : ${b.sent}, ${b.clicked}` : ''}`}{s.winner ? ` · objet ${s.winner} retenu` : ''}</p>
          {!s.active && <p className="muted s12">Désactivé</p>}
        </div> })}</div>)}
    </div>

    {edit && <div className="ma-modal" onClick={() => setEdit(null)}><div className="ma-sheet" onClick={(e) => e.stopPropagation()}>
      <div className="lq">{SEQ[edit.seq]}</div>
      <input className="ti" value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} aria-label="Nom" />
      <label className="muted s12">Objet A</label><input className="ti" value={edit.subject_a} onChange={(e) => setEdit({ ...edit, subject_a: e.target.value })} />
      <label className="muted s12">Objet B (laisse vide pour ne pas tester)</label><input className="ti" value={edit.subject_b || ''} onChange={(e) => setEdit({ ...edit, subject_b: e.target.value })} />
      <label className="muted s12">Texte. Variables : {'{prenom}'} {'{video}'} (bouton vers la vidéo) {'{rdv}'} (lien pour réserver)</label>
      <textarea rows={14} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
      <label className="muted s12">Vidéo YouTube (identifiant) et titre</label>
      <input className="ti" value={edit.video_id || ''} onChange={(e) => setEdit({ ...edit, video_id: e.target.value })} placeholder="ex. F5u08WW4I5A" /><input className="ti" value={edit.video_title || ''} onChange={(e) => setEdit({ ...edit, video_title: e.target.value })} placeholder="Titre de la vidéo" />
      <div className="inl">Délai (heures après l’email précédent)<input type="number" min="0" value={edit.delay_h} onChange={(e) => setEdit({ ...edit, delay_h: e.target.value })} /></div>
      <div className="inl">Heure d’envoi (vide = dès que possible)<input type="number" min="9" max="20" value={edit.at_hour ?? ''} onChange={(e) => setEdit({ ...edit, at_hour: e.target.value })} /></div>
      <label className="tgl"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Actif</label>
      <div className="acts"><button className="btn sm" onClick={() => save(edit)}>Enregistrer</button><button className="btn ghost sm" onClick={() => setEdit(null)}>Annuler</button></div>
      <p className="muted s12">Si tu modifies un email déjà validé, il faut le valider de nouveau.</p>
    </div></div>}
  </details>
}
