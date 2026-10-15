import { createContext, useContext, useState, useCallback, useEffect } from 'react'

export const ROLE_LABEL = { admin: 'Admin', mod: 'Modérateur', member: 'Membre' }
export const TIER_LABEL = { 1: 'Démarrage', 2: 'Accélération' }

export const initials = (name = '?') => name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
export const fmtTime = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
export const fmtDay = (d) => {
  const x = new Date(d), t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1)
  if (x.toDateString() === t.toDateString()) return "Aujourd'hui"
  if (x.toDateString() === y.toDateString()) return 'Hier'
  return x.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}
export const ago = (d) => {
  const s = Math.floor((Date.now() - new Date(d)) / 1000)
  if (s < 60) return "à l'instant"; if (s < 3600) return `il y a ${Math.floor(s / 60)} min`
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`; if (s < 172800) return 'hier'
  return `il y a ${Math.floor(s / 86400)} j`
}

export function Avatar({ p, className = '' }) {
  const member = !p || p.role === 'member'
  return <div className={`av ${member ? 'm' : ''} ${className}`}>{p?.avatar_url ? <img src={p.avatar_url} alt="" /> : initials(p?.name)}</div>
}
export function NameTag({ p }) {
  if (!p) return <>?</>
  return <>{p.name}{p.role === 'admin' && <span className="role">Admin</span>}{p.role === 'mod' && <span className="role mod">Modérateur</span>}</>
}
export function Switch({ on, onChange, label }) {
  return <button className="sw" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />
}

const ToastCtx = createContext(() => {})
export function ToastProvider({ children }) {
  const [t, setT] = useState(null)
  const toast = useCallback((msg, bad = false) => { setT({ msg, bad }); setTimeout(() => setT(null), 2600) }, [])
  return <ToastCtx.Provider value={toast}>{children}{t && <div className={`toast ${t.bad ? 'bad' : ''}`}>{t.msg}</div>}</ToastCtx.Provider>
}
export const useToast = () => useContext(ToastCtx)

export function Lightbox({ src, onClose }) {
  useEffect(() => { const k = e => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  if (!src) return null
  return <div className="lightbox" onClick={onClose}><img src={src} alt="" /></div>
}

/** Compresse une image côté client (max 1200 px, JPEG 0.8). Renvoie un Blob. */
export function compressImage(file, max = 1200, q = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(img.src)
      c.toBlob(b => b ? resolve(b) : reject(new Error('compress')), 'image/jpeg', q)
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}
