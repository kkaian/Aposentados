// Notificações (Web Push): carregado pelo service worker gerado pelo vite-plugin-pwa
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'Aposentados FC', body: event.data?.text() }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Aposentados FC', {
      body: data.body || '',
      icon: '/pwa-192x192.png',
      badge: '/favicon.png',
      data: { url: data.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(self.location.origin))
      if (open) return open.focus().then((c) => c.navigate(url))
      return self.clients.openWindow(url)
    }),
  )
})
