import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ToastProvider } from './lib/ui'
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

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider><App /></ToastProvider>
  </React.StrictMode>
)
