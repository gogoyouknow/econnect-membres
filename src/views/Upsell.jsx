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
    <div className="price"><b>200 €</b><span>aujourd'hui, puis 450 €/mois<br />(au lieu de 250 €/mois)</span></div>
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
