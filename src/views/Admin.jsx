import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { saveSettings, friendlyError } from '../lib/data'
import { Avatar, ROLE_LABEL } from '../lib/ui'
import Rules from './Rules'

export default function Admin({ me, profiles, settings, toast }) {
  const [allowed, setAllowed] = useState([])
  const [stats, setStats] = useState({ week: 0, msgs: 0 })
  const [stripe, setStripe] = useState({ set: false, events: [] })
  const loadStripe = async () => {
    const [{ data: s }, { data: ev }] = await Promise.all([supabase.rpc('stripe_secret_set'), supabase.from('stripe_events').select('received_at,type,email,status').order('id', { ascending: false }).limit(6)])
    setStripe({ set: !!s, events: ev || [] })
  }
  useEffect(() => { loadStripe() }, [])
  const hookUrl = `${import.meta.env.VITE_SUPABASE_URL || ''}/functions/v1/stripe-webhook`
  async function saveSecret(e) {
    e.preventDefault(); const v = String(new FormData(e.target).get('whsec')).trim(); if (!v) return
    const { error } = await supabase.rpc('set_stripe_secret', { p_secret: v }); if (error) return toast(friendlyError(error), true)
    toast('Secret Stripe enregistré'); e.target.reset(); loadStripe()
  }
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
        <div className="kpi"><b>{members.filter(p => p.methode && p.active).length}</b><small>Méthode E-Connect</small></div>
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
      <div className="post"><b>Paiements Stripe · Méthode E-Connect</b>
        <div className="row col"><label>Adresse du webhook<small>À coller dans Stripe → Développeurs → Webhooks. Événements : checkout.session.completed, customer.subscription.deleted, charge.refunded, charge.dispute.created</small></label><input readOnly value={hookUrl} onFocus={e => e.target.select()} /></div>
        <form className="row" onSubmit={saveSecret}><label>Secret de signature<small>{stripe.set ? 'Enregistré ✓ (tu peux le remplacer)' : 'Commence par whsec_, affiché dans Stripe sur la page du webhook'}</small></label><div style={{ display: 'flex', gap: 6 }}><input name="whsec" type="password" placeholder="whsec_…" style={{ maxWidth: 180 }} /><button className="btn ghost sm">Enregistrer</button></div></form>
        <div className="row col"><label>Lien Stripe de l'accompagnement seul<small>160 €/mois, proposé aux élèves de la Méthode dans l'app. Vide = « écris-nous ».</small></label><input defaultValue={settings.accel_url} placeholder="https://buy.stripe.com/…" onBlur={e => e.target.value !== settings.accel_url && set({ accel_url: e.target.value.trim() })} /></div>
        {stripe.events.length > 0 && <div style={{ marginTop: 8 }}>{stripe.events.map((ev, i) => <div key={i} className="row"><label>{ev.email || '—'}<small>{new Date(ev.received_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {ev.type}</small></label><span className={`pill ${/granted/.test(ev.status) ? 'gold' : ''}`}>{ev.status}</span></div>)}</div>}
      </div>
      <div className="post"><b>Équipe</b>
        {profiles.list.filter(p => p.role !== 'member').map(p => <div key={p.id} className="mem"><Avatar p={p} /><div><b>{p.name}</b><small>{ROLE_LABEL[p.role]} · {p.email}</small></div></div>)}
        <form className="replybox" onSubmit={addStaff}><input name="email" type="email" placeholder="email du coach" required /><button className="btn ghost">Ajouter un modérateur</button></form>
      </div>
      <Rules settings={settings} toast={toast} />
      <div className="post"><b>Emails autorisés (pas encore inscrits)</b>
        {allowed.filter(a => !profiles.list.some(p => p.email === a.email)).map(a => <div key={a.email} className="row"><label>{a.email}<small>{a.role === 'mod' ? 'Modérateur' : !a.accel ? 'Méthode E-Connect' : a.tier === 2 ? 'Accélération' : 'Démarrage'}{a.methode && a.accel ? ' + Méthode' : ''} · {a.source}</small></label><button className="btn ghost sm" onClick={() => removeAllowed(a)}>Retirer</button></div>)}
        {allowed.filter(a => !profiles.list.some(p => p.email === a.email)).length === 0 && <div><small className="muted">Tout le monde a créé son accès</small></div>}
      </div>
      <div className="post"><b>Apparence</b>
        <div className="row"><label>Nom affiché</label><input defaultValue={settings.school_name} onBlur={e => e.target.value !== settings.school_name && set({ school_name: e.target.value })} style={{ maxWidth: 220 }} /></div>
        <div className="row col"><label>Message de bienvenue<small>Affiché aux nouveaux membres</small></label><textarea defaultValue={settings.welcome_message} rows={3} onBlur={e => e.target.value !== settings.welcome_message && set({ welcome_message: e.target.value })} /></div>
      </div>
      <div className="post"><b>Cours · visionnage obligatoire</b>
        <div className="row"><label>Avancer dans l'ordre<small>La leçon suivante reste bloquée tant que la vidéo n'est pas vue, et un module ne s'ouvre qu'une fois toutes les vidéos du module précédent terminées. Les admins et modérateurs ne sont jamais bloqués.</small></label><input type="checkbox" defaultChecked={settings.require_watch !== false} onChange={e => set({ require_watch: e.target.checked }, e.target.checked ? 'Visionnage obligatoire activé' : 'Visionnage obligatoire désactivé')} /></div>
        <div className="row"><label>Seuil<small>% de la vidéo à avoir réellement regardé</small></label><input type="number" min={50} max={100} defaultValue={settings.watch_threshold ?? 98} style={{ width: 80 }} onBlur={e => +e.target.value !== settings.watch_threshold && set({ watch_threshold: Math.min(100, Math.max(50, +e.target.value || 98)) })} /></div>
      </div>
      <div className="post"><b>Abonnement &amp; upgrade</b>
        <div className="row col"><label>Lien de paiement Hotmart de l'upgrade<small>Offre « accompagnement personnalisé » : 200 € aujourd'hui puis 450 €/mois. Vide = la carte d'upgrade est masquée.</small></label><input defaultValue={settings.upgrade_url} placeholder="https://pay.hotmart.com/…" onBlur={e => e.target.value !== settings.upgrade_url && set({ upgrade_url: e.target.value.trim() })} /></div>
        <div className="row"><label>Code de l'offre Hotmart<small>Pour reconnaître l'upgrade (ex. « k3x9ab »)</small></label><input defaultValue={settings.upgrade_offer_code} onBlur={e => e.target.value !== settings.upgrade_offer_code && set({ upgrade_offer_code: e.target.value.trim() })} style={{ maxWidth: 160 }} /></div>
        <div className="row"><label>Email de résiliation<small>Affiché aux membres dans Mon profil</small></label><input defaultValue={settings.cancel_email} onBlur={e => e.target.value !== settings.cancel_email && set({ cancel_email: e.target.value.trim() })} style={{ maxWidth: 260 }} /></div>
        <div className="row col"><label>Règle de résiliation<small>Texte affiché sous l'email</small></label><textarea defaultValue={settings.cancel_text} rows={3} onBlur={e => e.target.value !== settings.cancel_text && set({ cancel_text: e.target.value })} /></div>
      </div>
      <div className="post"><b>Données</b>
        <div className="row"><label>Exporter les membres (CSV)</label><button className="btn ghost sm" onClick={exportCsv}>Exporter</button></div>
        <div className="row"><label>Base de données<small>Supabase · Francfort</small></label><span className="pill gold">OK</span></div>
      </div>
    </div>
  </>
}
