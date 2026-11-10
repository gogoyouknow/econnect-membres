import { useEffect, useRef } from 'react'

// Vidéo de préparation de l'appel (la même que sur la page de confirmation Systeme.io).
const ID = 'L_azY2l2YMvydziD'
const BASE = `https://fast.vidalytics.com/embeds/ACma8epm/${ID}/`

export default function Vidalytics() {
  const ran = useRef(false)
  useEffect(() => {
    if (ran.current) return; ran.current = true
    try {
      ;((v, i, d, a, l, y, t, c, s) => {
        y = '_' + d.toLowerCase(); c = d + 'L'
        if (!v[d]) v[d] = {}; if (!v[c]) v[c] = {}; if (!v[y]) v[y] = {}
        const vl = 'Loader'; let vli = v[y][vl]; let vsl = v[c][vl + 'Script']; let vlf = v[c][vl + 'Loaded']; const ve = 'Embed'
        if (!vsl) {
          vsl = (u, cb) => {
            if (t) { cb(); return }
            s = i.createElement('script'); s.type = 'text/javascript'; s.async = 1; s.src = u
            s.onload = () => { vlf = 1; cb() }
            i.getElementsByTagName('head')[0].appendChild(s)
          }
        }
        vsl(l + 'loader.min.js', () => {
          if (!vli) { const vlc = v[c][vl]; vli = new vlc() }
          vli.loadScript(l + 'player.min.js', () => { const vec = v[d][ve]; t = new vec(); t.run(a) })
        })
      })(window, document, 'Vidalytics', 'vidalytics_embed_' + ID, BASE)
    } catch { /* la vidéo est un plus : la confirmation WhatsApp ne dépend jamais d'elle */ }
  }, [])
  return <div className="vid"><div id={'vidalytics_embed_' + ID} dir="ltr" style={{ position: 'relative', width: '100%', paddingTop: '56.25%', direction: 'ltr' }} /></div>
}
