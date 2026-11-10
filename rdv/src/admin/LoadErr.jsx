/** Bandeau « impossible de charger » : évite de faire croire qu'il n'y a rien quand c'est le réseau ou le serveur qui a un souci. */
export default function LoadErr({ msg, onRetry }) {
  if (!msg) return null
  return <div className="sys lerr" role="alert"><b>Impossible de charger les données.</b> {String(msg).replace(/^TypeError: /, '').replace(/^Failed to fetch$/, 'Connexion indisponible')}<br /><button className="btn sm" onClick={onRetry}>Réessayer</button></div>
}
