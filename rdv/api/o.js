// Pixel d'ouverture des e-mails : enregistre l'ouverture puis renvoie une image transparente de 1 pixel.
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
const key = () => String(process.env.VITE_SUPABASE_ANON_KEY || '').match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/)?.[0] || ''
export default async function handler(req, res) {
  const t = String(req.query?.t || '').toLowerCase()
  if (/^[0-9a-f-]{36}$/.test(t) && process.env.VITE_SUPABASE_URL) {
    try {
      await fetch(`${process.env.VITE_SUPABASE_URL}/rest/v1/rpc/mail_bc_open`, {
        method: 'POST', headers: { apikey: key(), Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_token: t }),
        signal: AbortSignal.timeout(4000),
      })
    } catch { /* l'image part quand même */ }
  }
  res.setHeader('Content-Type', 'image/gif')
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
  res.status(200).send(GIF)
}
