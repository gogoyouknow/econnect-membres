import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { saveSettings, friendlyError } from '../lib/data'
import { Avatar, ROLE_LABEL } from '../lib/ui'
import Rules from './Rules'

export default function Admin({ me, profiles, settings, toast }) {
  const [allowed, setAllowed] = useState([])
  const [stats, setStats] = useState({ week: 0, msgs: 0 })
  const load = async () => {
    const { data } = await supabase.from('allowed_emails').select('*').order('created_at', { ascending: false }); setAllowed(data || [])
    const since = new Date(Date.now() - 7 * 86400000).toISOString()
    const [{ count: week }, { count: msgs }] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', since),
      supabase.from('messages').select('*', { count: 'exact', head: true }).gte('created_at', since)])
    setStats({ week: week || 0, msgs: msgs || 0 })
  }
  useEffect(() => { load() }, [])
  const members = profiles.list.filter(p => p.role === 'member')
  const active7 = profiles.list.filter(p => p.last_seen && Date.now() - new Date(p.last_seen) < 7 * 86400000).length
  const set = async (patch, msg) => { try { await saveSettings(patch); toast(msg || 'Enregistré') } catch (e) { toast(friendlyError(e), true) } }
  async function addStaff(e) {
    e.preventDefault(); const email = String(new FormData(e.target).get('email')).trim().toLowerCase(); if (!email) return
    const existing = profiles.list.find(p => p.email === email)
    if (existing) { await supabase.from('profiles').update({ role: 'mod' }).eq('id', existing.id); toast(`${existing.name} est maintenant modérateur`) }
    else { const { error } = await supabase.from('allowed_emails').upsert({ email, role: 'mod', tier: 2 }); if (error) return toast(friendlyError(error), true); toast(`${email} pourra créer son accès modérateur`); load() }
    e.target.reset()
  }
  async function removeAllowed(a) { await supabase.from('allowed_emails').delete().eq('email', a.email); load() }
  const exportCsv = async () => {
    const rows = [['nom', 'email', 'role', 'groupe', 'avancement', 'actif', 'inscrit'], ...profiles.list.map(p => [p.name, p.email, p.role, p.tier, p.status || '', p.active, p.created_at])]
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'membres.csv'; a.click()
  }
  return <>
    <div className="head"><div style={{ flex: 1 }}><h2>Administration</h2><small>Vue d'ensemble, accès, réglages de la school</small></div></div>
    <div className="body">
      <div className="kpis">
        <div className="kpi"><b>{profiles.list.filter(p => p.active).length}</b><small>Membres actifs</small></div>
        <div className="kpi"><b>{members.filter(p => p.tier === 1 && p.active).length}</b><small>Démarrage · 250 €</small></div>
        <div className="kpi"><b>{members.filter(p => p.tier === 2 && p.active).length}</b><small>Accélération · 450 €</small></div>
        <div className="kpi"><b>{stats.week}</b><small>Entrées (7 j)</small></div>
        <div className="kpi"><b>{profiles.list.filter(p => !p.active).length}</b><small>Accès coupés</small></div>
        <div className="kpi"><b>{profiles.list.length ? Math.round(100 * active7 / profiles.list.length) : 0} %</b><small>Actifs sur 7 jours</small></div>
        <div className="kpi"><b>{stats.msgs}</b><small>Messages (7 j)</small></div>
      </div>
      <div className="post"><b>Accès automatique</b>
        <div className="row"><label>Paiement Hotmart → accès créé<small>À brancher : le webhook ajoutera l'email à la liste autorisée</small></label><span className="pill">À brancher</span></div>
        <div className="row"><label>Abonnement arrêté → accès coupé<small>Délai de grâce avant coupure</small></label><select value={settings.grace_days} onChange={e => set({ grace_days: +e.target.value }, 'Délai enregistré')}><option value={0}>0 jour</option><option value={3}>3 jours</option><option value={7}>7 jours</option></select></div>
        <div className="row"><label>Produit validé → bascule Accélération<small>Manuelle, par un coach, depuis la page Membres</small></label><span className="pill">Manuel</span></div>
      </div>
      <div className="post"><b>Équipe</b>
        {profiles.list.filter(p => p.role !== 'member').map(p => <div key={p.id} className="mem"><Avatar p={p} /><div><b>{p.name}</b><small>{ROLE_LABEL[p.role]} · {p.email}</small></div></div>)}
        <form className="replybox" onSubmit={addStaff}><input name="email" type="email" placeholder="email du coach" required /><button className="btn ghost">Ajouter un modérateur</button></form>
      </div>
      <Rules settings={settings} toast={toast} />
      <div className="post"><b>Emails autorisés (pas encore inscrits)</b>
        {allowed.filter(a => !profiles.list.some(p => p.email === a.email)).map(a => <div key={a.email} className="row"><label>{a.email}<small>{a.role === 'mod' ? 'Modérateur' : a.tier === 2 ? 'Accélération' : 'Démarrage'} · {a.source}</small></label><button className="btn ghost sm" onClick={() => removeAllowed(a)}>Retirer</button></div>)}
        {allowed.filter(a => !profiles.list.some(p => p.email === a.email)).length === 0 && <div><small className="muted">Tout le monde a créé son accès</small></div>}
      </div>
      <div className="post"><b>Apparence</b>
        <div className="row"><label>Nom de la school</label><input defaultValue={settings.school_name} onBlur={e => e.target.value !== settings.school_name && set({ school_name: e.target.value })} style={{ maxWidth: 220 }} /></div>
        <div className="row col"><label>Message de bienvenue<small>Affiché aux nouveaux membres</small></label><textarea defaultValue={settings.welcome_message} rows={3} onBlur={e => e.target.value !== settings.welcome_message && set({ welcome_message: e.target.value })} /></div>
      </div>
      <div className="post"><b>Données</b>
        <div className="row"><label>Exporter les membres (CSV)</label><button className="btn ghost sm" onClick={exportCsv}>Exporter</button></div>
        <div className="row"><label>Base de données<small>Supabase · Francfort</small></label><span className="pill gold">OK</span></div>
      </div>
    </div>
  </>
}
