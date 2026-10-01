// ===== Service Worker · resiliencia y caché offline =====
// Estrategia: Stale-While-Revalidate para los recursos de la app (mismo origen).
// Sirve al instante desde la caché y, en segundo plano, actualiza con la red.
// Esto garantiza que la app cargue aunque no haya internet (offline-first).

'use strict';

const CACHE = 'conversor-v1';

// App shell: se precachea al instalar para asegurar el funcionamiento offline.
const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/geometry.js',
  './js/viewer.js',
  './js/db.js',
  './js/main.js',
  './js/worker-conversion.js',
];

// Instalación: precachear el shell.
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

// Activación: eliminar cachés de versiones anteriores.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(
        claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: Stale-While-Revalidate para peticiones GET del mismo origen.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const enCache = await cache.match(req);
      const desdeRed = fetch(req)
        .then((res) => {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        })
        .catch(() => enCache); // sin red: usar lo cacheado
      // Servir cache al instante; si no hay, esperar la red.
      return enCache || desdeRed;
    })
  );
});
