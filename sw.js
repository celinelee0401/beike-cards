// 離線快取：有網路時抓最新版，沒網路時用上次存下來的
const CACHE = 'beike-cards-v2';
const ASSETS = [
  './', './index.html', './css/style.css', './manifest.webmanifest', './icons/icon.svg', './icons/icon-180.png', './icons/icon-512.png',
  './js/main.js', './js/util.js', './js/db.js', './js/store.js', './js/view.js', './js/camera.js', './js/modals.js', './js/export.js', './js/ink.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});
