// NNF staff web — service worker for Web Push.
// Served from / so scope covers every route.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try { data = event.data.json(); }
  catch (_) { data = { title: 'NNF', body: event.data.text() }; }

  const title = data.title || 'NNF';
  const queueId = data.data && data.data.queue_id;
  const options = {
    body: data.body || '',
    icon: '/nnf-favicon.svg',
    badge: '/nnf-favicon.svg',
    tag: 'nnf-' + (queueId != null ? queueId : Date.now()),
    data: data.data || {},
    requireInteraction: false,
    renotify: true,
    vibrate: [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

function routeFor(data) {
  const eventType = (data && data.event_type) || '';
  const contractIds = (data && data.contract_ids) || [];
  const firstContract = contractIds[0];

  if (eventType === 'chat_to_staff' || eventType === 'chat_to_customer') {
    return firstContract ? `/admin/chat?contract=${firstContract}` : '/admin/chat';
  }
  if (eventType.startsWith('slip_')) {
    return '/admin/payment-submissions';
  }
  return '/admin';
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const path = routeFor(data);
  const targetUrl = new URL(path, self.location.origin).href;

  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) {
      let u;
      try { u = new URL(c.url); } catch (_) { continue; }
      if (u.origin !== self.location.origin) continue;
      await c.focus();
      try {
        await c.navigate(targetUrl);
      } catch (_) {
        // SW does not control this client — fall back to postMessage so the
        // page-side listener in src/lib/api/push.ts can route via react-router.
        c.postMessage({
          type: 'navigate',
          url: targetUrl,
          eventType: data.event_type,
          contractId: (data.contract_ids || [])[0],
        });
      }
      return;
    }
    if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
  })());
});
