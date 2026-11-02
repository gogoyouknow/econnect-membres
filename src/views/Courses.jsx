import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/data'
import { TIER_LABEL } from '../lib/ui'

/** Transforme un lien collé par l'admin en lecteur vidéo */
export function Player({ url }) {
  const u = (url || '').trim()
  if (!u) return <div className="novideo">🎬 Vidéo bientôt disponible</div>
  let src = ''
  const yt = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/)
  const vm = u.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  const bunny = u.match(/mediadelivery\.net\/(?:embed|play)\/(\d+)\/([\w-]+)/)
  if (yt) src = `https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0&modestbranding=1`
  else if (vm) src = `https://player.vimeo.com/video/${vm[1]}?dnt=1`
  else if (bunny) src = `https://iframe.mediadelivery.net/embed/${bunny[1]}/${bunny[2]}?autoplay=false&preload=true`
  else if (/\.(mp4|m3u8|webm)(\?|$)/i.test(u)) return <div className="video"><video src={u} controls playsInline controlsList="nodownload" onContextMenu={e => e.preventDefault()} /></div>
  else src = u
  return <div className="video"><iframe src={src} allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen loading="lazy" title="Leçon" /></div>
}

export async function loadCourse() {
  const [m, s, l] = await Promise.all([
    supabase.from('modules').select('*').order('position'),
    supabase.from('course_sections').select('*').order('position'),
    supabase.from('lessons').select('*').order('position'),
  ])
  return { modules: m.data || [], sections: s.data || [], lessons: l.data || [] }
}

export default function Courses({ me, isStaff, toast, go }) {
  const [c, setC] = useState({ modules: [], sections: [], lessons: [] })
  const [done, setDone] = useState({})
  const [moduleId, setModuleId] = useState(null)
  const [lessonId, setLessonId] = useState(null)
  const [edit, setEdit] = useState(false)
  const reload = async () => { const d = await loadCourse(); setC(d); const { data } = await supabase.from('lesson_progress').select('lesson_id').eq('user_id', me.id); const map = {}; (data || []).forEach(x => { map[x.lesson_id] = true }); setDone(map) }
  useEffect(() => { reload() }, [me.id])

  const mod = c.modules.find(m => m.id === moduleId)
  const secs = useMemo(() => c.sections.filter(s => s.module_id === moduleId), [c, moduleId])
  const lessonsOf = (sid) => c.lessons.filter(l => l.section_id === sid)
  const modLessons = useMemo(() => secs.flatMap(s => lessonsOf(s.id)), [c, secs])
  const lesson = c.lessons.find(l => l.id === lessonId)
  const locked = (m) => m.tier_required > me.tier && !isStaff
  const pct = (m) => { const ls = c.sections.filter(s => s.module_id === m.id).flatMap(s => lessonsOf(s.id)); if (!ls.length) return 0; return Math.round(ls.filter(l => done[l.id]).length / ls.length * 100) }

  async function toggleDone(l) {
    if (done[l.id]) { await supabase.from('lesson_progress').delete().match({ user_id: me.id, lesson_id: l.id }) }
    else { await supabase.from('lesson_progress').upsert({ user_id: me.id, lesson_id: l.id }) }
    const next = { ...done, [l.id]: !done[l.id] }; setDone(next)
    if (!done[l.id]) { const i = modLessons.findIndex(x => x.id === l.id); const n = modLessons[i + 1]; if (n) { setLessonId(n.id); toast('Leçon terminée ✓ · suivante') } else toast('Module terminé 🎉') }
  }
  const save = async (table, id, patch) => { const { error } = await supabase.from(table).update(patch).eq('id', id); if (error) toast(friendlyError(error), true); else reload() }
  const add = async (table, row) => { const { error } = await supabase.from(table).insert(row); if (error) toast(friendlyError(error), true); else reload() }
  const del = async (table, id, label) => { if (!confirm(`Supprimer « ${label} » ?`)) return; const { error } = await supabase.from(table).delete().eq('id', id); if (error) toast(friendlyError(error), true); else { if (table === 'lessons' && lessonId === id) setLessonId(null); reload() } }

  // ---------- Leçon ouverte ----------
  if (lesson && mod) {
    const i = modLessons.findIndex(x => x.id === lesson.id), prev = modLessons[i - 1], next = modLessons[i + 1]
    const sec = c.sections.find(s => s.id === lesson.section_id)
    return <>
      <div className="head"><button className="ic" onClick={() => setLessonId(null)} aria-label="Retour">‹</button><div style={{ flex: 1, minWidth: 0 }}><h2 className="ell">{lesson.title}</h2><small>{mod.title} · {sec?.title}{lesson.duration ? ` · ${lesson.duration}` : ''}</small></div></div>
      <div className="body lessonbody">
        <Player url={lesson.video_url} />
        {isStaff && edit && <div className="post"><b>Vidéo de cette leçon</b>
          <input defaultValue={lesson.video_url} placeholder="Colle le lien : Bunny (iframe.mediadelivery.net/embed/…), YouTube non répertorié, Vimeo ou .mp4" onBlur={e => e.target.value !== lesson.video_url && save('lessons', lesson.id, { video_url: e.target.value.trim() })} />
          <div className="grid2"><input defaultValue={lesson.title} onBlur={e => e.target.value !== lesson.title && save('lessons', lesson.id, { title: e.target.value })} /><input defaultValue={lesson.duration} placeholder="Durée (13:13)" onBlur={e => e.target.value !== lesson.duration && save('lessons', lesson.id, { duration: e.target.value })} /></div>
          <textarea defaultValue={lesson.body} rows={4} placeholder="Texte sous la vidéo : consignes, liens, outils à installer…" onBlur={e => e.target.value !== lesson.body && save('lessons', lesson.id, { body: e.target.value })} />
        </div>}
        {lesson.body && <div className="post lessontext">{lesson.body.split('\n').map((t, k) => <p key={k}>{linkify(t)}</p>)}</div>}
        {Array.isArray(lesson.resources) && lesson.resources.length > 0 && <div className="post"><b>Ressources</b>{lesson.resources.map((r, k) => <a key={k} className="res" href={r.url} target="_blank" rel="noreferrer">📎 {r.label}</a>)}</div>}
        <div className="lessonnav">
          <button className="btn ghost" disabled={!prev} onClick={() => setLessonId(prev.id)}>‹ Précédente</button>
          <button className={`btn ${done[lesson.id] ? 'ghost' : ''}`} onClick={() => toggleDone(lesson)}>{done[lesson.id] ? 'Terminée ✓' : next ? 'Terminer et continuer →' : 'Terminer le module ✓'}</button>
          <button className="btn ghost" disabled={!next} onClick={() => setLessonId(next.id)}>Suivante ›</button>
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
        {isStaff && edit && <div className="post"><b>Module</b><div className="grid2"><input defaultValue={mod.title} onBlur={e => e.target.value !== mod.title && save('modules', mod.id, { title: e.target.value })} /><select defaultValue={mod.tier_required} onChange={e => save('modules', mod.id, { tier_required: +e.target.value })}><option value={1}>Visible dès Démarrage</option><option value={2}>Réservé Accélération</option></select></div><textarea defaultValue={mod.description} rows={2} onBlur={e => e.target.value !== mod.description && save('modules', mod.id, { description: e.target.value })} /><div className="row"><label>Publié<small>Visible par les membres</small></label><input type="checkbox" defaultChecked={mod.published} onChange={e => save('modules', mod.id, { published: e.target.checked })} /></div></div>}
        {secs.map(s => <div key={s.id} className="section">
          <div className="sechead">{isStaff && edit ? <input defaultValue={s.title} onBlur={e => e.target.value !== s.title && save('course_sections', s.id, { title: e.target.value })} /> : <b>{s.title}</b>}<small>{lessonsOf(s.id).length} leçon{lessonsOf(s.id).length > 1 ? 's' : ''}</small>{isStaff && edit && <button className="btn ghost sm danger" onClick={() => del('course_sections', s.id, s.title)}>✕</button>}</div>
          {lessonsOf(s.id).map((l, k) => <button key={l.id} className={`lesson ${done[l.id] ? 'done' : ''} ${resume?.id === l.id ? 'cur' : ''}`} onClick={() => setLessonId(l.id)}>
            <span className="ck">{done[l.id] ? '✓' : k + 1}</span><span className="t">{l.title}{!l.video_url && isStaff && <small className="muted"> · sans vidéo</small>}</span><span className="d">{l.duration}</span>
            {isStaff && edit && <span className="x" onClick={e => { e.stopPropagation(); del('lessons', l.id, l.title) }}>✕</span>}
          </button>)}
          {isStaff && edit && <button className="btn ghost sm" onClick={() => add('lessons', { section_id: s.id, position: lessonsOf(s.id).length + 1, title: 'Nouvelle leçon' })}>+ Leçon</button>}
        </div>)}
        {isStaff && edit && <button className="btn ghost sm" onClick={() => add('course_sections', { module_id: mod.id, position: secs.length + 1, title: 'Nouvelle section' })}>+ Section</button>}
      </div>
    </>
  }

  // ---------- Liste des modules ----------
  return <>
    <div className="head"><div style={{ flex: 1 }}><h2>Cours</h2><small>{c.modules.filter(m => m.published).length} modules · avance dans l'ordre</small></div>{isStaff && <button className="btn ghost sm" onClick={() => setEdit(v => !v)}>{edit ? 'Fermer' : '✎ Modifier'}</button>}</div>
    <div className="body">
      <div className="cards">
        {c.modules.filter(m => m.published || isStaff).map(m => { const p = pct(m), lk = locked(m); return <div key={m.id} className={`post mcard modcard ${lk ? 'locked' : ''} ${!m.published ? 'draft' : ''}`} onClick={() => !lk && setModuleId(m.id)}>
          <div className="mem"><div className="num">{lk ? '🔒' : m.position}</div><div style={{ flex: 1, minWidth: 0 }}><b>{m.title}</b><small>{m.description}</small></div></div>
          <div className="meta">{lk ? <span>Réservé {TIER_LABEL[m.tier_required]}</span> : <><span>{c.sections.filter(s => s.module_id === m.id).flatMap(s => lessonsOf(s.id)).length} leçons</span><span>·</span><span>{p} %</span></>}{!m.published && <span className="pill">brouillon</span>}</div>
          {!lk && <div className="barp"><i style={{ width: p + '%' }} /></div>}
          {lk && me.tier < 2 && <button className="btn sm" style={{ marginTop: 8 }} onClick={e => { e.stopPropagation(); go('acceleration') }}>Passer à l'accompagnement personnalisé →</button>}
        </div> })}
      </div>
      {isStaff && edit && <button className="btn ghost sm" onClick={() => add('modules', { position: c.modules.length + 1, title: `Module ${c.modules.length + 1}`, published: false })}>+ Module</button>}
    </div>
  </>
}

function linkify(t) {
  const parts = t.split(/(https?:\/\/[^\s]+)/g)
  return parts.map((p, i) => /^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer">{p}</a> : p)
}
