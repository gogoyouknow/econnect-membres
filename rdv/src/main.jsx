import React from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'

const isAdmin = location.pathname.startsWith('/admin')
const mount = (C) => createRoot(document.getElementById('root')).render(<C />)
if (isAdmin) {
  import('./admin/admin.css')
  document.title = 'Mes appels · L\'Accélérateur'
  const l = document.createElement('link'); l.rel = 'manifest'; l.href = '/admin.webmanifest'; document.head.appendChild(l)
  import('./admin/Admin').then((m) => mount(m.default))
} else {
  import('./App').then((m) => mount(m.default))
}
