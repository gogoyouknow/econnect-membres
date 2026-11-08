import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import LeadForm from './views/LeadForm'
import { ToastProvider } from './lib/ui'
import { ErrorBoundary } from './lib/errors'
import './styles.css'
import { registerSW } from 'virtual:pwa-register'

// Mise à jour automatique : on vérifie une nouvelle version au lancement, à chaque retour sur l'app et toutes les 30 min ;
// dès qu'elle est prête, la page se recharge toute seule (plus de version « figée » sur le téléphone).
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() { updateSW(true) },
  onRegisteredSW(_url, reg) {
    if (!reg) return
    const check = () => { if (navigator.onLine) reg.update().catch(() => {}) }
    setInterval(check, 30 * 60 * 1000)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check() })
  },
})

// Clavier iPhone : la zone visible se réduit au lieu de laisser un trou entre le champ et le clavier
if (window.visualViewport) {
  const fit = () => { const vv = window.visualViewport; document.documentElement.style.setProperty('--vvh', Math.round(vv.height) + 'px'); document.body.style.top = Math.round(vv.offsetTop) + 'px'; if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) setTimeout(() => document.activeElement?.scrollIntoView?.({ block: 'nearest' }), 50) }
  window.visualViewport.addEventListener('resize', fit); window.visualViewport.addEventListener('scroll', fit); fit()
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary><ToastProvider>{location.pathname.replace(/\/$/, '') === '/bienvenue' ? <LeadForm /> : <App />}</ToastProvider></ErrorBoundary>
  </React.StrictMode>
)
