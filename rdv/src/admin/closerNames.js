import { useEffect, useState } from 'react'
import { supabase } from './supabase'
// Noms des closers (avec accents) pour les écrans Closing / messages ; se met à jour dès que la liste est chargée.
const NAMES = { clement: 'Clément', amandine: 'Amandine' }
let loaded = false
export const closerName = (k) => NAMES[k] || (k ? k[0].toUpperCase() + k.slice(1) : 'Clément')
export function useCloserNames() {
  const [, bump] = useState(0)
  useEffect(() => {
    if (loaded) return
    supabase.from('cand_closers').select('key,name').then(({ data }) => { if (data) { data.forEach((r) => { NAMES[r.key] = r.name }); loaded = true; bump((n) => n + 1) } })
  }, [])
}
