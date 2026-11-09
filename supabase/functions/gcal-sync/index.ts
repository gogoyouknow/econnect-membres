// Synchronise l'agenda Google de Clément (adresse iCal secrète) → table busy_times, pour exclure les créneaux déjà pris.
// Appelée par la base toutes les 10 min (pg_cron) et après chaque réservation, avec le jeton partagé x-push-token.
import ICAL from 'npm:ical.js@2.1.0'

const URL = Deno.env.get('SUPABASE_URL')!, SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const rpc = async (fn: string, args: Record<string, unknown> = {}) => {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${await r.text()}`)
  const t = await r.text(); return t ? JSON.parse(t) : null
}

Deno.serve(async (req) => {
  try {
    const token = req.headers.get('x-push-token') ?? ''
    await rpc('push_payload', { p_token: token, p_user: '00000000-0000-0000-0000-000000000000' })   // vérifie le jeton
    // Connexion directe Google (prioritaire) : créneaux occupés via l'API freeBusy
    const oc = await rpc('gcal_oauth_for_fn')
    if (oc?.refresh && oc.client_id && oc.client_secret) {
      const tk = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: oc.client_id, client_secret: oc.client_secret, refresh_token: oc.refresh, grant_type: 'refresh_token' }) })
      const tj = await tk.json()
      if (!tk.ok || !tj.access_token) throw new Error('Google : ' + (tj.error_description || tj.error || tk.status))
      const fb = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', { method: 'POST', headers: { Authorization: `Bearer ${tj.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeMin: new Date(Date.now() - 86400000).toISOString(), timeMax: new Date(Date.now() + 14 * 86400000).toISOString(), timeZone: 'Europe/Paris', items: [{ id: 'primary' }] }) })
      const fj = await fb.json()
      if (!fb.ok) throw new Error('freeBusy : ' + (fj.error?.message || fb.status))
      const busyG = ((fj.calendars?.primary?.busy ?? []) as { start: string, end: string }[]).map(b => ({ s: b.start, e: b.end, t: 'Occupé' }))
      const nG = await rpc('gcal_replace_busy_for_fn', { p: busyG })
      return Response.json({ ok: true, mode: 'google', events: busyG.length, stored: nG })
    }
    const ics = await rpc('gcal_ics_for_fn')
    if (!ics) return Response.json({ ok: false, error: 'pas d\'adresse iCal' })
    const txt = await fetch(ics, { headers: { 'User-Agent': 'laccelerateur-rdv/1.0' } }).then(r => { if (!r.ok) throw new Error(`iCal ${r.status}`); return r.text() })
    const comp = new ICAL.Component(ICAL.parse(txt))
    // fuseaux déclarés dans le fichier
    for (const tz of comp.getAllSubcomponents('vtimezone')) { const id = tz.getFirstPropertyValue('tzid'); if (id && !ICAL.TimezoneService.has(id)) ICAL.TimezoneService.register(id, new ICAL.Timezone({ component: tz, tzid: id })) }
    const from = ICAL.Time.fromJSDate(new Date(Date.now() - 86400000), true), to = ICAL.Time.fromJSDate(new Date(Date.now() + 14 * 86400000), true)
    const busy: { s: string, e: string, t: string }[] = []
    for (const ve of comp.getAllSubcomponents('vevent')) {
      const ev = new ICAL.Event(ve)
      if (ev.getFirstPropertyValue?.('transp') === 'TRANSPARENT' || ve.getFirstPropertyValue('transp') === 'TRANSPARENT') continue   // « disponible » dans Google
      if (ve.getFirstPropertyValue('status') === 'CANCELLED') continue
      const push = (s: ICAL.Time, e: ICAL.Time) => { if (s.isDate) return; busy.push({ s: s.toJSDate().toISOString(), e: e.toJSDate().toISOString(), t: String(ev.summary || '') }) }
      if (ev.isRecurring()) {
        const it = ev.iterator(); let n = 0, next
        while ((next = it.next()) && n++ < 500) { if (next.compare(to) > 0) break; const d = ev.getOccurrenceDetails(next); if (d.endDate.compare(from) < 0) continue; push(d.startDate, d.endDate) }
      } else { if (ev.endDate.compare(from) < 0 || ev.startDate.compare(to) > 0) continue; push(ev.startDate, ev.endDate) }
    }
    const n = await rpc('gcal_replace_busy_for_fn', { p: busy })
    return Response.json({ ok: true, events: busy.length, stored: n })
  } catch (e) { return Response.json({ ok: false, error: (e as Error).message }, { status: 500 }) }
})
