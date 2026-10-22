// FFWB service worker: phone notifications, and a saved copy of the site so it opens on bad signal.
// Pages, scripts and league data are fetched fresh when the network answers quickly, and come from the saved
// copy when it does not. Images, fonts and the chart library are served from the copy and refreshed behind.
const CACHE = 'ffwb-v5';
const CORE = ['/', '/index.html', '/js/errors.js', '/css/site.css', '/manifest.webmanifest', '/brand/crest.svg', '/icons/icon-192.png',
  '/data/season.js', '/data/history.js', '/data/releases.js', '/js/whatsnew.js', '/js/reveal.js', '/js/rules.js', '/js/cups.js', '/js/awards.js', '/js/link.js', '/js/shim.js', '/js/shame.js', '/js/app.js', '/js/fun.js', '/js/badges.js',
  '/js/more.js', '/js/layout.js', '/js/explore.js', '/js/profile.js', '/js/cupsui.js', '/js/cupsplash.js', '/js/planner.js', '/js/picks.js', '/js/home.js', '/js/alerts.js', '/js/polish.js'];

const D3 = 'https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    await c.addAll(CORE).catch(() => {});
    // The chart library, saved up front so charts draw offline.
    try { const r = await fetch(D3, { mode: 'cors' }); if (r.ok) await c.put(D3, r); } catch (err) { /* fetched again later */ }
  }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const timeout = (ms) => new Promise((_, no) => setTimeout(() => no(new Error('slow')), ms));
async function networkFirst(req, ms) {
  const cache = await caches.open(CACHE);
  try {
    const res = await Promise.race([fetch(req), timeout(ms)]);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    if (req.mode === 'navigate') { const home = await cache.match('/'); if (home) return home; }
    throw err;
  }
}
async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const fresh = fetch(req).then((res) => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await fresh) || Response.error();
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  if (same && url.pathname.startsWith('/api/')) {
    // Only the season is worth keeping offline; everything else goes straight to the server.
    if (url.pathname === '/api/season') e.respondWith(networkFirst(req, 4000));
    return;
  }
  if (same && (url.pathname.startsWith('/brand/') || url.pathname.startsWith('/icons/'))) { e.respondWith(cacheFirst(req)); return; }
  if (!same && /fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com/.test(url.host)) { e.respondWith(cacheFirst(req)); return; }
  if (same) e.respondWith(networkFirst(req, 2500));
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (err) { data = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'FFWB', {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || undefined,
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of open) if (new URL(c.url).origin === self.location.origin) { await c.focus(); return c.navigate(url); }
    return self.clients.openWindow(url);
  })());
});
