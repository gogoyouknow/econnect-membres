// Vérifie qu'une adresse email peut vraiment recevoir des messages :
// 1) forme correcte, 2) pas une adresse jetable, 3) le domaine existe et a un serveur de réception (MX) — contrôle DNS.
// Si le contrôle réseau échoue ou traîne, on laisse passer : on ne bloque jamais quelqu'un à cause d'un souci technique.
const DISPOSABLE = new Set(['mailinator.com', 'yopmail.com', 'yopmail.fr', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com', 'tempmail.com', 'temp-mail.org', 'temp-mail.io', '10minutemail.com', 'trashmail.com', 'getnada.com', 'dispostable.com', 'maildrop.cc', 'fakeinbox.com', 'throwawaymail.com', 'mailnesia.com', 'mohmal.com', 'tempail.com', 'emailondeck.com', 'spamgourmet.com', 'mytemp.email', 'burnermail.io', 'moakt.com', 'tmpmail.org', 'discard.email', 'jetable.org', 'trash-mail.com', 'mail.tm', 'inboxkitten.com', 'example.com', 'test.com', 'email.com.test'])
const cache = new Map()

export const mailShape = (email) => {
  const e = String(email || '').trim()
  if (!/^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(e)) return false
  const [loc, dom] = e.split('@')
  if (loc.startsWith('.') || loc.endsWith('.') || loc.includes('..') || dom.includes('..') || dom.startsWith('-') || dom.split('.').some((x) => x.startsWith('-') || x.endsWith('-'))) return false
  return loc.length <= 64
}

async function dns(name, type) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 3500)
  try {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' }, signal: c.signal })
    if (!r.ok) return null
    return await r.json()
  } catch { return null } finally { clearTimeout(t) }
}

/** Retourne un message d'erreur (en français) si l'adresse est invalide, sinon null. */
export async function mailProblem(email) {
  const e = String(email || '').trim().toLowerCase()
  if (!mailShape(e)) return "Cette adresse email n'a pas l'air correcte (exemple : prenom@gmail.com)."
  const dom = e.split('@')[1]
  if (DISPOSABLE.has(dom)) return "Cette adresse est temporaire ou fictive : indique ta vraie adresse email, c'est là que tu recevras la confirmation."
  if (cache.has(dom)) return cache.get(dom)
  let res = null
  const mx = await dns(dom, 'MX')
  if (mx) {
    const ans = (mx.Answer || []).filter((a) => a.type === 15)
    if (mx.Status === 3) res = "Ce nom de domaine n'existe pas : vérifie ton adresse email."
    else if (mx.Status === 0 && ans.length) { if (ans.every((a) => /^\d+\s+\.?$/.test(String(a.data).trim()))) res = "Cette adresse ne peut pas recevoir d'emails : vérifie-la." }
    else if (mx.Status === 0) { const a = await dns(dom, 'A'); if (a && a.Status === 0 && !(a.Answer || []).some((x) => x.type === 1)) res = "Ce domaine ne reçoit pas d'emails : vérifie ton adresse." }
  }
  if (mx) cache.set(dom, res)
  return res
}
