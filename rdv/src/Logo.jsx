// Logo officiel L'Accélérateur (le même que dans l'app membres) : pastille noire, marque blanche, nom à droite.
export default function Logo() {
  return <div className="logo">
    <i className="mark"><svg viewBox="0 0 100 100" fill="none" stroke="#fff" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 22 Q8 8 22 8 H78 Q92 8 92 22 V78 Q92 92 78 92 H22 Q8 92 8 78 V48" /><path d="M30 70 L72 28" /><path d="M40 28 H72 V60" /></svg></i>
    <span>L'Accélérateur</span>
  </div>
}
