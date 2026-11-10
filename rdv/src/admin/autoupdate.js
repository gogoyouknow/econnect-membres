import { useEffect, useState } from 'react'

// Une application ajoutée à l'écran d'accueil reste ouverte en mémoire pendant des jours : elle continue
// d'afficher l'ANCIENNE version même après une mise en ligne. On compare donc la version chargée à la version
// en ligne chaque fois qu'on revient dans l'app (et toutes les 5 min), et on se recharge toute seule.
const cur = () => { const s = document.querySelector('script[type="module"][src*="/assets/index-"]'); return s ? s.getAttribute('src') : null }
const typing = () => { const a = document.activeElement; return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) }

async function live() {
  try {
    const r = await fetch('/admin?v=' + Date.now(), { cache: 'no-store' }); if (!r.ok) return null
    const m = (await r.text()).match(/<script[^>]+type="module"[^>]+src="(\/assets\/index-[^"]+)"/)
    return m ? m[1] : null
  } catch { return null }
}

export function useAutoUpdate() {
  const [stale, setStale] = useState(false)
  useEffect(() => {
    const mine = cur(); if (!mine) return
    let busy = false
    const check = async (fromResume) => {
      if (busy) return; busy = true
      const l = await live(); busy = false
      if (!l || l === mine) return
      if (fromResume && !typing()) { location.reload(); return }
      setStale(true)
    }
    const vis = () => { if (document.visibilityState === 'visible') check(true) }
    document.addEventListener('visibilitychange', vis)
    const t = setInterval(() => check(false), 300000)
    const t0 = setTimeout(() => check(false), 4000)
    return () => { document.removeEventListener('visibilitychange', vis); clearInterval(t); clearTimeout(t0) }
  }, [])
  return stale
}
