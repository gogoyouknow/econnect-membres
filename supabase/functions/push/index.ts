// Notifications push : envoie chaque notification de l'app sur les téléphones / ordinateurs des membres.
// Clés VAPID créées automatiquement au premier appel et gardées dans public.app_secrets (illisible depuis l'app).
import webpush from 'npm:web-push@3.6.7'

const URL_ = Deno.env.get('SUPABASE_URL')!
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

async function db(path: string, opts: RequestInit = {}) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...opts, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(opts.headers || {}) } })
  const t = await r.text(); if (!r.ok) throw new Error(t); return t ? JSON.parse(t) : null
}
const secret = async (k: string) => (await db(`app_secrets?key=eq.${k}&select=value`))?.[0]?.value as string | undefined

async function vapid() {
  let pub = await secret('vapid_public'), priv = await secret('vapid_private')
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys(); pub = k.publicKey; priv = k.privateKey
    await db('app_secrets', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify([{ key: 'vapid_public', value: pub }, { key: 'vapid_private', value: priv }]) })
    pub = await secret('vapid_public'); priv = await secret('vapid_private')   // si deux appels simultanés : on garde la première paire
  }
  webpush.setVapidDetails('mailto:contact@theambitiousman.fr', pub!, priv!)
  return pub!
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const p = await req.json().catch(() => ({}))
    if (p.action === 'key') return json({ key: await vapid() })
    if (p.action === 'send') {
      if (!p.secret || p.secret !== await secret('push_hook')) return json({ error: 'unauthorized' }, 401)
      await vapid()
      const [n] = await db(`notifications?id=eq.${Number(p.id)}&select=*`); if (!n) return json({ ok: true, sent: 0 })
      const subs = await db(`push_subscriptions?user_id=eq.${n.user_id}&select=id,endpoint,keys`)
      const url = n.url?.startsWith('#') ? '/' + n.url : (n.url || '/')
      const payload = JSON.stringify({ title: n.title, body: n.body || '', url, tag: 'n' + n.id })
      let sent = 0
      for (const s of subs) {
        try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 86400 }); sent++ }
        catch (e) { const code = (e as { statusCode?: number }).statusCode; if (code === 404 || code === 410) await db(`push_subscriptions?id=eq.${s.id}`, { method: 'DELETE' }) }
      }
      return json({ ok: true, sent })
    }
    return json({ error: 'action inconnue' }, 400)
  } catch (e) { return json({ error: String(e).slice(0, 300) }, 500) }
})
