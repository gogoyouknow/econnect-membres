import { createPortal } from 'react-dom'

// Tiroirs et fenêtres : rendus tout en haut de l'app, hors du panneau qui défile.
// Sur iPhone, un élément « fixed » à l'intérieur d'une zone qui défile est coupé par cette zone
// (la fiche prospect apparaissait décalée, sans son en-tête).
export default function Portal({ children }) {
  const host = typeof document !== 'undefined' ? (document.querySelector('.adm.app') || document.querySelector('.adm') || document.body) : null
  return host ? createPortal(children, host) : null
}
