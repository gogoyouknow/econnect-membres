import { useEffect, useState } from 'react'

// Témoignages vidéo (playlist YouTube « Témoignage d'élèves »). Vignettes officielles de la chaîne ; la vidéo ne se charge qu'au toucher.
export const TEMOS = [
  ['OsUzPk84x5s', 'Abdoulaye · son 2ᵉ mois', '10:48'],
  ['iu0DjBCAyxs', 'Meryeme · après 2 semaines', '5:17'],
  ['_ms0EjrimCs', 'Salarié, à côté de son CDI', '3:44'],
  ['17QrGHeEp-M', 'Selimkhan · 27 ans', '7:43'],
  ['9Q69OkBQlyY', '23 ans · 45 jours après', '8:36'],
  ['VWBhzjocYds', 'Issa · 40 jours après', '8:00'],
  ['hcbIS0DFEE0', 'Son tout premier stock', '6:55'],
  ['b0YZOAXwSiU', 'Son premier mois', '17:34'],
  ['KmG2NbYS9KA', 'Accompagnement 1-1', '19:21'],
]

// Grande vignette = sddefault (640 px, bandes noires haut/bas rognées par .lb) ; petites = mqdefault (16:9 sans bandes). Repli sur mqdefault si l'image manque.
export const Thumb = ({ id, dur, big }) => <span className={`tvid ${big ? 'big' : ''}`}>
  <img className={big ? 'lb' : ''} src={`https://img.youtube.com/vi/${id}/${big ? 'sddefault' : 'mqdefault'}.jpg`} alt="" loading={big ? 'eager' : 'lazy'} decoding="async"
    onError={(e) => { const i = e.currentTarget; if (!i.dataset.fb) { i.dataset.fb = '1'; i.classList.remove('lb'); i.src = `https://img.youtube.com/vi/${id}/mqdefault.jpg` } }} />
  <i className="tplay"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg></i>{dur && <span className="tdur">{dur}</span>}</span>

/** Lecture en grand (fenêtre) d'une vidéo YouTube, chargée seulement au toucher. play = [id, titre] ou null. */
export function PlayerModal({ play, onClose }) {
  useEffect(() => { if (!play) return; const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [play])
  if (!play) return null
  return <div className="tmodal" onClick={onClose} role="dialog" aria-modal="true" aria-label={play[1]}>
    <div className="tbox" onClick={(e) => e.stopPropagation()}>
      <button className="tclose" onClick={onClose} aria-label="Fermer">✕</button>
      <div className="tvid"><iframe src={`https://www.youtube-nocookie.com/embed/${play[0]}?autoplay=1&rel=0&playsinline=1`} title={play[1]} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen /></div>
      <b>{play[1]}</b>
    </div></div>
}

export function useModal() { const [play, setPlay] = useState(null); return [play, setPlay] }
