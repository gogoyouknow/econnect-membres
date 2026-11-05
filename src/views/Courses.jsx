import { useEffect, useMemo, useRef, useState } from 'react'
import { makeTracker, attachHtml5, attachBunny, attachYouTube, attachVimeo } from '../lib/watch'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/data'
import { TIER_LABEL } from '../lib/ui'

/** Lecteur + mesure du visionnage réel (onTick) */
export function Player({ url, onTick, seen }) {
  const box = useRef(null)
  const u = (url || '').trim()
  const yt = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/)
  const vm = u.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  const bunny = u.match(/mediadelivery\.net\/(?:embed|play)\/(\d+)\/([\w-]+)/)
  const isFile = /\.(mp4|m3u8|webm)(\?|$)/i.test(u)
  useEffect(() => {
    if (!u || !box.current) return
    const tracker = makeTracker(onTick || (() => {}), seen || [])
    let off = () => {}
    const el = box.current
    if (isFile) off = attachHtml5(el.querySelector('video'), tracker)
    else if (bunny) attachBunny(el.querySelector('iframe'), tracker).then(f => { off = f })
    else if (vm) off = attachVimeo(el.querySelector('iframe'), tracker)
    else if (yt) attachYouTube(el.querySelector('.ytmount'), yt[1], tracker).then(f => { off = f })
    return () => off()
  }, [u])
  if (!u) return <div className="novideo">🎬 Vidéo bientôt disponible</div>
  if (isFile) return <div className="video" ref={box}><video src={u} controls playsInline controlsList="nodownload" onContextMenu={e => e.preventDefault()} /></div>
  if (yt) return <div className="video" ref={box}><div className="ytmount" /></div>
  const src = vm ? `https://player.vimeo.com/video/${vm[1]}?dnt=1` : bunny ? `https://iframe.mediadelivery.net/embed/${bunny[1]}/${bunny[2]}?autoplay=false&preload=true` : u
  return <div className="video" ref={box}><iframe src={src} allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen loading="lazy" title="Leçon" /></div>
}

export async function loadCourse() {
  const [m, s, l] = await Promise.all([
    supabase.from('modules').select('*').order('position'),
    supabase.from('course_sections').select('*').order('position'),
    supabase.from('lessons').select('*').order('position'),
  ])
  return { modules: m.data || [], sections: s.data || [], lessons: l.data || [] }
}

export default function Courses({ me, isStaff, toast, go, settings, scope }) {
  const inMethode = scope === 'methode'
  const [watch, setWatch] = useState({})       // lesson_id -> { watched_pct, done }
  const [live, setLive] = useState(null)        // visionnage de la leçon ouverte { pct }
  const lastSave = useRef(0)
  const [c, setC] = useState({ modules: [], sections: [], lessons: [] })
  const [done, setDone] = useState({})
  const [moduleId, setModuleId] = useState(null)
  const [lessonId, setLessonId] = useState(null)
  const [edit, setEdit] = useState(false)
  const reload = async () => { const d = await loadCourse(); setC(d); const { data } = await supabase.from('lesson_progress').select('lesson_id, done, watched_pct').eq('user_id', me.id); const map = {}, w = {}; (data || []).forEach(x => { if (x.done) map[x.lesson_id] = true; w[x.lesson_id] = x }); setDone(map); setWatch(w) }
  useEffect(() => { reload() }, [me.id])

  const mod = c.modules.find(m => m.id === moduleId)
  const secs = useMemo(() => c.sections.filter(s => s.module_id === moduleId), [c, moduleId])
  const lessonsOf = (sid) => c.lessons.filter(l => l.section_id === sid)
  const modLessons = useMemo(() => secs.flatMap(s => lessonsOf(s.id)), [c, secs])
  const lesson = c.lessons.find(l => l.id === lessonId)
  // espace Méthode : seuls les modules « Méthode » sont ouverts, les autres font partie de L'Accélérateur
  const outOfMethode = (m) => inMethode && !m.methode && !me.accel && !isStaff
  const locked = (m) => !isStaff && (outOfMethode(m) || m.tier_required > me.tier)
  const shown = c.modules.filter(m => (m.published || isStaff) && (!inMethode || m.methode || !me.accel || isStaff))
  const threshold = settings?.watch_threshold ?? 98
  // modules dans l'ordre : un module s'ouvre quand toutes les leçons du module précédent sont terminées
  const lessonsOfModule = (m) => c.sections.filter(s => s.module_id === m.id).flatMap(s => lessonsOf(s.id))
  const complete = (m) => lessonsOfModule(m).every(l => done[l.id])
  const blockedBy = (m) => {
    if (isStaff || !settings?.require_watch) return null
    const seq = shown.filter(x => x.published && !(outOfMethode(x) || x.tier_required > me.tier))
    const i = seq.findIndex(x => x.id === m.id)
    for (let k = 0; k < i; k++) if (!complete(seq[k])) return seq[k]
    return null
  }
  const gating = (m) => !!settings?.require_watch && m?.gate !== false && !isStaff
  const lessonLocked = (l) => { if (!mod || !gating(mod)) return false; const i = modLessons.findIndex(x => x.id === l.id); return i > 0 && !done[modLessons[i - 1].id] }
  const pctOf = (l) => Math.max(watch[l.id]?.watched_pct || 0, live?.id === l.id ? live.pct : 0)
  const canFinish = (l) => !gating(mod) || !l.video_url || pctOf(l) >= threshold
  async function onTick(l, t) {
    setLive({ id: l.id, pct: t.pct })
    const now = Date.now(); if (now - lastSave.current < 8000 && t.pct < threshold) return; lastSave.current = now
    const prev = watch[l.id]?.watched_pct || 0; if (t.pct <= prev && t.pct < threshold) return
    await supabase.from('lesson_progress').upsert({ user_id: me.id, lesson_id: l.id, watched_pct: Math.max(prev, t.pct), last_position: t.position, done: !!done[l.id], updated_at: new Date().toISOString() })
    setWatch(w => ({ ...w, [l.id]: { ...(w[l.id] || {}), watched_pct: Math.max(prev, t.pct) } }))
  }
  const pct = (m) => { const ls = c.sections.filter(s => s.module_id === m.id).flatMap(s => lessonsOf(s.id)); if (!ls.length) return 0; return Math.round(ls.filter(l => done[l.id]).length / ls.length * 100) }

  async function toggleDone(l) {
    if (!done[l.id] && !canFinish(l)) return toast(`Regarde la vidéo jusqu'au bout (${pctOf(l)} % visionné, il faut ${threshold} %)`, true)
    if (done[l.id]) { await supabase.from('lesson_progress').upsert({ user_id: me.id, lesson_id: l.id, done: false }) }
    else { await supabase.from('lesson_progress').upsert({ user_id: me.id, lesson_id: l.id, done: true, done_at: new Date().toISOString(), watched_pct: Math.max(watch[l.id]?.watched_pct || 0, pctOf(l)) }) }
    const next = { ...done, [l.id]: !done[l.id] }; setDone(next)
    if (!done[l.id]) { const i = modLessons.findIndex(x => x.id === l.id); const n = modLessons[i + 1]; if (n) { setLessonId(n.id); toast('Leçon terminée ✓ · suivante') } else toast('Module terminé 🎉 · le module suivant est ouvert') }
  }
  const save = async (table, id, patch) => { const { error } = await supabase.from(table).update(patch).eq('id', id); if (error) toast(friendlyError(error), true); else reload() }
  const add = async (table, row) => { const { error } = await supabase.from(table).insert(row); if (error) toast(friendlyError(error), true); else reload() }
  const del = async (table, id, label) => { if (!confirm(`Supprimer « ${label} » ?`)) return; const { error } = await supabase.from(table).delete().eq('id', id); if (error) toast(friendlyError(error), true); else { if (table === 'lessons' && lessonId === id) setLessonId(null); reload() } }

  if (mod && blockedBy(mod)) { setTimeout(() => setModuleId(null)); return null }

  // ---------- Leçon ouverte ----------
  if (lesson && mod) {
    const i = modLessons.findIndex(x => x.id === lesson.id), prev = modLessons[i - 1], next = modLessons[i + 1]
    const sec = c.sections.find(s => s.id === lesson.section_id)
    return <>
      <div className="head"><button className="ic" onClick={() => setLessonId(null)} aria-label="Retour">‹</button><div style={{ flex: 1, minWidth: 0 }}><h2 className="ell">{lesson.title}</h2><small>{mod.title} · {sec?.title}{lesson.duration ? ` · ${lesson.duration}` : ''}</small></div></div>
      <div className="body lessonbody">
        <Player key={lesson.id} url={lesson.video_url} onTick={t => onTick(lesson, t)} />
        {gating(mod) && lesson.video_url && !done[lesson.id] && <div className={`watchbar ${pctOf(lesson) >= threshold ? 'ok' : ''}`}><i style={{ width: Math.min(100, pctOf(lesson) / threshold * 100) + '%' }} /><span>{pctOf(lesson) >= threshold ? 'Vidéo visionnée ✓ tu peux passer à la suite' : `${pctOf(lesson)} % visionné · la suite se débloque à ${threshold} %`}</span></div>}
        {isStaff && edit && <div className="post"><b>Vidéo de cette leçon</b>
          <input defaultValue={lesson.video_url} placeholder="Colle le lien : Bunny (iframe.mediadelivery.net/embed/…), YouTube non répertorié, Vimeo ou .mp4" onBlur={e => e.target.value !== lesson.video_url && save('lessons', lesson.id, { video_url: e.target.value.trim() })} />
          <div className="grid2"><input defaultValue={lesson.title} onBlur={e => e.target.value !== lesson.title && save('lessons', lesson.id, { title: e.target.value })} /><input defaultValue={lesson.duration} placeholder="Durée (13:13)" onBlur={e => e.target.value !== lesson.duration && save('lessons', lesson.id, { duration: e.target.value })} /></div>
          <textarea defaultValue={lesson.body} rows={4} placeholder="Texte sous la vidéo : consignes, liens, outils à installer…" onBlur={e => e.target.value !== lesson.body && save('lessons', lesson.id, { body: e.target.value })} />
        </div>}
        {lesson.body && <div className="post lessontext">{lesson.body.split('\n').map((t, k) => <p key={k}>{linkify(t)}</p>)}</div>}
        {Array.isArray(lesson.resources) && lesson.resources.length > 0 && <div className="post"><b>Ressources</b>{lesson.resources.map((r, k) => <a key={k} className="res" href={r.url} target="_blank" rel="noreferrer">📎 {r.label}</a>)}</div>}
        <div className="lessonnav">
          <button className="btn ghost" disabled={!prev} onClick={() => setLessonId(prev.id)}>‹ Précédente</button>
          <button className={`btn ${done[lesson.id] ? 'ghost' : ''}`} disabled={!done[lesson.id] && !canFinish(lesson)} onClick={() => toggleDone(lesson)}>{done[lesson.id] ? 'Terminée ✓' : next ? 'Terminer et continuer →' : 'Terminer le module ✓'}</button>
          <button className="btn ghost" disabled={!next || lessonLocked(next)} onClick={() => setLessonId(next.id)}>{next && lessonLocked(next) ? '🔒 Suivante' : 'Suivante ›'}</button>
        </div>
      </div>
    </>
  }

  // ---------- Module ouvert ----------
  if (mod) {
    const total = modLessons.length, nb = modLessons.filter(l => done[l.id]).length
    const resume = modLessons.find(l => !done[l.id]) || modLessons[0]
    return <>
      <div className="head"><button className="ic" onClick={() => setModuleId(null)} aria-label="Retour">‹</button><div style={{ flex: 1, minWidth: 0 }}><h2 className="ell">{mod.title}</h2><small>{nb} / {total} leçons · {pct(mod)} %</small></div>{isStaff && <button className="btn ghost sm" onClick={() => setEdit(v => !v)}>{edit ? 'Fermer' : '✎ Modifier'}</button>}</div>
      <div className="body">
        {mod.description && <p className="muted" style={{ margin: '0 0 10px' }}>{mod.description}</p>}
        <div className="post prog"><div className="barp" style={{ marginTop: 0 }}><i style={{ width: pct(mod) + '%' }} /></div>{resume && <button className="btn" style={{ marginTop: 10 }} onClick={() => setLessonId(resume.id)}>{nb ? 'Reprendre : ' : 'Commencer : '}{resume.title}</button>}</div>
        {isStaff && edit && <div className="post"><b>Module</b><div className="grid2"><input defaultValue={mod.title} onBlur={e => e.target.value !== mod.title && save('modules', mod.id, { title: e.target.value })} /><select defaultValue={mod.tier_required} onChange={e => save('modules', mod.id, { tier_required: +e.target.value })}><option value={1}>Visible dès Démarrage</option><option value={2}>Réservé Accélération</option></select></div><textarea defaultValue={mod.description} rows={2} onBlur={e => e.target.value !== mod.description && save('modules', mod.id, { description: e.target.value })} /><div className="row"><label>Inclus dans la Méthode E-Connect<small>Ouvert aux élèves qui ont acheté la formation seule (97 €)</small></label><input type="checkbox" defaultChecked={!!mod.methode} onChange={e => save('modules', mod.id, { methode: e.target.checked })} /></div><div className="row"><label>Publié<small>Visible par les membres</small></label><input type="checkbox" defaultChecked={mod.published} onChange={e => save('modules', mod.id, { published: e.target.checked })} /></div><div className="row"><label>Visionnage obligatoire<small>Leçon suivante bloquée tant que la vidéo n'est pas vue à {threshold} % (réglage global dans Admin)</small></label><input type="checkbox" defaultChecked={mod.gate !== false} onChange={e => save('modules', mod.id, { gate: e.target.checked })} /></div></div>}
        {secs.map(s => <div key={s.id} className="section">
          <div className="sechead">{isStaff && edit ? <input defaultValue={s.title} onBlur={e => e.target.value !== s.title && save('course_sections', s.id, { title: e.target.value })} /> : <b>{s.title}</b>}<small>{lessonsOf(s.id).length} leçon{lessonsOf(s.id).length > 1 ? 's' : ''}</small>{isStaff && edit && <button className="btn ghost sm danger" onClick={() => del('course_sections', s.id, s.title)}>✕</button>}</div>
          {lessonsOf(s.id).map((l, k) => { const lk = lessonLocked(l); return <button key={l.id} className={`lesson ${done[l.id] ? 'done' : ''} ${resume?.id === l.id ? 'cur' : ''} ${lk ? 'lk' : ''}`} onClick={() => lk ? toast('Termine d\'abord la leçon précédente') : setLessonId(l.id)}>
            <span className="ck">{done[l.id] ? '✓' : lk ? '🔒' : k + 1}</span><Thumb className="th" srcs={[l.thumb_url, `/thumbs/l${l.id}.jpg`, thumbOf(l.video_url)]} /><span className="t">{l.title}{!l.video_url && isStaff && <small className="muted"> · sans vidéo</small>}</span><span className="d">{l.duration}</span>
            {isStaff && edit && <span className="x" onClick={e => { e.stopPropagation(); del('lessons', l.id, l.title) }}>✕</span>}
          </button> })}
          {isStaff && edit && <button className="btn ghost sm" onClick={() => add('lessons', { section_id: s.id, position: lessonsOf(s.id).length + 1, title: 'Nouvelle leçon' })}>+ Leçon</button>}
        </div>)}
        {isStaff && edit && <button className="btn ghost sm" onClick={() => add('course_sections', { module_id: mod.id, position: secs.length + 1, title: 'Nouvelle section' })}>+ Section</button>}
      </div>
    </>
  }

  // ---------- Liste des modules ----------
  return <>
    <div className="head"><div style={{ flex: 1 }}><h2>{inMethode ? 'La Méthode E-Connect' : 'Cours'}</h2><small>{shown.filter(m => m.published && !locked(m)).length} modules · avance dans l'ordre</small></div>{isStaff && <button className="btn ghost sm" onClick={() => setEdit(v => !v)}>{edit ? 'Fermer' : '✎ Modifier'}</button>}</div>
    <div className="body">
      <div className="cards modgrid">
        {shown.map(m => { const p = pct(m), bk = !locked(m) && blockedBy(m), lk = locked(m) || !!bk; const first = c.sections.filter(s => s.module_id === m.id).flatMap(s => lessonsOf(s.id))[0]; return <div key={m.id} className={`post mcard modcard ${lk ? 'locked' : ''} ${!m.published ? 'draft' : ''}`} onClick={() => bk ? toast(`Termine d'abord toutes les vidéos du ${bk.title.split(' · ')[0]}`) : !lk && setModuleId(m.id)}>
          <Thumb className="cover" srcs={[m.cover_url, `/thumbs/m${m.id}.jpg`, first && `/thumbs/l${first.id}.jpg`, first && thumbOf(first.video_url)]} extra={lk && <span>🔒</span>} />
          <div className="mem"><div className="num">{lk ? '🔒' : m.position}</div><div style={{ flex: 1, minWidth: 0 }}><b>{m.title}</b><small>{m.description}</small></div></div>
          <div className="meta">{lk ? <span>{bk ? `S'ouvre quand le ${bk.title.split(' · ')[0]} est terminé` : outOfMethode(m) ? 'Inclus dans L\'Accélérateur' : `Réservé ${TIER_LABEL[m.tier_required]}`}</span> : <><span>{c.sections.filter(s => s.module_id === m.id).flatMap(s => lessonsOf(s.id)).length} leçons</span><span>·</span><span>{p} %</span></>}{!m.published && <span className="pill">brouillon</span>}{isStaff && inMethode && !m.methode && <span className="pill">hors Méthode</span>}</div>
          {!lk && <div className="barp"><i style={{ width: p + '%' }} /></div>}
          {lk && outOfMethode(m) && <button className="btn sm" style={{ marginTop: 8 }} onClick={e => { e.stopPropagation(); go('offre') }}>Découvrir L'Accélérateur →</button>}
          {lk && !bk && !outOfMethode(m) && me.tier < 2 && me.accel && <button className="btn sm" style={{ marginTop: 8 }} onClick={e => { e.stopPropagation(); go('acceleration') }}>Passer à l'accompagnement personnalisé →</button>}
        </div> })}
      </div>
      {isStaff && edit && <button className="btn ghost sm" onClick={() => add('modules', { position: c.modules.length + 1, title: `Module ${c.modules.length + 1}`, published: false })}>+ Module</button>}
    </div>
  </>
}

const BUNNY_CDN = { 797634: 'vz-e6265c08-fa4.b-cdn.net' }
/** Vignette d'une leçon : Bunny (thumbnail.jpg), YouTube (hqdefault), sinon rien */
export function thumbOf(url) {
  if (!url) return ''
  let m = url.match(/mediadelivery\.net\/(?:embed|play)\/(\d+)\/([0-9a-f-]{36})/); if (m && BUNNY_CDN[m[1]]) return `https://${BUNNY_CDN[m[1]]}/${m[2]}/thumbnail_3.jpg`
  m = url.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/))([\w-]{11})/); if (m) return `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`
  return ''
}

/** Image avec repli : essaie chaque source dans l'ordre (vignette Circle importée, puis image Bunny) */
function Thumb({ srcs, className, extra }) {
  const list = srcs.filter(Boolean)
  const [i, setI] = useState(0)
  if (!list.length || i >= list.length) return className === 'th' ? <span className="th empty">▶</span> : null
  return <span className={className}><img src={list[i]} alt="" loading="lazy" onError={() => setI(i + 1)} />{extra}</span>
}

function linkify(t) {
  const parts = t.split(/(https?:\/\/[^\s]+)/g)
  return parts.map((p, i) => /^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer">{p}</a> : p)
}
