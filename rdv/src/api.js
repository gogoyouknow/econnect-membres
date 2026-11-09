// Appels directs aux fonctions SQL publiques (cand_*) du Supabase existant : pas de connexion, pas de librairie lourde.
const URL_ = import.meta.env.VITE_SUPABASE_URL
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
export const configured = Boolean(URL_ && KEY)
export async function rpc(name, args = {}) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw new Error((j && (j.message || j.error)) || 'Erreur réseau')
  return j
}
