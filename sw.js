// StarTask Service Worker — håndterer push-varsler

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Mottar push-varsel fra Azure
self.addEventListener('push', function(event) {
  let data = { title: '⭐ StarTask', body: 'Husk å sjekke oppgavene!', taskName: '' };
  try { data = event.data.json(); } catch(e) {}

  const options = {
    body: data.body,
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">⭐</text></svg>',
    badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">⭐</text></svg>',
    vibrate: [200, 100, 200, 100, 200],
    requireInteraction: false,
    tag: 'startask-reminder',
    renotify: true,
    data: { url: self.location.origin + self.location.pathname }
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Bruker trykker på varselet — åpner appen
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (const client of clientList) {
        if (client.url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(event.notification.data.url || '/');
    })
  );
});
