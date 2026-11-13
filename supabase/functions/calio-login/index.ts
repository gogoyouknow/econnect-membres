// Connexion à Calio par code à 6 chiffres : vérifie le code (envoyé par email), puis renvoie un jeton à usage unique
// que l'application échange contre une vraie session (verifyOtp). Aucun mot de passe en jeu.
const URL = Deno.env.get('SUPABASE_URL')!
const SKEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const H = { apikey: SKEY, Authorization: `Bearer ${SKEY}`, 'Content-Type': 'application/json' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const { email, code } = await req.json()
    const em = String(email ?? '').trim().toLowerCase(), cd = String(code ?? '')
    if (!em || cd.replace(/\D/g, '').length < 6) return json({ ok: false, error: 'Entre ton email et le code à 6 chiffres.' })
    const c = await fetch(`${URL}/rest/v1/rpc/calio_login_check`, { method: 'POST', headers: H, body: JSON.stringify({ p_email: em, p_code: cd }) })
    if (!c.ok || (await c.json()) !== true) return json({ ok: false, error: 'Code incorrect ou expiré. Demande-en un nouveau.' })
    const g = await fetch(`${URL}/auth/v1/admin/generate_link`, { method: 'POST', headers: H, body: JSON.stringify({ type: 'magiclink', email: em }) })
    const d = await g.json()
    if (!g.ok || !d?.hashed_token) return json({ ok: false, error: 'Connexion impossible pour le moment, réessaie.' })
    return json({ ok: true, token_hash: d.hashed_token })
  } catch {
    return json({ ok: false, error: 'Connexion impossible pour le moment, réessaie.' })
  }
})
