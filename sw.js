const CACHE = 'stockvoz-v2';
const ASSETS = [
  '/',
  '/app.html',
  '/app.css',
  '/app.js',
  '/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// Estrategia: cache-first para nuestros propios archivos (mismo origen).
// Las peticiones al CDN de transformers.js / modelo Whisper (jsdelivr)
// las gestiona la propia librería con su caché interna (Cache Storage API,
// env.useBrowserCache=true), por lo que aquí simplemente las dejamos pasar
// sin interferir, para no duplicar la caché de varios GB del modelo.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);
  const isSameOrigin = url.origin === self.location.origin;

  if (!isSameOrigin) return; // deja pasar CDN externo (jsdelivr) sin interceptar

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match('/app.html'));
    })
  );
});
