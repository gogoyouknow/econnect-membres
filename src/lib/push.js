import { supabase } from './supabase'

const b64ToU8 = (s) => { const p = '='.repeat((4 - s.length % 4) % 4); const b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...b].map(c => c.charCodeAt(0))) }

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)

export async function enablePush(userId) {
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (!pushSupported()) throw new Error('Les notifications ne sont pas disponibles sur ce navigateur')
  if (isIOS() && !isStandalone()) throw new Error("Sur iPhone, ajoute d'abord l'app à ton écran d'accueil")
  if (!key) throw new Error('Notifications pas encore configurées côté serveur')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Notifications refusées')
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) })
  const j = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert({ user_id: userId, endpoint: j.endpoint, keys: j.keys }, { onConflict: 'endpoint' })
  if (error) throw error
  return true
}
