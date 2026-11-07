// Envoie une notification push (Web Push) aux appareils d'un membre.
// Appelée par la base (trigger sur public.notifications) avec le jeton partagé x-push-token.
// Au premier appel, génère les clés VAPID et les range dans la base (push_set_keys).
import webpush from 'npm:web-push@3.6.7'

const URL = Deno.env.get('SUPABASE_URL')!
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const rpc = async (fn: string, args: Record<string, unknown>) => {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${await r.text()}`)
  const t = await r.text(); return t ? JSON.parse(t) : null
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok')
  const token = req.headers.get('x-push-token') ?? ''
  const msg = await req.json().catch(() => ({}))
  if (!token) return new Response('no token', { status: 401 })

  // clés VAPID (créées une seule fois)
  let cfg = await rpc('push_payload', { p_token: token, p_user: msg.user_id ?? '00000000-0000-0000-0000-000000000000' })
  if (!cfg.vapid_public || !cfg.vapid_private) {
    const k = webpush.generateVAPIDKeys()
    await rpc('push_set_keys', { p_token: token, p_public: k.publicKey, p_private: k.privateKey })
    cfg = await rpc('push_payload', { p_token: token, p_user: msg.user_id ?? '00000000-0000-0000-0000-000000000000' })
  }
  if (msg.setup) return Response.json({ ok: true, vapid_public: cfg.vapid_public })
  if (!msg.user_id) return Response.json({ ok: false, error: 'user_id manquant' }, { status: 400 })

  webpush.setVapidDetails('mailto:contact@theambitiousman.fr', cfg.vapid_public, cfg.vapid_private)
  const payload = JSON.stringify({ title: msg.title ?? "L'Accélérateur", body: msg.body ?? '', url: msg.url ?? '/' })
  let sent = 0, dropped = 0
  for (const s of cfg.subs ?? []) {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 3600 }); sent++ }
    catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) { await rpc('push_drop', { p_token: token, p_endpoint: s.endpoint }).catch(() => {}); dropped++ }
      else console.error('push', code, (e as Error).message)
    }
  }
  return Response.json({ ok: true, sent, dropped })
})
