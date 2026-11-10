import { Component } from 'react'

// Si un écran plante (réseau coupé au mauvais moment, ancienne version en mémoire…), on ne laisse pas une page blanche :
// on recharge une fois automatiquement (Calio retrouve l'onglet où tu étais), sinon on propose le bouton.
export default class Boundary extends Component {
  state = { err: null }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch() {
    try { if (!sessionStorage.getItem('calio_crash')) { sessionStorage.setItem('calio_crash', '1'); setTimeout(() => location.reload(), 300) } } catch { /* */ }
  }
  componentDidUpdate(p) { if (p.name !== this.props.name && this.state.err) this.setState({ err: null }) }
  render() {
    if (!this.state.err) return this.props.children
    return <div className="sheet-body"><div className="sys lerr" role="alert"><b>Cet écran a eu un souci.</b> Rien n'est perdu.<br />
      <button className="btn" onClick={() => { try { sessionStorage.removeItem('calio_crash') } catch { /* */ } location.reload() }}>Recharger</button></div></div>
  }
}
