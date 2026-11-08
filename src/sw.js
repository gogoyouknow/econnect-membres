import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
import { NetworkFirst } from 'workbox-strategies'
import { clientsClaim } from 'workbox-core'

self.skipWaiting()
clientsClaim()
cleanupOutdatedCaches()

// Les ouvertures de page passent d'abord par le réseau (jamais par le cache des fichiers) :
// évite l'écran « code source » d'iOS quand son cache mélange les fichiers, et garantit la dernière version.
registerRoute(new NavigationRoute(new NetworkFirst({
  cacheName: 'pages',
  networkTimeoutSeconds: 4,
  plugins: [{ cacheWillUpdate: async ({ response }) => (response && response.ok && /text\/html/.test(response.headers.get('content-type') || '')) ? response : null }]
})))
precacheAndRoute(self.__WB_MANIFEST)

// Notifications push (Web Push). Le serveur envoie { title, body, url }.
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data && event.data.text() } }
  const title = data.title || "L'Accélérateur"
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
      tag: data.tag || undefined,
      renotify: Boolean(data.tag)
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const raw = (event.notification.data && event.notification.data.url) || '/'
  // résolu contre la racine de l'app (sinon « #co/12 » devenait « /sw.js#co/12 » : le code du service worker s'affichait)
  const url = new URL(raw.startsWith('#') ? '/' + raw : raw, self.registration.scope).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) { c.navigate(url); return c.focus() } }
      return self.clients.openWindow(url)
    })
  )
})
