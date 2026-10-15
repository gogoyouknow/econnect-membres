import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { uploadPhoto, friendlyError } from '../lib/data'
import { Avatar, NameTag, fmtTime, fmtDay, Lightbox } from '../lib/ui'

const TITLES = { general: ['Chat général', 'Tous les membres'], demarrage: ['Groupe Démarrage', 'Modules 1 à 4'], acceleration: ['Groupe Accélération', 'Produit validé'] }
const PAGE = 80

export default function Chat({ space, me, profiles, settings, isStaff, toast }) {
  const [msgs, setMsgs] = useState([])
  const [text, setText] = useState('')
  const [pending, setPending] = useState(null) // {file, url}
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState({ t: '', bad: false })
  const [zoom, setZoom] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [sent, setSent] = useState([])
  const bottom = useRef(null), fileRef = useRef(null), listRef = useRef(null)
  const [title, sub] = TITLES[space] || ['Chat', '']

  useEffect(() => {
    let alive = true
    supabase.from('messages').select('*').eq('space_id', space).order('created_at', { ascending: false }).limit(PAGE)
      .then(({ data }) => { if (alive) { setMsgs((data || []).reverse()); setTimeout(() => bottom.current?.scrollIntoView(), 50) } })
    const ch = supabase.channel('chat:' + space)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `space_id=eq.${space}` }, ({ new: m }) => {
        setMsgs(l => l.some(x => x.id === m.id) ? l : [...l, m]); setTimeout(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), 30)
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `space_id=eq.${space}` }, ({ new: m }) => setMsgs(l => l.map(x => x.id === m.id ? m : x)))
      .subscribe()
    return () => { alive = false; supabase.removeChannel(ch) }
  }, [space])

  // état du composer (mode lent, chat fermé…)
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

  async function pick(e) {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return
    setPending({ file: f, url: URL.createObjectURL(f) })
  }

  async function send() {
    const body = text.trim(); if ((!body && !pending) || blocked || busy) return
    setBusy(true)
    try {
      let image_url = null
      if (pending) image_url = await uploadPhoto(pending.file, me.id)
      const { error } = await supabase.from('messages').insert({ space_id: space, user_id: me.id, body, image_url })
      if (error) throw error
      setText(''); setPending(null); setSent(s => [...s, Date.now()])
    } catch (err) {
      const m = friendlyError(err); setHint({ t: m, bad: true }); toast(m, true)
    } finally { setBusy(false) }
  }

  async function act(m, a) {
    const u = profiles.map[m.user_id]
    if (a === 'del') { await supabase.from('messages').update({ deleted: true }).eq('id', m.id); toast('Message supprimé') }
    if (a === 'mute') { const until = new Date(Date.now() + 86400000).toISOString(); await supabase.from('profiles').update({ muted_until: until }).eq('id', m.user_id); toast(`${u?.name} en sourdine pour 24 h`) }
    if (a === 'warn') { await supabase.from('notifications').insert({ user_id: m.user_id, title: 'Avertissement d\'un coach', body: 'Merci de respecter les règles du groupe.', url: '#' + space }); toast(`Avertissement envoyé à ${u?.name}`) }
    if (a === 'report') { await supabase.from('reports').insert({ reporter_id: me.id, target_user_id: m.user_id, message_id: m.id, reason: 'Signalé depuis le chat : ' + (m.body || '').slice(0, 80) }); toast('Signalé aux modérateurs') }
    setOpenId(null)
  }

  let lastDay = ''
  return <>
    <div className="head"><div style={{ flex: 1, minWidth: 0 }}><h2>{title}</h2><small>{sub} · {profiles.list.filter(p => p.active).length} membres</small></div>
      <span className="pill">{settings.slow_mode ? `Mode lent ${settings.slow_mode}/min` : 'Mode normal'}</span></div>
    <div className="body" ref={listRef}>
      {msgs.length === 0 && <div className="sys">Personne n'a encore écrit ici. Lance la conversation.</div>}
      {msgs.map(m => {
        const u = profiles.map[m.user_id]; const mine = m.user_id === me.id; const day = fmtDay(m.created_at)
        const sep = day !== lastDay; lastDay = day
        return <div key={m.id} style={{ display: 'contents' }}>
          {sep && <div className="day">{day}</div>}
          <div className={`msg ${mine ? 'me' : ''} ${openId === m.id ? 'open' : ''}`} onClick={() => setOpenId(openId === m.id ? null : m.id)}>
            <Avatar p={u} />
            <div className="bub">
              <b><NameTag p={u} /></b>
              {m.deleted ? <p className="del">Message supprimé par un modérateur</p> : <>
                <p>{m.body}</p>
                {m.image_url && <img src={m.image_url} alt={`Photo de ${u?.name || 'membre'}`} loading="lazy" onClick={e => { e.stopPropagation(); setZoom(m.image_url) }} />}
              </>}
              <time>{fmtTime(m.created_at)}{m.flagged && isStaff ? ' · ⚑ surveillé' : ''}</time>
            </div>
            {!m.deleted && <div className="mtools" onClick={e => e.stopPropagation()}>
              {isStaff && !mine && <><button title="Avertir" onClick={() => act(m, 'warn')}>⚠️</button><button title="Sourdine 24 h" onClick={() => act(m, 'mute')}>🔇</button></>}
              {(isStaff || mine) && <button title="Supprimer" onClick={() => act(m, 'del')}>🗑️</button>}
              {!isStaff && !mine && <button title="Signaler" onClick={() => act(m, 'report')}>🚩</button>}
            </div>}
          </div>
        </div>
      })}
      <div ref={bottom} />
    </div>
    <div className="composer">
      <div className={`hint ${hint.bad ? 'bad' : ''}`}>{hint.t}</div>
      {pending && <div className="preview"><img src={pending.url} alt="" /><span>{pending.file.name}</span><button aria-label="Retirer la photo" onClick={() => setPending(null)}>✕</button></div>}
      <div className="in">
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
        <button className="ic" aria-label="Envoyer une photo" title="Photo" onClick={() => fileRef.current.click()} disabled={blocked}>📷</button>
        <textarea placeholder="Écris au groupe…" aria-label="Message" value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 900) { e.preventDefault(); send() } }} disabled={blocked} />
        <button className="btn" onClick={send} disabled={blocked || busy || (!text.trim() && !pending)}>{busy ? '…' : 'Envoyer'}</button>
      </div>
    </div>
    <Lightbox src={zoom} onClose={() => setZoom(null)} />
  </>
}
