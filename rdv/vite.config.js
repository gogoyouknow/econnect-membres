import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync } from 'node:fs'

// /decouvrir a son propre titre et son propre aperçu de lien (WhatsApp ne lit que le HTML de départ, pas le JavaScript).
// On fabrique donc dist/decouvrir.html à partir de la page d'accueil construite, avec un autre titre.
const T = "Comprendre le business · L'Accélérateur", D = "Regarde la vidéo et vois comment je t'accompagne, avant qu'on se parle."
const decouvrir = () => ({
  name: 'decouvrir-html',
  closeBundle() {
    const p = 'dist/index.html'; let h = readFileSync(p, 'utf8')
    h = h.replace(/<title>[^<]*<\/title>/, `<title>${T}</title>\n    <meta name="description" content="${D}" />`)
         .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${T}" />\n    <meta property="og:description" content="${D}" />`)
    writeFileSync('dist/decouvrir.html', h)
  },
})
export default defineConfig({ plugins: [react(), decouvrir()] })
