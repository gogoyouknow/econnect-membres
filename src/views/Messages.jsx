import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/data'
import { Avatar, Switch, ago, fmtTime } from '../lib/ui'

/** Messagerie individuelle élève ↔ équipe. Fermée par défaut : l'équipe l'ouvre élève par élève. */
export default function Messages({ me, profiles, isStaff, toast, refresh }) {
  const [sel, setSel] = useState(isStaff ? null : me.id)
  const [q, setQ] = useState('')
  const [f, setF] = useState('tous')
  const [last, setLast] = useState({})   // student_id -> dernier message
  const students = profiles.list.filter(p => p.role === 'member')
  const loadLast = async () => {
    if (!isStaff) return
    const { data } = await supabase.from('dm_messages').select('student_id, sender_id, body, created_at, read_at').order('created_at', { ascending: false }).limit(500)
    const m = {}; (data || []).forEach(x => { if (!m[x.student_id]) m[x.student_id] = { ...x, unread: 0 }; if (x.sender_id === x.student_id && !x.read_at) m[x.student_id].unread++ }); setLast(m)
  }
  useEffect(() => { loadLast() }, [])

  if (!isStaff) return <Thread me={me} studentId={me.id} profiles={profiles} isStaff={false} toast={toast} title="Messages avec Clément" />

  const kind = (p) => p.accel !== false && p.methode ? 'Méthode + Abonné' : p.accel !== false ? 'Abonné' : 'Méthode'
  const list = students
    .filter(p => f === 'tous' || (f === 'methode' ? p.accel === false : f === 'abonnes' ? p.accel !== false : f === 'nonlus' ? last[p.id]?.unread > 0 : !!last[p.id]))
    .filter(p => !q || (p.name + ' ' + p.email).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (last[b.id]?.created_at || (b.dm_enabled ? '1' : '0')).localeCompare(last[a.id]?.created_at || (a.dm_enabled ? '1' : '0')))
  const cur = profiles.map[sel]
  async function setDm(p, on) {
    const { error } = await supabase.from('profiles').update({ dm_enabled: on }).eq('id', p.id); if (error) return toast(friendlyError(error), true)
    toast(on ? `Messagerie ouverte pour ${p.name}` : `Messagerie fermée pour ${p.name}`); refresh()
  }
  return <div className={`dm ${sel ? 'has-sel' : ''}`}>
    <div className="dmlist">
      <div className="head"><div style={{ flex: 1 }}><h2>Élèves</h2><small>{students.length} clients · clique sur un élève pour lui écrire</small></div></div>
      <div style={{ padding: '10px 14px 0', display: 'flex', flexDirection: 'column', gap: 8 }}><input className="search" style={{ width: '100%' }} placeholder="Chercher un élève…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="chips" style={{ margin: 0 }}>{[['tous', `Tous · ${students.length}`], ['methode', `Méthode · ${students.filter(p => p.accel === false).length}`], ['abonnes', `Abonnés · ${students.filter(p => p.accel !== false).length}`], ['conv', 'Conversations'], ['nonlus', 'Non lus']].map(([k, l]) => <button key={k} className={`chip ${f === k ? 'on' : ''}`} onClick={() => setF(k)}>{l}</button>)}</div></div>
      <div className="dmitems">
        {list.map(p => { const l = last[p.id]; return <button key={p.id} className={`dmitem ${sel === p.id ? 'on' : ''}`} onClick={() => setSel(p.id)}>
          <Avatar p={p} /><span className="t"><b>{p.name}{!p.active && <em className="off">accès coupé</em>}</b><small>{l ? (l.sender_id === p.id ? '' : 'Toi : ') + l.body.slice(0, 50) : kind(p)}</small></span>
          <span className="r">{l && <small>{ago(l.created_at)}</small>}{l?.unread > 0 ? <em>{l.unread}</em> : <i className="kind">{kind(p).replace('Méthode + Abonné', 'M+A').replace('Abonné', 'Abo').replace('Méthode', 'Méth.')}</i>}</span>
        </button> })}
        {list.length === 0 && <div className="sys">Aucun élève</div>}
      </div>
    </div>
    <div className="dmthread">
      {cur ? <Thread key={cur.id} me={me} studentId={cur.id} profiles={profiles} isStaff toast={toast} onBack={() => { setSel(null); loadLast() }} onSent={() => { loadLast(); if (!cur.dm_enabled) setDm(cur, true) }}
        title={cur.name} sub={`${kind(cur)} · ${cur.email}`} hint={cur.dm_enabled ? '' : 'Ton premier message ouvre la conversation : l\'élève pourra te répondre.'} extra={<label className="dmtoggle"><span>{cur.dm_enabled ? 'Peut répondre' : 'Fermée'}</span><Switch on={!!cur.dm_enabled} label="Messagerie" onChange={v => setDm(cur, v)} /></label>} />
        : <div className="sys" style={{ margin: 'auto' }}>Choisis un élève à gauche</div>}
    </div>
  </div>
}

function Thread({ me, studentId, profiles, isStaff, toast, title, sub, hint, extra, onBack, onSent }) {
  const [msgs, setMsgs] = useState([])
  const [text, setText] = useState('')
  const end = useRef(null)
  const load = async () => {
    const { data } = await supabase.from('dm_messages').select('*').eq('student_id', studentId).order('created_at').limit(300)
    setMsgs(data || [])
    const unread = (data || []).filter(m => m.sender_id !== me.id && !m.read_at).map(m => m.id)
    if (unread.length) supabase.from('dm_messages').update({ read_at: new Date().toISOString() }).in('id', unread).then(() => {})
  }
  useEffect(() => {
    load()
    const ch = supabase.channel('dm:' + studentId).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages', filter: `student_id=eq.${studentId}` }, load).subscribe()
    return () => supabase.removeChannel(ch)
  }, [studentId])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs.length])
  async function send(e) {
    e.preventDefault(); const body = text.trim(); if (!body) return
    setText('')
    const { error } = await supabase.from('dm_messages').insert({ student_id: studentId, sender_id: me.id, body })
    if (error) { setText(body); return toast(friendlyError(error), true) }
    load(); onSent && onSent()
  }
  const days = useMemo(() => msgs.map((m, i) => i === 0 || new Date(m.created_at).toDateString() !== new Date(msgs[i - 1].created_at).toDateString()), [msgs])
  return <>
    <div className="head">{onBack && <button className="ic dmback" onClick={onBack} aria-label="Retour">‹</button>}<div style={{ flex: 1, minWidth: 0 }}><h2 className="ell">{title}</h2><small>{sub || (isStaff ? 'Conversation privée avec cet élève' : 'Conversation privée, seule l\'équipe la voit')}</small></div>{extra}</div>
    <div className="body dmbody">
      {msgs.length === 0 && <div className="sys">{isStaff ? (hint || 'Aucun message pour l\'instant.') : 'Écris ton premier message, Clément te répond ici.'}</div>}
      {msgs.map((m, i) => { const mine = m.sender_id === me.id, u = profiles.map[m.sender_id]; return <div key={m.id}>
        {days[i] && <div className="dmday">{new Date(m.created_at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>}
        <div className={`dmmsg ${mine ? 'mine' : ''}`}>{!mine && <Avatar p={u} />}<div className="bub">{m.body}<small>{fmtTime(m.created_at)}</small></div></div>
      </div> })}
      <div ref={end} />
    </div>
    <form className="composer dmcomposer" onSubmit={send}><input value={text} onChange={e => setText(e.target.value)} placeholder="Écris un message…" aria-label="Message" /><button className="btn" disabled={!text.trim()}>Envoyer</button></form>
  </>
}
