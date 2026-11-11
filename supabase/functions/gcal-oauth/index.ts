// Retour de Google après « Se connecter avec Google » : échange le code contre un jeton longue durée (stocké côté base, jamais côté navigateur).
const URL_ = Deno.env.get('SUPABASE_URL')!, SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const rpc = async (fn: string, args: Record<string, unknown> = {}) => {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${await r.text()}`)
  const t = await r.text(); return t ? JSON.parse(t) : null
}
const back = (q: string) => Response.redirect('https://rdv.theambitiousman.fr/admin?agenda=' + q, 302)

Deno.serve(async (req) => {
  const u = new URL(req.url)
  const code = u.searchParams.get('code'), state = u.searchParams.get('state')
  if (u.searchParams.get('error')) return back('refuse')
  if (!code || !state) return new Response('Lien invalide', { status: 400 })
  try {
    const cfg = await rpc('gcal_oauth_for_fn')
    if (!cfg?.client_id || !cfg.state || cfg.state !== state) return back('etat')
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: cfg.client_id, client_secret: cfg.client_secret, redirect_uri: `${URL_}/functions/v1/gcal-oauth`, grant_type: 'authorization_code' }),
    })
    const j = await r.json()
    if (!r.ok || !j.refresh_token) return back('echec')
    await rpc('gcal_save_refresh_for_fn', { p_refresh: j.refresh_token, p_write: String(j.scope || '').includes('calendar.events') })
    return back('ok')
  } catch (_e) { return back('echec') }
})
