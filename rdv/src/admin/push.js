import { supabase } from './supabase'

const b64ToU8 = (s) => { const p = '='.repeat((4 - s.length % 4) % 4); const b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...b].map((c) => c.charCodeAt(0))) }
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
const iOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)

/** Cet appareil reçoit-il déjà les notifications ? */
export async function pushState() {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  try { const reg = await navigator.serviceWorker.getRegistration('/'); const sub = reg && await reg.pushManager.getSubscription(); return sub ? 'on' : 'off' } catch { return 'off' }
}

export async function enablePush(userId) {
  if (!pushSupported()) throw new Error('Notifications indisponibles sur ce navigateur')
  if (iOS() && !standalone()) throw new Error("Sur iPhone, ouvre Calio depuis l'icône de ton écran d'accueil")
  const { data: key } = await supabase.rpc('vapid_public_key')
  if (!key) throw new Error("Notifications en cours d'activation côté serveur, réessaie dans quelques minutes")
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Notifications refusées dans les réglages')
  await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) })
  const j = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert({ user_id: userId, endpoint: j.endpoint, keys: j.keys, app: 'calio' }, { onConflict: 'endpoint' })
  if (error) throw error
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration('/'); const sub = reg && await reg.pushManager.getSubscription()
  if (sub) { await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe() }
}
