import { useEffect, useRef, useState } from 'react'

// Calio garde en mémoire où tu en étais (onglet, fiche ouverte, filtres, position de défilement) :
// si iPhone ferme l'app en arrière-plan ou si elle se met à jour, tu reviens exactement au même endroit.
const TTL = 3 * 24 * 3600 * 1000
const K = 'calio_ui:'
export const psGet = (key, def) => { try { const o = JSON.parse(localStorage.getItem(K + key)); if (o && Date.now() - o.t < TTL) return o.v } catch { /* */ } return def }
export const psSet = (key, v) => { try { v === null || v === undefined || v === '' ? localStorage.removeItem(K + key) : localStorage.setItem(K + key, JSON.stringify({ v, t: Date.now() })) } catch { /* */ } }

export function usePS(key, init) {
  const [v, setV] = useState(() => psGet(key, typeof init === 'function' ? init() : init))
  const set = (x) => setV((p) => { const n = typeof x === 'function' ? x(p) : x; psSet(key, n); return n })
  return [v, set]
}

/** Remet le défilement là où il était pour cet onglet, puis le mémorise à chaque mouvement. */
export function useScrollMemory(name, ready = true) {
  const done = useRef(false)
  useEffect(() => {
    done.current = false
    const el = () => document.querySelector('.adm .scroll')
    const y = psGet('scroll:' + name, 0)
    let tries = 0
    const t = setInterval(() => {
      const s = el(); tries++
      if (s && y && s.scrollHeight > y + s.clientHeight / 2) { s.scrollTop = y; done.current = true; clearInterval(t) }
      else if (tries > 16 || !y) { done.current = true; clearInterval(t) }
    }, 250)
    let last = 0
    const on = () => { if (!done.current) return; const now = Date.now(); if (now - last < 400) return; last = now; const s = el(); if (s) psSet('scroll:' + name, Math.round(s.scrollTop)) }
    const s = el(); s && s.addEventListener('scroll', on, { passive: true })
    return () => { clearInterval(t); s && s.removeEventListener('scroll', on) }
  }, [name, ready])
}
