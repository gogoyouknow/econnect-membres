/** Logo L'Accélérateur : marque (flèche dans un carré) + nom. */
export function Mark({ size = 32, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 22 Q8 8 22 8 H78 Q92 8 92 22 V78 Q92 92 78 92 H22 Q8 92 8 78 V48" />
      <path d="M30 70 L72 28" /><path d="M40 28 H72 V60" />
    </svg>
  )
}
export default function Logo({ size = 30, text = true }) {
  return (
    <div className="logo">
      <Mark size={size} />
      {text && <b>L'ACCÉLÉRATEUR</b>}
    </div>
  )
}
