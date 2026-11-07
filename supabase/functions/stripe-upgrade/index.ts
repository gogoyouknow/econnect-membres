// Passage Méthode → accompagnement (160 €/mois) en un clic, débité sur la carte enregistrée chez Stripe.
// Appelée par l'app avec le jeton de session du membre (Authorization: Bearer …).
//  { action: 'status' }  → la carte enregistrée (marque, 4 derniers chiffres) ou null
//  { action: 'charge' }  → crée l'abonnement sur cette carte, ouvre l'accès ; sans carte → lien Checkout
//  { action: 'setup' }   → (admin) crée le tarif 160 €/mois et fait enregistrer la carte sur le lien 97 €
const URL = Deno.env.get('SUPABASE_URL')!, SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const APP = 'https://econnect-membres.vercel.app'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey', 'Content-Type': 'application/json' }
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: cors })

const rpc = async (fn: string, args: Record<string, unknown> = {}) => {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
  if (!r.ok) throw new Error(`${fn}: ${await r.text()}`)
  const t = await r.text(); return t ? JSON.parse(t) : null
}
const form = (o: Record<string, string>) => new URLSearchParams(o).toString()
const stripe = async (sk: string, method: string, path: string, body?: Record<string, string>) => {
  const r = await fetch(`https://api.stripe.com/v1${path}`, { method, headers: { Authorization: `Bearer ${sk}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: body ? form(body) : undefined })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error?.message || `Stripe ${r.status}`)
  return j
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const u = await fetch(`${URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${jwt}` } }).then(r => r.ok ? r.json() : null)
    if (!u?.id) return json({ error: 'Connecte-toi d\'abord' }, 401)
    const prof = await fetch(`${URL}/rest/v1/profiles?id=eq.${u.id}&select=id,email,name,role,accel,stripe_customer`, { headers: { apikey: SRV, Authorization: `Bearer ${SRV}` } }).then(r => r.json()).then(a => a[0])
    if (!prof) return json({ error: 'Profil introuvable' }, 404)
    const { action } = await req.json().catch(() => ({}))
    const sec = await rpc('stripe_secrets_for_fn')
    if (!sec?.sk) return json({ error: 'Clé Stripe absente : Admin → Stripe → Clé secrète' }, 503)
    const sk = sec.sk as string

    // tarif 160 €/mois (créé une fois)
    const ensurePrice = async () => {
      if (sec.price) return sec.price as string
      const found = await stripe(sk, 'GET', '/prices?lookup_keys[]=accel_160&active=true&limit=1')
      let id = found.data?.[0]?.id
      if (!id) id = (await stripe(sk, 'POST', '/prices', { 'product_data[name]': 'Accompagnement E-Connect · L\'Accélérateur', unit_amount: '16000', currency: 'eur', 'recurring[interval]': 'month', lookup_key: 'accel_160' })).id
      await rpc('stripe_set_price_for_fn', { p_price: id }); return id
    }

    if (action === 'setup') {
      if (prof.role !== 'admin') return json({ error: 'Réservé à l\'admin' }, 403)
      const price = await ensurePrice()
      // le lien 97 € doit enregistrer la carte pour plus tard
      const links = await stripe(sk, 'GET', '/payment_links?active=true&limit=20')
      let fixed = 0
      for (const l of links.data || []) {
        const items = await stripe(sk, 'GET', `/payment_links/${l.id}/line_items?limit=5`)
        const oneShot = (items.data || []).every((i: { price: { type: string } }) => i.price?.type === 'one_time')
        if (oneShot && l.payment_intent_data?.setup_future_usage !== 'off_session') { await stripe(sk, 'POST', `/payment_links/${l.id}`, { 'payment_intent_data[setup_future_usage]': 'off_session' }); fixed++ }
      }
      return json({ ok: true, price, links_fixed: fixed })
    }

    // client Stripe du membre
    let cust = prof.stripe_customer as string | null
    if (!cust) { const c = await stripe(sk, 'GET', `/customers?email=${encodeURIComponent(prof.email)}&limit=1`); cust = c.data?.[0]?.id || null }
    const card = async () => {
      if (!cust) return null
      const c = await stripe(sk, 'GET', `/customers/${cust}`)
      let pm = c.invoice_settings?.default_payment_method as string | null
      if (!pm) { const l = await stripe(sk, 'GET', `/payment_methods?customer=${cust}&type=card&limit=1`); pm = l.data?.[0]?.id || null }
      if (!pm) return null
      const p = await stripe(sk, 'GET', `/payment_methods/${pm}`)
      return { id: pm, brand: p.card?.brand, last4: p.card?.last4 }
    }

    if (action === 'status') {
      const k = await card()
      return json({ accel: !!prof.accel, card: k ? { brand: k.brand, last4: k.last4 } : null })
    }

    if (action === 'charge') {
      if (prof.accel) return json({ ok: true, already: true })
      const price = await ensurePrice()
      const k = await card()
      if (!cust || !k) {
        // pas de carte connue : paiement classique, l'accès s'ouvre par le webhook
        const s = await stripe(sk, 'POST', '/checkout/sessions', { mode: 'subscription', 'line_items[0][price]': price, 'line_items[0][quantity]': '1', ...(cust ? { customer: cust } : { customer_email: prof.email }), success_url: `${APP}/#mchat`, cancel_url: `${APP}/#offre`, 'subscription_data[metadata][app]': 'accelerateur' })
        return json({ ok: false, needs_card: true, url: s.url })
      }
      const sub = await stripe(sk, 'POST', '/subscriptions', { customer: cust, 'items[0][price]': price, default_payment_method: k.id, off_session: 'true', payment_behavior: 'error_if_incomplete', 'metadata[app]': 'accelerateur', 'metadata[email]': prof.email })
      const ok = sub.status === 'active' || sub.status === 'trialing'
      await fetch(`${URL}/rest/v1/stripe_upgrades`, { method: 'POST', headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: prof.id, email: prof.email, customer: cust, subscription: sub.id, status: sub.status }) })
      if (!ok) return json({ error: 'Le paiement n\'est pas passé sur cette carte. Essaie avec une autre carte.', status: sub.status }, 402)
      await rpc('stripe_grant_accel_for_fn', { p_email: prof.email, p_customer: cust })
      return json({ ok: true, subscription: sub.id })
    }
    return json({ error: 'action inconnue' }, 400)
  } catch (e) { return json({ error: (e as Error).message }, 500) }
})
