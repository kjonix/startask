// StarTask Service Worker — push-varsler og PWA-støtte

const CACHE_NAME = 'startask-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

// Push-varsel fra Azure
self.addEventListener('push', function(event) {
  let data = { title: '⭐ StarTask', body: 'Husk å sjekke oppgavene!' };
  try { data = event.data.json(); } catch(e) {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      vibrate: [200, 100, 200, 100, 200],
      requireInteraction: false,
      tag: 'startask-reminder',
      renotify: true,
      data: { url: self.location.origin }
    })
  );
});

// Bruker trykker på varselet
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
