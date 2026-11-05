// Reçoit les événements Stripe et les transmet tels quels (corps brut + signature) à la base.
// La vérification de signature et l'ouverture des accès se font dans public.stripe_webhook (migration 0014).
Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok')
  const payload = await req.text()
  const sig = req.headers.get('stripe-signature') ?? ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/stripe_webhook`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload, sig }),
  })
  const out = await r.text()
  let ok = r.ok
  try { ok = ok && JSON.parse(out).ok !== false } catch { ok = false }
  // 400 si signature refusée : Stripe le signale dans son tableau de bord
  return new Response(out, { status: ok ? 200 : 400, headers: { 'Content-Type': 'application/json' } })
})
