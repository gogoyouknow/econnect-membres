import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/data'
import { Avatar, ROLE_LABEL, TIER_LABEL, ago } from '../lib/ui'

export default function Members({ me, profiles, isStaff, isAdmin, toast, refresh }) {
  const [q, setQ] = useState('')
  const list = profiles.list.filter(p => !q || p.name.toLowerCase().includes(q.toLowerCase()) || p.email.toLowerCase().includes(q.toLowerCase()))
  const online = p => p.last_seen && Date.now() - new Date(p.last_seen) < 10 * 60000

  async function setRole(p, role) { const { error } = await supabase.from('profiles').update({ role }).eq('id', p.id); if (error) return toast(friendlyError(error), true); toast(`${p.name} est maintenant ${ROLE_LABEL[role]}`) }
  async function setTier(p, tier) { const { error } = await supabase.from('profiles').update({ tier }).eq('id', p.id); if (error) return toast(friendlyError(error), true); toast(`${p.name} → ${TIER_LABEL[tier]}`); await supabase.from('notifications').insert({ user_id: p.id, title: tier === 2 ? 'Bienvenue dans le groupe Accélération 🚀' : 'Tu es dans le groupe Démarrage', body: tier === 2 ? 'Ton produit est validé. Le groupe Accélération est ouvert.' : '', url: '#acceleration' }) }
  async function setActive(p, active) { const { error } = await supabase.from('profiles').update({ active }).eq('id', p.id); if (error) return toast(friendlyError(error), true); toast(active ? `Accès de ${p.name} réactivé` : `Accès de ${p.name} coupé`) }
  async function unmute(p) { await supabase.from('profiles').update({ muted_until: null }).eq('id', p.id); toast('Sourdine levée') }
  async function invite(e) {
    e.preventDefault(); const f = new FormData(e.target); const email = String(f.get('email')).trim().toLowerCase(); if (!email) return
    const { error } = await supabase.from('allowed_emails').upsert({ email, tier: +f.get('tier'), role: 'member', source: 'manual' })
    if (error) return toast(friendlyError(error), true)
    toast(`${email} peut maintenant créer son accès`); e.target.reset()
  }

  return <>
    <div className="head"><div style={{ flex: 1 }}><h2>Membres</h2><small>{profiles.list.filter(p => p.active).length} membres · {profiles.list.filter(online).length} en ligne</small></div><input placeholder="Rechercher…" value={q} onChange={e => setQ(e.target.value)} className="search" /></div>
    <div className="body">
      {isAdmin && <form className="post" onSubmit={invite}><b>Ajouter un membre</b>
        <div className="replybox"><input name="email" type="email" placeholder="email@exemple.com" required /><select name="tier" defaultValue={1}><option value={1}>Démarrage (250 €)</option><option value={2}>Accélération (450 €)</option></select><button className="btn">Autoriser</button></div>
        <small className="muted">Le membre crée ensuite son mot de passe sur la page de connexion avec cet email. Plus tard, Hotmart fera ça tout seul à chaque paiement.</small></form>}
      <div className="cards">
        {list.map(p => { const muted = p.muted_until && new Date(p.muted_until) > new Date(); return <div key={p.id} className="post mcard" style={!p.active ? { opacity: .55 } : {}}>
          <div className="mem"><Avatar p={p} /><div style={{ minWidth: 0, flex: 1 }}><b>{p.name}{online(p) && <span className="dot" style={{ marginLeft: 6 }} />}</b><small>{isStaff ? p.email : ''}</small></div>
            {p.role === 'member' ? <span className={`pill ${p.tier === 2 ? 'gold' : ''}`}>{TIER_LABEL[p.tier]}</span> : <span className="pill gold">{ROLE_LABEL[p.role]}</span>}</div>
          <div className="meta"><span>{p.status || '—'}</span><span>·</span><span>{p.last_seen ? 'vu ' + ago(p.last_seen) : 'jamais connecté'}</span>{muted && <span>· 🔇 sourdine</span>}{!p.active && <span>· accès coupé</span>}</div>
          {isStaff && <div className="acts2">
            {isAdmin && p.id !== me.id && <select value={p.role} onChange={e => setRole(p, e.target.value)}><option value="member">Membre</option><option value="mod">Modérateur</option><option value="admin">Admin</option></select>}
            {p.role === 'member' && <button className="btn ghost sm" onClick={() => setTier(p, p.tier === 1 ? 2 : 1)}>{p.tier === 1 ? '→ Accélération' : '→ Démarrage'}</button>}
            {muted && <button className="btn ghost sm" onClick={() => unmute(p)}>Lever sourdine</button>}
            {isAdmin && p.id !== me.id && <button className={`btn sm ${p.active ? 'danger' : 'ghost'}`} onClick={() => setActive(p, !p.active)}>{p.active ? 'Couper' : 'Réactiver'}</button>}
          </div>}
        </div> })}
      </div>
    </div>
  </>
}
