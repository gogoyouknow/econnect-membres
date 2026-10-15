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
    <div className="head"><div style={{ flex: 1 }}><h2>Membres</h2><small>{profiles.list.filter(p => p.active).length} membres · {profiles.list.filter(online).length} en ligne</small></div><input placeholder="Rechercher…" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 180, fontSize: 14 }} /></div>
    <div className="body">
      {isAdmin && <form className="post" onSubmit={invite}><b>Ajouter un membre</b>
        <div className="replybox"><input name="email" type="email" placeholder="email@exemple.com" required /><select name="tier" defaultValue={1}><option value={1}>Démarrage (250 €)</option><option value={2}>Accélération (450 €)</option></select><button className="btn">Autoriser</button></div>
        <small className="muted">Le membre crée ensuite son mot de passe sur la page de connexion avec cet email. Plus tard, Hotmart fera ça tout seul à chaque paiement.</small></form>}
      <div className="wrap"><table className="tbl"><thead><tr><th>Membre</th><th>Rôle</th><th>Groupe</th><th>Avancement</th><th>Vu</th>{isStaff && <th></th>}</tr></thead><tbody>
        {list.map(p => <tr key={p.id} style={!p.active ? { opacity: .5 } : {}}>
          <td><div className="mem"><Avatar p={p} /><div><b>{p.name}{online(p) && <span className="dot" style={{ marginLeft: 6 }} />}</b><small>{isStaff ? p.email : ''}{p.muted_until && new Date(p.muted_until) > new Date() ? ' · 🔇 sourdine' : ''}{!p.active ? ' · accès coupé' : ''}</small></div></div></td>
          <td>{isAdmin && p.id !== me.id ? <select value={p.role} onChange={e => setRole(p, e.target.value)}><option value="member">Membre</option><option value="mod">Modérateur</option><option value="admin">Admin</option></select> : ROLE_LABEL[p.role]}</td>
          <td>{p.role === 'member' ? <span className={`pill ${p.tier === 2 ? 'gold' : ''}`}>{TIER_LABEL[p.tier]}</span> : 'Équipe'}</td>
          <td>{p.id === me.id || isStaff ? <input defaultValue={p.status || ''} onBlur={e => e.target.value !== (p.status || '') && supabase.from('profiles').update({ status: e.target.value }).eq('id', p.id).then(() => toast('Avancement mis à jour'))} style={{ padding: '4px 8px', fontSize: 12, maxWidth: 150 }} /> : (p.status || '—')}</td>
          <td className="small muted">{p.last_seen ? ago(p.last_seen) : '—'}</td>
          {isStaff && <td style={{ whiteSpace: 'nowrap' }}>
            {p.role === 'member' && <button className="btn ghost sm" onClick={() => setTier(p, p.tier === 1 ? 2 : 1)}>{p.tier === 1 ? '→ Accélération' : '→ Démarrage'}</button>}{' '}
            {p.muted_until && new Date(p.muted_until) > new Date() && <button className="btn ghost sm" onClick={() => unmute(p)}>Lever sourdine</button>}{' '}
            {isAdmin && p.id !== me.id && <button className={`btn sm ${p.active ? 'danger' : ''}`} onClick={() => setActive(p, !p.active)}>{p.active ? 'Couper' : 'Réactiver'}</button>}
          </td>}
        </tr>)}
      </tbody></table></div>
    </div>
  </>
}
