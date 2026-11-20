// Offline cache: the app works without internet against bots.
const V = 'banana-v16';
const FILES = ['./', 'index.html', 'styles.css', 'manifest.json', 'src/app.js', 'src/engine.js', 'src/bot.js', 'src/host.js', 'src/cards.js', 'src/net.js', 'icons/icon-192.png', 'icons/icon-512.png', 'src/store.js', 'src/config.js', 'src/fx.js', 'src/learn.js', 'src/avatars.js', ...[1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15].map((i) => `avatars/p${i}.webp`), 'cards/logo.webp', 'cards/wordmark.webp', 'cards/bg-jungle.webp', ...['wood', 'purple', 'blue', 'black', 'green', 'teal'].map((t) => `cards/table-${t}.webp`), ...['n0','n1','n2','n3','n4','n5','n6','n7','n8','n9','n10','n15','n20','n25','minus','choose','buzz','clear','copy','extra','freeze','golden','guard','plus','tornado','back','curse','swap'].map((n) => `cards/${n}.webp`)];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.origin === location.origin) {
    // network first so updates arrive; cache as fallback
    e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(V).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
  } else if (u.host.includes('fonts.g')) {
    e.respondWith(caches.match(e.request).then((m) => m || fetch(e.request).then((r) => { const cp = r.clone(); caches.open(V).then((c) => c.put(e.request, cp)); return r; })));
  }
});
