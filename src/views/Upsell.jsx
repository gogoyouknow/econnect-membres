import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/** Carte d'upgrade Démarrage → accompagnement personnalisé (450 €/mois, 200 € aujourd'hui) */
export function upgradeLink(settings, me) {
  const u = (settings?.upgrade_url || '').trim(); if (!u) return ''
  const sep = u.includes('?') ? '&' : '?'
  const name = [me.first_name, me.last_name].filter(Boolean).join(' ')
  return `${u}${sep}email=${encodeURIComponent(me.email)}${name ? `&name=${encodeURIComponent(name)}` : ''}`
}

export function UpsellCard({ settings, me, compact }) {
  const link = upgradeLink(settings, me)
  if (!link) return null
  return <div className="post upsell">
    <span className="pill gold">Étape suivante</span>
    <h3>Passe à l'accompagnement personnalisé</h3>
    {!compact && <>
      <p>Ton produit est validé ? C'est ici qu'on scale : suivi personnalisé de tes campagnes, lives privés et le groupe des membres qui vendent déjà.</p>
      <ul><li>Groupe Accélération + chat privé</li><li>Suivi perso de tes campagnes</li><li>Lives privés et retours directs</li></ul>
    </>}
    <div className="price"><b>200 €</b><span>aujourd'hui, puis 450 € par mois<br />sans engagement</span></div>
    <a className="btn" href={link} target="_blank" rel="noreferrer">Passer à l'accompagnement personnalisé →</a>
    <small className="muted">Paiement sécurisé Hotmart · ton abonnement actuel est remplacé, l'accès s'ouvre dès le paiement.</small>
  </div>
}

export default function Upsell({ settings, me }) {
  return <>
    <div className="head"><div style={{ flex: 1 }}><h2>Accélération</h2><small>Réservé aux membres de l'accompagnement personnalisé</small></div></div>
    <div className="body">
      <UpsellCard settings={settings} me={me} />
      {!upgradeLink(settings, me) && <div className="post"><b>Groupe Accélération</b><p className="muted">Réservé aux membres de l'accompagnement personnalisé. Parle-en à Clément dans le chat pour y passer.</p></div>}
      <div className="post lockbox">🔒 Le chat Accélération s'ouvre automatiquement dès ton passage.</div>
    </div>
  </>
}

/** Élève de la Méthode E-Connect : présentation de L'Accélérateur (accompagnement 160 €/mois, débité sur la carte enregistrée) */
const FN = `${import.meta.env.VITE_SUPABASE_URL || ''}/functions/v1/stripe-upgrade`
export async function callUpgrade(action) {
  const { data: { session } } = await supabase.auth.getSession()
  const r = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` }, body: JSON.stringify({ action }) })
  const j = await r.json().catch(() => ({ error: 'Réponse illisible' }))
  if (!r.ok && !j.needs_card) throw new Error(j.error || `Erreur ${r.status}`)
  return j
}

export function AccelOffer({ settings, me, reason, toast, refresh, go }) {
  const u = (settings?.accel_url || '').trim()
  const link = u ? `${u}${u.includes('?') ? '&' : '?'}prefilled_email=${encodeURIComponent(me.email)}` : ''
  const [st, setSt] = useState(null)        // { card } ou { error }
  const [step, setStep] = useState(0)       // 0 = offre, 1 = confirmation, 2 = en cours, 3 = fait
  useEffect(() => { callUpgrade('status').then(setSt).catch(e => setSt({ error: e.message })) }, [])
  const card = st?.card
  const charge = async () => {
    setStep(2)
    try {
      const j = await callUpgrade('charge')
      if (j.needs_card && j.url) { window.location.href = j.url; return }
      setStep(3); toast?.('Bienvenue dans L\'Accélérateur 🚀'); await refresh?.(); setTimeout(() => go?.('mchat'), 800)
    } catch (e) { setStep(0); toast?.(e.message, true) }
  }
  return <>
    <div className="head"><div style={{ flex: 1 }}><h2>{reason === 'chat' ? 'Chat' : "L'Accélérateur"}</h2><small>{reason === 'chat' ? 'Le chat est réservé aux membres de l\'accompagnement' : 'L\'accompagnement en groupe, avec Clément et les coachs'}</small></div></div>
    <div className="body">
      <div className="post upsell" style={{ maxWidth: 560 }}>
        <span className="pill gold">Quand tu veux aller plus vite</span>
        <h3>Tu n'es plus seul devant tes campagnes</h3>
        <p>La formation te donne la méthode. Dans L'Accélérateur, on regarde tes chiffres avec toi, on te dit quoi couper et quoi garder, et tu avances avec des gens qui font la même chose que toi.</p>
        <ul><li>Le groupe privé et le chat avec les coachs</li><li>3 lives par semaine, et les replays</li><li>Des retours sur tes campagnes au quotidien</li><li>Les modules avancés : structure gagnante et scaling</li></ul>
        <div className="price"><b>160 €</b><span>par mois<br />sans engagement</span></div>
        {st && !st.error ? <button className="btn" onClick={() => setStep(1)}>Oui, je passe à l'action →</button>
          : link ? <a className="btn" href={link} target="_blank" rel="noreferrer">Rejoindre L'Accélérateur →</a>
          : <p className="muted">Écris-nous à <b>contact@theambitiousman.fr</b> pour y entrer.</p>}
        <small className="muted">{card ? `Paiement sécurisé Stripe sur ta carte ${card.brand || ''} •••• ${card.last4} · l'accès s'ouvre immédiatement, ta formation reste à toi.` : 'Paiement sécurisé Stripe · l\'accès s\'ouvre dans l\'app dès le paiement, ta formation reste à toi.'}</small>
      </div>
    </div>
    {step > 0 && <div className="confirm-scrim" onClick={() => step !== 2 && setStep(0)}><div className="confirm" onClick={e => e.stopPropagation()}>
      {step === 3 ? <><h3>C'est fait 🚀</h3><p>Le groupe, les lives et le chat s'ouvrent.</p></> : <>
        <span className="pill gold">Dernière vérification</span>
        <h3>Tu confirmes ?</h3>
        <p><b>160 € maintenant</b>, puis 160 € chaque mois, sans engagement.<br />{card ? <>Débité sur ta carte <b>{card.brand || ''} •••• {card.last4}</b>.</> : 'Tu vas saisir ta carte sur la page de paiement sécurisée.'}</p>
        <button className="btn" disabled={step === 2} onClick={charge}>{step === 2 ? 'Paiement en cours…' : card ? `Confirmer · payer 160 €` : 'Continuer vers le paiement'}</button>
        <button className="btn ghost" disabled={step === 2} onClick={() => setStep(0)}>Annuler</button>
        <small className="muted">Tu peux arrêter quand tu veux depuis Mon profil.</small>
      </>}
    </div></div>}
  </>
}
