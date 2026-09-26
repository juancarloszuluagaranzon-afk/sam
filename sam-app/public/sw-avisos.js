/*
 * Avisos al celular (25-sep-2026). Lo importa el service worker que genera
 * vite-plugin-pwa (`workbox.importScripts` en vite.config.ts): aquí solo se
 * reciben y se muestran las notificaciones que manda la función `avisos-finca`.
 *
 * La carga útil viene cifrada de punta a punta: { titulo, cuerpo, tag, url }.
 * `tag` agrupa por finca (la notificación nueva reemplaza a la anterior en vez de
 * apilar veinte), y `renotify` hace que igual suene.
 */
self.addEventListener('push', (evento) => {
  let d = {}
  try { d = evento.data ? evento.data.json() : {} } catch (e) { d = { cuerpo: evento.data ? evento.data.text() : '' } }
  const titulo = d.titulo || 'AgroMorales'
  evento.waitUntil(self.registration.showNotification(titulo, {
    body: d.cuerpo || 'Hay novedades en su finca.',
    tag: d.tag || 'finca',
    renotify: true,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    data: { url: d.url || '/' },
  }))
})

// Tocar la notificación abre la app (o la trae al frente si ya estaba abierta).
self.addEventListener('notificationclick', (evento) => {
  evento.notification.close()
  const url = (evento.notification.data && evento.notification.data.url) || '/'
  evento.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const v of ventanas) {
      if ('focus' in v) {
        // Recargar trae lo último (la ventana pudo llevar horas abierta).
        try { await v.navigate(v.url) } catch (e) { /* algunas plataformas no dejan navegar */ }
        return v.focus()
      }
    }
    return self.clients.openWindow(url)
  })())
})
