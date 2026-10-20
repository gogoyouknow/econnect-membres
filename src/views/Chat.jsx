import { useEffect, useRef, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { uploadPhoto, friendlyError } from '../lib/data'
import { Avatar, NameTag, fmtTime, fmtDay, Lightbox } from '../lib/ui'

const TITLES = { general: ['Chat général', 'Tous les membres'], demarrage: ['Groupe Démarrage', 'Modules 1 à 4'], acceleration: ['Groupe Accélération', 'Produit validé'] }
const PAGE = 80
const EMOJIS = ['👍', '🔥', '❤️', '👏', '😂', '🙏']

/** Texte avec les @mentions surlignées */
function Body({ text, names }) {
  if (!text) return null
  const re = /@([\p{L}\p{N}_'’\-]+(?: [\p{L}\p{N}_'’\-]+)?)/gu
  const parts = []; let last = 0; let m
  while ((m = re.exec(text))) {
    const full = m[1]; const first = full.split(' ')[0]
    const hit = names.find(n => n.toLowerCase() === full.toLowerCase()) ? full : names.find(n => n.split(' ')[0].toLowerCase() === first.toLowerCase()) ? first : null
    if (!hit) continue
    parts.push(text.slice(last, m.index)); parts.push(<span key={m.index} className="mention">@{hit}</span>)
    last = m.index + 1 + hit.length
  }
  parts.push(text.slice(last))
  return <p>{parts}</p>
}

export default function Chat({ space, me, profiles, settings, isStaff, toast }) {
  const [msgs, setMsgs] = useState([])
  const [reactions, setReactions] = useState({}) // message_id -> {emoji: {count, mine}}
  const [reads, setReads] = useState([])        // [{user_id,last_read_at}]
  const [text, setText] = useState('')
  const [pending, setPending] = useState(null)
  const [replyTo, setReplyTo] = useState(null)
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState({ t: '', bad: false })
  const [zoom, setZoom] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [sent, setSent] = useState([])
  const [mention, setMention] = useState(null) // {q, start}
  const bottom = useRef(null), fileRef = useRef(null), taRef = useRef(null)
  const [title, sub] = TITLES[space] || ['Chat', '']
  const names = useMemo(() => profiles.list.filter(p => p.active).map(p => p.name), [profiles])
  const byId = useMemo(() => Object.fromEntries(msgs.map(m => [m.id, m])), [msgs])

  async function loadReactions(ids) {
    if (!ids.length) return
    const { data } = await supabase.from('message_reactions').select('message_id,user_id,emoji').in('message_id', ids)
    const r = {}; (data || []).forEach(x => { r[x.message_id] = r[x.message_id] || {}; const e = r[x.message_id][x.emoji] = r[x.message_id][x.emoji] || { count: 0, mine: false }; e.count++; if (x.user_id === me.id) e.mine = true })
    setReactions(r)
  }
  const loadReads = () => supabase.from('space_reads').select('user_id,last_read_at').eq('space_id', space).then(({ data }) => setReads(data || []))
  const markRead = () => supabase.from('space_reads').upsert({ user_id: me.id, space_id: space, last_read_at: new Date().toISOString() }, { onConflict: 'user_id,space_id' }).then(() => {})

  useEffect(() => {
    let alive = true
    supabase.from('messages').select('*').eq('space_id', space).order('created_at', { ascending: false }).limit(PAGE)
      .then(({ data }) => { if (!alive) return; const l = (data || []).reverse(); setMsgs(l); loadReactions(l.map(m => m.id)); setTimeout(() => bottom.current?.scrollIntoView(), 50); markRead() })
    loadReads()
    const ch = supabase.channel('chat:' + space)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `space_id=eq.${space}` }, ({ new: m }) => {
        setMsgs(l => l.some(x => x.id === m.id) ? l : [...l, m]); setTimeout(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), 30); if (document.visibilityState === 'visible') markRead()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `space_id=eq.${space}` }, ({ new: m }) => setMsgs(l => l.map(x => x.id === m.id ? m : x)))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, () => setMsgs(l => { loadReactions(l.map(m => m.id)); return l }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'space_reads', filter: `space_id=eq.${space}` }, loadReads)
      .subscribe()
    const vis = () => document.visibilityState === 'visible' && markRead()
    document.addEventListener('visibilitychange', vis)
    return () => { alive = false; supabase.removeChannel(ch); document.removeEventListener('visibilitychange', vis) }
  }, [space])

  useEffect(() => {
    const tick = () => {
      if (me.role === 'member') {
        if (me.muted_until && new Date(me.muted_until) > new Date()) return setHint({ t: `Tu es en sourdine jusqu'à ${fmtTime(me.muted_until)}`, bad: true })
        if (!settings.chat_open) return setHint({ t: 'Chat fermé par un coach, seuls les coachs écrivent', bad: true })
        if (settings.live_only) return setHint({ t: 'Pendant le live, seuls les coachs écrivent', bad: true })
        if (settings.slow_mode > 0) {
          const now = Date.now(); const recent = sent.filter(t => now - t < 60000)
          if (recent.length >= settings.slow_mode) return setHint({ t: `Mode lent : ${settings.slow_mode} message${settings.slow_mode > 1 ? 's' : ''}/min · réessaie dans ${Math.ceil((60000 - (now - recent[0])) / 1000)} s`, bad: true })
          return setHint({ t: `Mode lent · il te reste ${settings.slow_mode - recent.length} message${settings.slow_mode - recent.length > 1 ? 's' : ''} cette minute`, bad: false })
        }
      }
      setHint({ t: '', bad: false })
    }
    tick(); const i = setInterval(tick, 1000); return () => clearInterval(i)
  }, [me, settings, sent])
  const blocked = hint.bad

  function pick(e) { const f = e.target.files?.[0]; e.target.value = ''; if (f) setPending({ file: f, url: URL.createObjectURL(f) }) }

  function onType(e) {
    const v = e.target.value; setText(v)
    e.target.style.height = 'auto'; e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px'
    const caret = e.target.selectionStart; const before = v.slice(0, caret); const at = before.lastIndexOf('@')
    if (at >= 0 && (at === 0 || /\s/.test(before[at - 1])) && !/\s{2,}/.test(before.slice(at))) setMention({ q: before.slice(at + 1).toLowerCase(), start: at }); else setMention(null)
  }
  function pickMention(p) {
    const caret = taRef.current.selectionStart
    const v = text.slice(0, mention.start) + '@' + p.name + ' ' + text.slice(caret)
    setText(v); setMention(null); setTimeout(() => { taRef.current.focus(); const pos = mention.start + p.name.length + 2; taRef.current.setSelectionRange(pos, pos) }, 0)
  }
  const mentionList = mention ? profiles.list.filter(p => p.active && p.id !== me.id && p.name.toLowerCase().includes(mention.q)).slice(0, 5) : []

  async function send() {
    const body = text.trim(); if ((!body && !pending) || blocked || busy) return
    setBusy(true)
    try {
      let image_url = null; if (pending) image_url = await uploadPhoto(pending.file, me.id)
      const { error } = await supabase.from('messages').insert({ space_id: space, user_id: me.id, body, image_url, reply_to: replyTo?.id || null })
      if (error) throw error
      setText(''); setPending(null); setReplyTo(null); setMention(null); setSent(s => [...s, Date.now()]); if (taRef.current) taRef.current.style.height = 'auto'
    } catch (err) { const m = friendlyError(err); setHint({ t: m, bad: true }); toast(m, true) } finally { setBusy(false) }
  }

  async function react(m, emoji) {
    const cur = reactions[m.id]?.[emoji]
    if (cur?.mine) await supabase.from('message_reactions').delete().match({ message_id: m.id, user_id: me.id, emoji })
    else await supabase.from('message_reactions').insert({ message_id: m.id, user_id: me.id, emoji })
    setOpenId(null)
  }
  async function act(m, a) {
    const u = profiles.map[m.user_id]
    if (a === 'del') { await supabase.from('messages').update({ deleted: true }).eq('id', m.id); toast('Message supprimé') }
    if (a === 'pin') { if (!m.pinned) await supabase.from('messages').update({ pinned: false }).eq('space_id', space).eq('pinned', true); await supabase.from('messages').update({ pinned: !m.pinned }).eq('id', m.id); toast(m.pinned ? 'Message désépinglé' : 'Message épinglé en haut du chat') }
    if (a === 'mute') { await supabase.from('profiles').update({ muted_until: new Date(Date.now() + 86400000).toISOString() }).eq('id', m.user_id); toast(`${u?.name} en sourdine pour 24 h`) }
    if (a === 'warn') { await supabase.from('notifications').insert({ user_id: m.user_id, title: "Avertissement d'un coach", body: 'Merci de respecter les règles du groupe.', url: '#' + space }); toast(`Avertissement envoyé à ${u?.name}`) }
    if (a === 'report') { await supabase.from('reports').insert({ reporter_id: me.id, target_user_id: m.user_id, message_id: m.id, reason: 'Signalé depuis le chat : ' + (m.body || '').slice(0, 80) }); toast('Signalé aux modérateurs') }
    if (a === 'reply') { setReplyTo(m); taRef.current?.focus() }
    setOpenId(null)
  }

  // glisser vers la droite = répondre
  const swipe = useRef({})
  const onTouchStart = (m) => (e) => { swipe.current = { id: m.id, x: e.touches[0].clientX, y: e.touches[0].clientY, el: e.currentTarget } }
  const onTouchMove = (e) => { const s = swipe.current; if (!s.el) return; const dx = e.touches[0].clientX - s.x, dy = e.touches[0].clientY - s.y; if (Math.abs(dy) > 30) { s.el.style.transform = ''; return } if (dx > 0) s.el.style.transform = `translateX(${Math.min(dx, 70)}px)` }
  const onTouchEnd = (m) => (e) => { const s = swipe.current; if (!s.el) return; const dx = (e.changedTouches[0].clientX - s.x); s.el.style.transition = 'transform .18s'; s.el.style.transform = ''; setTimeout(() => { if (s.el) s.el.style.transition = '' }, 200); if (dx > 60 && !m.deleted) { if (navigator.vibrate) navigator.vibrate(10); setReplyTo(m); taRef.current?.focus() } swipe.current = {} }

  const pinned = msgs.filter(m => m.pinned && !m.deleted).slice(-1)[0]
  const lastMine = [...msgs].reverse().find(m => m.user_id === me.id && !m.deleted)
  const seenCount = (m) => reads.filter(r => r.user_id !== me.id && new Date(r.last_read_at) >= new Date(m.created_at)).length

  let lastDay = ''
  return <>
    <div className="head"><div style={{ flex: 1, minWidth: 0 }}><h2>{title}</h2><small>{sub} · {profiles.list.filter(p => p.active).length} membres</small></div>
      <span className="pill">{settings.slow_mode ? `Mode lent ${settings.slow_mode}/min` : 'Mode normal'}</span></div>
    {pinned && <div className="pinbar" onClick={() => document.getElementById('m' + pinned.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>📌<div style={{ minWidth: 0 }}><b>Épinglé · {profiles.map[pinned.user_id]?.name}</b><span>{pinned.body || '📷 Photo'}</span></div>{isStaff && <button onClick={e => { e.stopPropagation(); act(pinned, 'pin') }} aria-label="Désépingler">✕</button>}</div>}
    <div className="body">
      {msgs.length === 0 && <div className="sys">Personne n'a encore écrit ici. Lance la conversation.</div>}
      {msgs.map(m => {
        const u = profiles.map[m.user_id]; const mine = m.user_id === me.id; const day = fmtDay(m.created_at)
        const sep = day !== lastDay; lastDay = day
        const parent = m.reply_to ? byId[m.reply_to] : null; const rx = reactions[m.id] || {}
        return <div key={m.id} style={{ display: 'contents' }}>
          {sep && <div className="day">{day}</div>}
          <div id={'m' + m.id} className={`msg ${mine ? 'me' : ''} ${!mine && u && u.role !== 'member' ? 'coach' : ''} ${openId === m.id ? 'open' : ''}`}
            onClick={() => setOpenId(openId === m.id ? null : m.id)} onTouchStart={onTouchStart(m)} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd(m)}>
            <Avatar p={u} />
            <div className="bub">
              <b><NameTag p={u} /></b>
              {parent && <div className="quote" onClick={e => { e.stopPropagation(); document.getElementById('m' + parent.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }}><b>{profiles.map[parent.user_id]?.name}</b>{parent.deleted ? 'Message supprimé' : (parent.body || '📷 Photo')}</div>}
              {m.deleted ? <p className="del">Message supprimé par un modérateur</p> : <>
                <Body text={m.body} names={names} />
                {m.image_url && <img src={m.image_url} alt={`Photo de ${u?.name || 'membre'}`} loading="lazy" onClick={e => { e.stopPropagation(); setZoom(m.image_url) }} />}
              </>}
              {Object.keys(rx).length > 0 && <div className="react" onClick={e => e.stopPropagation()}>{Object.entries(rx).map(([e, v]) => <button key={e} className={v.mine ? 'on' : ''} onClick={() => react(m, e)}>{e} {v.count}</button>)}</div>}
              <time>{fmtTime(m.created_at)}{m.pinned ? ' · 📌' : ''}{m.flagged && isStaff ? ' · ⚑' : ''}</time>
            </div>
            {!m.deleted && <div className="mtools" onClick={e => e.stopPropagation()}>
              {EMOJIS.map(e => <button key={e} className="em" onClick={() => react(m, e)}>{e}</button>)}
              <button title="Répondre" onClick={() => act(m, 'reply')}>↩</button>
              {isStaff && <button title={m.pinned ? 'Désépingler' : 'Épingler'} onClick={() => act(m, 'pin')}>📌</button>}
              {isStaff && !mine && <><button title="Avertir" onClick={() => act(m, 'warn')}>⚠️</button><button title="Sourdine 24 h" onClick={() => act(m, 'mute')}>🔇</button></>}
              {(isStaff || mine) && <button title="Supprimer" onClick={() => act(m, 'del')}>🗑️</button>}
              {!isStaff && !mine && <button title="Signaler" onClick={() => act(m, 'report')}>🚩</button>}
            </div>}
          </div>
          {mine && lastMine?.id === m.id && seenCount(m) > 0 && <div className="seen">Vu par {seenCount(m)}</div>}
        </div>
      })}
      <div ref={bottom} />
    </div>
    <div className="composer">
      <div className={`hint ${hint.bad ? 'bad' : ''}`}>{hint.t}</div>
      {replyTo && <div className="replying"><div style={{ minWidth: 0 }}><b>Réponse à {profiles.map[replyTo.user_id]?.name}</b><span>{replyTo.body || '📷 Photo'}</span></div><button aria-label="Annuler" onClick={() => setReplyTo(null)}>✕</button></div>}
      {pending && <div className="preview"><img src={pending.url} alt="" /><span>{pending.file.name}</span><button aria-label="Retirer la photo" onClick={() => setPending(null)}>✕</button></div>}
      {mentionList.length > 0 && <div className="mentions">{mentionList.map(p => <button key={p.id} onClick={() => pickMention(p)}><Avatar p={p} /><span>{p.name}</span><small>{p.role === 'member' ? '' : p.role === 'admin' ? 'Admin' : 'Coach'}</small></button>)}</div>}
      <div className="in">
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
        <button className="plus" aria-label="Envoyer une photo" title="Photo" onClick={() => fileRef.current.click()} disabled={blocked}>+</button>
        <div className={`pillbox ${text.trim() || pending ? 'has' : ''}`}>
          <textarea ref={taRef} rows={1} placeholder="Message" aria-label="Message" value={text} onChange={onType}
            onKeyDown={e => { if (e.key === 'Escape') { setReplyTo(null); setMention(null) } if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 900) { e.preventDefault(); if (mentionList.length && mention) pickMention(mentionList[0]); else send() } }} disabled={blocked} />
          <button className="sendbtn" aria-label="Envoyer" onClick={send} disabled={blocked || busy || (!text.trim() && !pending)}>
            {busy ? <span className="spin" /> : <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5" /><path d="M5 12l7-7 7 7" /></svg>}
          </button>
        </div>
      </div>
    </div>
    <Lightbox src={zoom} onClose={() => setZoom(null)} />
  </>
}
