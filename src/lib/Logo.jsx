/** Logo L'Accélérateur : marque (flèche dans un carré) + nom. */
export function Mark({ size = 32, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" stroke={color} strokeWidth="11.5" strokeLinejoin="round" aria-hidden="true">
      <path d="M44 85 H72 Q84.5 85 84.5 72 V28 Q84.5 16 72 16 H28 Q16 16 16 28 V63 Q16 78 29 68 L61 38" />
      <path d="M33 38.5 H62 V68" />
    </svg>
  )
}
export default function Logo({ size = 30, text = true }) {
  return (
    <div className="logo">
      <Mark size={size} />
      {text && <b>E-CONNECT</b>}
    </div>
  )
}
