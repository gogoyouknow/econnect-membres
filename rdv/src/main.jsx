import React from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'

// L'ancienne adresse vercel.app ne doit jamais rester visible : on bascule sur le vrai domaine.
if (location.hostname === 'econnect-rdv.vercel.app') {
  location.replace('https://rdv.theambitiousman.fr' + location.pathname + location.search + location.hash)
}
const isAdmin = location.pathname.startsWith('/admin')
const mount = (C) => createRoot(document.getElementById('root')).render(<C />)
if (isAdmin) {
  import('./admin/admin.css')
  document.body.classList.add('admbody')
  const f = document.createElement('link'); f.rel = 'stylesheet'; f.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@600;700&display=swap'; document.head.appendChild(f)
  document.title = 'Calio'
  import('./admin/Admin').then((m) => mount(m.default))
} else if (location.pathname.startsWith('/decouvrir')) {
  import('./Decouvrir').then((m) => mount(m.default))
} else {
  import('./App').then((m) => mount(m.default))
}
