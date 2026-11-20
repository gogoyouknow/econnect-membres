// Lien suivi des e-mails : enregistre le clic puis renvoie la personne vers la bonne page (liste fixe, jamais une adresse libre).
const DEST = {
  video: 'https://youtu.be/BKjD49O6lJE',
  rdv: 'https://rdv.theambitiousman.fr/y/BKjD49O6lJE?utm_content=email',
  methode: 'https://econnect-membres.vercel.app/methode/?utm_source=email&utm_medium=newsletter&utm_campaign=yt_20_nov',
}
const key = () => String(process.env.VITE_SUPABASE_ANON_KEY || '').match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/)?.[0] || ''
export default async function handler(req, res) {
  const t = String(req.query?.t || '').toLowerCase(); const to = DEST[req.query?.to] ? req.query.to : 'video'
  if (/^[0-9a-f-]{36}$/.test(t) && process.env.VITE_SUPABASE_URL) {
    try {
      await fetch(`${process.env.VITE_SUPABASE_URL}/rest/v1/rpc/mail_bc_click`, {
        method: 'POST', headers: { apikey: key(), Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_token: t, p_to: to }),
        signal: AbortSignal.timeout(4000),
      })
    } catch { /* la redirection part quand même */ }
  }
  res.setHeader('Cache-Control', 'no-store')
  res.redirect(302, DEST[to])
}
