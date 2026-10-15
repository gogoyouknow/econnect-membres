import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { uploadPhoto, friendlyError } from '../lib/data'
import { Avatar, NameTag, ago, Lightbox } from '../lib/ui'

export default function Feed({ space, me, profiles, settings, isStaff, toast }) {
  const [posts, setPosts] = useState([])
  const [likes, setLikes] = useState({})     // post_id -> {count, mine}
  const [replies, setReplies] = useState({}) // post_id -> []
  const [open, setOpen] = useState({})
  const [text, setText] = useState('')
  const [pending, setPending] = useState(null)
  const [busy, setBusy] = useState(false)
  const [zoom, setZoom] = useState(null)
  const fileRef = useRef(null)
  const isWins = space === 'wins'

  async function load() {
    const { data } = await supabase.from('posts').select('*').eq('space_id', space).order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(100)
    setPosts(data || [])
    const ids = (data || []).map(p => p.id); if (!ids.length) return
    const [{ data: l }, { data: r }] = await Promise.all([
      supabase.from('post_likes').select('post_id,user_id').in('post_id', ids),
      supabase.from('replies').select('*').in('post_id', ids).order('created_at')
    ])
    const lk = {}; (l || []).forEach(x => { lk[x.post_id] = lk[x.post_id] || { count: 0, mine: false }; lk[x.post_id].count++; if (x.user_id === me.id) lk[x.post_id].mine = true })
    const rp = {}; (r || []).forEach(x => { (rp[x.post_id] = rp[x.post_id] || []).push(x) })
    setLikes(lk); setReplies(rp)
  }
  useEffect(() => {
    load()
    const ch = supabase.channel('feed:' + space)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts', filter: `space_id=eq.${space}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'replies' }, load)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [space])

  async function publish() {
    const body = text.trim(); if (!body || busy) return
    setBusy(true)
    try {
      let image_url = null; if (pending) image_url = await uploadPhoto(pending.file, me.id)
      const { error } = await supabase.from('posts').insert({ space_id: space, user_id: me.id, body, image_url })
      if (error) throw error
      setText(''); setPending(null)
      if (settings.approve_posts && me.role === 'member') toast('Publié · en attente de validation par un modérateur')
    } catch (e) { toast(friendlyError(e), true) } finally { setBusy(false) }
  }
  async function like(p) {
    const cur = likes[p.id] || { count: 0, mine: false }
    setLikes({ ...likes, [p.id]: { count: cur.count + (cur.mine ? -1 : 1), mine: !cur.mine } })
    if (cur.mine) await supabase.from('post_likes').delete().match({ post_id: p.id, user_id: me.id })
    else await supabase.from('post_likes').insert({ post_id: p.id, user_id: me.id })
  }
  async function reply(p, body) {
    const { error } = await supabase.from('replies').insert({ post_id: p.id, user_id: me.id, body }); if (error) toast(friendlyError(error), true)
  }
  async function pin(p) { await supabase.from('posts').update({ pinned: !p.pinned }).eq('id', p.id); toast(p.pinned ? 'Post désépinglé' : 'Post épinglé') }
  async function approve(p) { await supabase.from('posts').update({ approved: true }).eq('id', p.id); toast('Post validé') }
  async function del(p) { await supabase.from('posts').delete().eq('id', p.id); toast('Post supprimé') }
  async function delReply(r) { await supabase.from('replies').delete().eq('id', r.id) }

  return <>
    <div className="head"><div style={{ flex: 1, minWidth: 0 }}><h2>{isWins ? 'Résultats' : 'Fil & questions'}</h2><small>{isWins ? 'Les avancées des membres : des actions, pas des chiffres' : 'Questions, partages, réponses des coachs'}</small></div></div>
    <div className="body">
      <div className="post newpost"><Avatar p={me} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea placeholder={isWins ? 'Partage une avancée (une action, une étape franchie)…' : 'Pose ta question ou partage une avancée…'} value={text} onChange={e => setText(e.target.value)} />
          {pending && <div className="preview"><img src={pending.url} alt="" /><span>{pending.file.name}</span><button onClick={() => setPending(null)}>✕</button></div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setPending({ file: f, url: URL.createObjectURL(f) }) }} />
            <button className="btn ghost" onClick={() => fileRef.current.click()}>📷 Photo</button>
            <button className="btn" onClick={publish} disabled={busy || !text.trim()}>{isWins ? 'Partager' : 'Publier'}</button>
          </div>
        </div>
      </div>
      {posts.length === 0 && <div className="sys">Rien pour l'instant. Sois le premier à publier.</div>}
      {posts.map(p => {
        const u = profiles.map[p.user_id]; const lk = likes[p.id] || { count: 0, mine: false }; const rs = replies[p.id] || []
        return <article key={p.id} className={`post ${p.pinned ? 'pin' : ''} ${!p.approved ? 'pending' : ''}`}>
          {p.pinned && <div className="pinlbl">📌 Épinglé</div>}
          {!p.approved && <div className="pinlbl" style={{ color: 'var(--warn)' }}>⏳ En attente de validation</div>}
          <div className="ph"><Avatar p={u} /><div className="who"><b><NameTag p={u} /></b><small>{ago(p.created_at)}</small></div>{isWins && <span className="pill gold">🏆</span>}</div>
          <div className="pb">{p.body}{p.image_url && <img src={p.image_url} alt="" loading="lazy" onClick={() => setZoom(p.image_url)} style={{ cursor: 'zoom-in' }} />}</div>
          <div className="acts">
            <button className={lk.mine ? 'liked' : ''} onClick={() => like(p)}>♥ <span>{lk.count}</span></button>
            <button onClick={() => setOpen({ ...open, [p.id]: !open[p.id] })}>💬 {rs.length}</button>
            {(isStaff || p.user_id === me.id) && <span className="mod-acts">
              {isStaff && !p.approved && <button onClick={() => approve(p)}>Valider</button>}
              {isStaff && <button onClick={() => pin(p)}>{p.pinned ? 'Désépingler' : 'Épingler'}</button>}
              <button onClick={() => del(p)}>Supprimer</button>
            </span>}
          </div>
          {open[p.id] && <div className="replies">
            {rs.map(r => { const ru = profiles.map[r.user_id]; return <div key={r.id} className="reply"><Avatar p={ru} /><div><b><NameTag p={ru} /></b><div>{r.body}</div></div>{(isStaff || r.user_id === me.id) && <button className="x" onClick={() => delReply(r)}>✕</button>}</div> })}
            <form className="replybox" onSubmit={e => { e.preventDefault(); const i = e.target.elements.r; const v = i.value.trim(); if (!v) return; reply(p, v); i.value = '' }}>
              <input name="r" placeholder="Répondre…" aria-label="Répondre" /><button className="btn">Envoyer</button>
            </form>
          </div>}
        </article>
      })}
    </div>
    <Lightbox src={zoom} onClose={() => setZoom(null)} />
  </>
}
