// Prise de rendez-vous E-Connect : créneaux libres (Google Agenda de chaque coach), réservation, annulation, connexion Google.
// Appelée par l'app via supabase.functions.invoke('agenda', { body: { action, ... } })
const URL_ = Deno.env.get('SUPABASE_URL')!
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
class Oops extends Error {}

async function db(path: string, opts: RequestInit = {}) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...opts, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(opts.headers || {}) } })
  const t = await r.text(); if (!r.ok) throw new Error(t); return t ? JSON.parse(t) : null
}
const rpc = (fn: string, args: unknown) => db(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) })

// ---------- fuseaux horaires ----------
function offsetMin(d: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d).map(x => [x.type, x.value]))
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second)
  return (asUtc - d.getTime()) / 60000
}
function localToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string) {
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  let t = guess - offsetMin(new Date(guess), tz) * 60000
  t = guess - offsetMin(new Date(t), tz) * 60000
  return new Date(t)
}
function localParts(d: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(d).map(x => [x.type, x.value]))
  const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday as string] as number
  return { y: +p.year, m: +p.month, d: +p.day, wd, key: `${p.year}-${p.month}-${p.day}` }
}

// ---------- Google ----------
async function googleClient() {
  const [s] = await db('agenda_settings?id=eq.1&select=*')
  const sec = await db('agenda_secrets?key=eq.google_client_secret&select=value')
  if (!s?.google_client_id || !sec?.[0]) throw new Oops('Google Agenda n\'est pas encore configuré')
  return { id: s.google_client_id as string, secret: sec[0].value as string, settings: s }
}
async function accessToken(hostId: string, cl: { id: string; secret: string }) {
  const [t] = await db(`agenda_tokens?profile_id=eq.${hostId}&select=refresh_token`)
  if (!t) return null
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: cl.id, client_secret: cl.secret, refresh_token: t.refresh_token, grant_type: 'refresh_token' }) })
  const j = await r.json(); return j.access_token || null
}
async function busyFor(token: string, from: Date, to: Date) {
  const r = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: 'primary' }] }) })
  const j = await r.json(); return ((j.calendars?.primary?.busy) || []).map((b: { start: string; end: string }) => [Date.parse(b.start), Date.parse(b.end)])
}

// ---------- créneaux ----------
type Host = { profile_id: string; hours: Record<string, string[][]> | null; token: string | null; busy: number[][]; perDay: Record<string, number>; week: number }
async function loadHosts(from: Date, to: Date, cl: { id: string; secret: string }) {
  const hosts = await db('agenda_hosts?active=eq.true&connected_at=not.is.null&select=profile_id,hours')
  const books = await db(`bookings?status=eq.confirme&starts_at=gte.${new Date(from.getTime() - 864e5).toISOString()}&starts_at=lte.${to.toISOString()}&select=host_id,starts_at,ends_at`)
  const out: Host[] = []
  for (const h of hosts) {
    const token = await accessToken(h.profile_id, cl); if (!token) continue
    const busy = await busyFor(token, from, to)
    const mine = books.filter((b: { host_id: string }) => b.host_id === h.profile_id)
    mine.forEach((b: { starts_at: string; ends_at: string }) => busy.push([Date.parse(b.starts_at), Date.parse(b.ends_at)]))
    out.push({ ...h, token, busy, perDay: {}, week: mine.length })
    for (const b of mine) { const k = localParts(new Date(b.starts_at), 'Europe/Paris').key; out[out.length - 1].perDay[k] = (out[out.length - 1].perDay[k] || 0) + 1 }
  }
  return out
}
function freeHosts(hosts: Host[], start: number, s: Record<string, number | string | object>) {
  const dur = (s.duration_min as number) * 60000, buf = (s.buffer_min as number) * 60000, tz = s.tz as string
  const lp = localParts(new Date(start), tz)
  return hosts.filter(h => {
    const ranges = ((h.hours || s.hours) as Record<string, string[][]>)[String(lp.wd)] || []
    const inHours = ranges.some(([a, b]) => { const [ah, am] = a.split(':').map(Number), [bh, bm] = b.split(':').map(Number); return start >= localToUtc(lp.y, lp.m, lp.d, ah, am, tz).getTime() && start + dur <= localToUtc(lp.y, lp.m, lp.d, bh, bm, tz).getTime() })
    if (!inHours) return false
    if ((h.perDay[lp.key] || 0) >= (s.max_per_day as number)) return false
    return !h.busy.some(([bs, be]) => start < be + buf && start + dur > bs - buf)
  })
}
async function slots() {
  const cl = await googleClient(); const s = cl.settings
  const now = Date.now(), from = new Date(now + s.min_notice_h * 36e5), to = new Date(now + s.horizon_days * 864e5)
  const hosts = await loadHosts(from, to, cl)
  const step = s.duration_min * 60000, out: string[] = []
  // on parcourt chaque jour, par pas de la durée d'un appel, alignés sur l'heure locale
  for (let day = 0; day <= s.horizon_days; day++) {
    const lp = localParts(new Date(now + day * 864e5), s.tz)
    let t = localToUtc(lp.y, lp.m, lp.d, 0, 0, s.tz).getTime()
    const end = t + 864e5
    for (; t < end; t += step) if (t >= from.getTime() && t <= to.getTime() && freeHosts(hosts, t, s).length) out.push(new Date(t).toISOString())
  }
  return { slots: [...new Set(out)], duration: s.duration_min, tz: s.tz, hosts: hosts.length }
}

async function book(p: { session_id?: string; token?: string; start: string; name?: string; email?: string; phone?: string }) {
  const cl = await googleClient(); const s = cl.settings
  let lead = null, old = null
  if (p.token) { [old] = await db(`bookings?manage_token=eq.${p.token}&select=*`); if (!old) throw new Oops('Rendez-vous introuvable') }
  if (p.session_id) [lead] = await db(`leads?session_id=eq.${encodeURIComponent(p.session_id)}&select=*`)
  const email = (old?.email || lead?.email || p.email || '').trim().toLowerCase()
  const name = old?.name || [lead?.first_name, lead?.last_name].filter(Boolean).join(' ') || p.name || ''
  const phone = old?.phone || lead?.phone || p.phone || ''
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Oops('Email manquant')
  const start = Date.parse(p.start); if (!start || start < Date.now() + s.min_notice_h * 36e5 - 6e4) throw new Oops('Ce créneau n\'est plus disponible')
  const end = start + s.duration_min * 60000
  const hosts = await loadHosts(new Date(start - 864e5), new Date(end + 864e5), cl)
  const free = freeHosts(hosts, start, s); if (!free.length) throw new Oops('Ce créneau vient d\'être pris, choisis-en un autre')
  free.sort((a, b) => a.week - b.week || Math.random() - .5)
  const host = free[0]
  const [prof] = await db(`profiles?id=eq.${host.profile_id}&select=name,first_name,email`)
  const ev = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all', {
    method: 'POST', headers: { Authorization: `Bearer ${host.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: `${s.title} · ${name || email}`,
      description: [`Prospect : ${name}`, `Email : ${email}`, phone && `WhatsApp : ${phone}`, lead?.situation && `Situation : ${lead.situation}`, lead?.budget && `Budget : ${lead.budget}`, lead?.has_capital && `Capital dispo : ${lead.has_capital}`, lead?.offer && `Achat : ${lead.offer}`].filter(Boolean).join('\n'),
      start: { dateTime: new Date(start).toISOString() }, end: { dateTime: new Date(end).toISOString() },
      attendees: [{ email, displayName: name || undefined }],
      conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    }),
  }).then(r => r.json())
  if (!ev.id) throw new Error('Google : ' + JSON.stringify(ev).slice(0, 300))
  const meet = ev.hangoutLink || ev.conferenceData?.entryPoints?.find((x: { entryPointType: string }) => x.entryPointType === 'video')?.uri || null
  if (old) await cancel(old.manage_token, true)
  const [b] = await db('bookings', { method: 'POST', body: JSON.stringify({ lead_id: lead?.id || old?.lead_id || null, host_id: host.profile_id, starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString(), name, email, phone, google_event_id: ev.id, meet_url: meet }) })
  if (b.lead_id) await db(`leads?id=eq.${b.lead_id}`, { method: 'PATCH', body: JSON.stringify({ status: 'rdv', booking_at: b.starts_at }) })
  await rpc('booking_confirmed', { p_id: b.id })
  return { ok: true, starts_at: b.starts_at, host: prof?.first_name || prof?.name, meet_url: meet, token: b.manage_token }
}

async function cancel(token: string, silent = false) {
  const [b] = await db(`bookings?manage_token=eq.${token}&select=*`); if (!b) throw new Oops('Rendez-vous introuvable')
  if (b.status === 'confirme' && b.google_event_id) {
    try { const cl = await googleClient(); const t = await accessToken(b.host_id, cl); if (t) await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${b.google_event_id}?sendUpdates=all`, { method: 'DELETE', headers: { Authorization: `Bearer ${t}` } }) } catch { /* l'événement a peut-être déjà été supprimé */ }
  }
  await db(`bookings?id=eq.${b.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'annule' }) })
  if (!silent) await rpc('booking_cancelled', { p_id: b.id })
  return { ok: true }
}

async function me(req: Request) {
  const r = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: KEY, Authorization: req.headers.get('Authorization') || '' } })
  const u = await r.json(); if (!u?.id) throw new Oops('Connecte-toi d\'abord')
  const [p] = await db(`profiles?id=eq.${u.id}&select=id,role`); if (!p || p.role === 'member') throw new Oops('Réservé à l\'équipe')
  return p.id as string
}
const SCOPES = 'openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const p = await req.json().catch(() => ({}))
    switch (p.action) {
      case 'slots': return json(await slots())
      case 'book': return json(await book(p))
      case 'get': {
        const [b] = await db(`bookings?manage_token=eq.${p.token}&select=starts_at,ends_at,status,meet_url,name,host_id`); if (!b) throw new Oops('Rendez-vous introuvable')
        const [h] = await db(`profiles?id=eq.${b.host_id}&select=name,first_name`)
        return json({ ...b, host_id: undefined, host: h?.first_name || h?.name })
      }
      case 'cancel': return json(await cancel(p.token))
      case 'oauth_url': {
        const uid = await me(req); const cl = await googleClient()
        const u = new URL('https://accounts.google.com/o/oauth2/v2/auth')
        Object.entries({ client_id: cl.id, redirect_uri: p.redirect_uri, response_type: 'code', scope: SCOPES, access_type: 'offline', prompt: 'consent', state: uid }).forEach(([k, v]) => u.searchParams.set(k, v))
        return json({ url: u.toString() })
      }
      case 'oauth_exchange': {
        const uid = await me(req); const cl = await googleClient()
        const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: p.code, client_id: cl.id, client_secret: cl.secret, redirect_uri: p.redirect_uri, grant_type: 'authorization_code' }) })
        const j = await r.json(); if (!j.refresh_token) throw new Oops('Google n\'a pas donné l\'accès : ' + (j.error_description || j.error || 'réessaie'))
        let email = ''; try { email = JSON.parse(atob(j.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email } catch { /* */ }
        await db('agenda_tokens', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ profile_id: uid, refresh_token: j.refresh_token, updated_at: new Date().toISOString() }) })
        await db('agenda_hosts', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ profile_id: uid, google_email: email, connected_at: new Date().toISOString(), active: true }) })
        return json({ ok: true, email })
      }
      default: return json({ error: 'action inconnue' }, 400)
    }
  } catch (e) {
    return json({ error: e instanceof Oops ? e.message : 'Erreur, réessaie dans un instant', detail: e instanceof Oops ? undefined : String(e).slice(0, 300) }, e instanceof Oops ? 400 : 500)
  }
})
