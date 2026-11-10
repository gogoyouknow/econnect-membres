import React from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'

// L'ancienne adresse vercel.app ne doit jamais rester visible : on bascule sur le vrai domaine.
if (location.hostname === 'econnect-rdv.vercel.app') {
  location.replace('https://rdv.theambitiousman.fr' + location.pathname + location.search + location.hash)
}
const path = location.pathname.toLowerCase()
const isAdmin = path.startsWith('/admin')
const mount = (C) => createRoot(document.getElementById('root')).render(<C />)
// Après une mise à jour du site, un vieil onglet peut réclamer un fichier qui n'existe plus : on recharge une fois, sinon on affiche un message clair (au lieu d'une page blanche).
const boot = (p) => p.then((m) => { try { sessionStorage.removeItem('boot_retry') } catch { /* */ } mount(m.default) }).catch(() => {
  try { if (!sessionStorage.getItem('boot_retry')) { sessionStorage.setItem('boot_retry', '1'); location.reload(); return } } catch { /* */ }
  document.getElementById('root').innerHTML = '<p style="font:16px system-ui;color:#999;padding:40px 24px;text-align:center">Impossible de charger la page.<br>Vérifie ta connexion, puis <a href="" style="color:inherit">recharge</a>.</p>'
})
if (isAdmin) {
  import('./admin/admin.css')
  document.body.classList.add('admbody')
  const f = document.createElement('link'); f.rel = 'stylesheet'; f.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@600;700&display=swap'; document.head.appendChild(f)
  document.title = 'Calio'
  boot(import('./admin/Admin'))
} else if (path.startsWith('/decouvrir')) {
  boot(import('./Decouvrir'))
} else {
  boot(import('./App'))
}
