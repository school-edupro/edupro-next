/*
 * App-shell service worker (S5-08, extended S11): the shell and static assets are cached; pages are network
 * first with the last copy as fallback; when nothing is cached the /offline page is shown instead of a
 * browser error. Sprint 21 (VAPT readiness): responses marked no-store are never kept, and a sign-out
 * message from the page clears the whole cache so personal pages do not outlive the session.
 */
const CACHE = 'edupro-shell-v3';
const SHELL = ['/', '/login', '/offline', '/manifest.webmanifest', '/icons/icon.svg'];
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    // immutable assets: cache first
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches
              .open(CACHE)
              .then((cache) => cache.put(req, copy))
              .catch(() => undefined);
            return res;
          }),
      ),
    );
    return;
  }
  event.respondWith(
    fetch(req)
      .then((res) => {
        const cc = res.headers.get('cache-control') || '';
        if (res.ok && req.mode === 'navigate' && !/no-store/i.test(cc)) {
          const copy = res.clone();
          caches
            .open(CACHE)
            .then((cache) => cache.put(req, copy))
            .catch(() => undefined);
        }
        return res;
      })
      .catch(() =>
        caches
          .match(req)
          .then(
            (hit) =>
              hit ||
              (req.mode === 'navigate' ? caches.match('/offline') : undefined) ||
              caches.match('/'),
          ),
      ),
  );
});
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'edupro:signed-out') {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});

/* Push notifications (Firebase): show the school's message; a tap opens the app at its link. */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { notification: { title: 'School', body: event.data ? event.data.text() : '' } };
  }
  const n = data.notification || {};
  const link =
    (data.fcmOptions && data.fcmOptions.link) || (data.data && data.data.link) || '/messages';
  event.waitUntil(
    self.registration.showNotification(n.title || 'School', {
      body: n.body || '',
      icon: n.icon || '/icons/icon.svg',
      badge: '/icons/icon.svg',
      data: { link },
    }),
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/messages';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) {
          w.navigate(link);
          return w.focus();
        }
      }
      return self.clients.openWindow(link);
    }),
  );
});
