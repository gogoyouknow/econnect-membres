// Service worker de Calio : reçoit les notifications push et ouvre l'application au toucher.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch { d = { body: event.data && event.data.text() } }
  event.waitUntil(self.registration.showNotification(d.title || 'Calio', {
    body: d.body || '', icon: '/icon-192.png', badge: '/icon-192.png', data: { url: d.url || '/admin' }, tag: d.tag || undefined
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL((event.notification.data && event.notification.data.url) || '/admin', self.location.origin).href
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    // L'appli est déjà ouverte : on lui dit où aller (sans la recharger), puis on la met au premier plan.
    for (const c of list) {
      if (c.url.startsWith(self.location.origin + '/admin') && 'focus' in c) {
        c.postMessage({ type: 'calio-open', url })
        return c.focus().catch(() => {})
      }
    }
    return self.clients.openWindow(url)
  }))
})
