const CACHE_VERSION = 'damage-calculator-v3';
const SHELL_CACHE = CACHE_VERSION + '-shell';
const RUNTIME_CACHE = CACHE_VERSION + '-runtime';
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-512-maskable.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Cache required app files first. Icons are optional so a missing icon
    // cannot prevent the service worker from installing.
    await cache.addAll(['./', './index.html', './manifest.webmanifest']);
    await Promise.all(APP_SHELL.filter(path => path.startsWith('./icons/')).map(async path => {
      try { await cache.add(path); } catch (_) { /* optional icon unavailable */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('damage-calculator-') && key !== SHELL_CACHE && key !== RUNTIME_CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

async function trimRuntimeCache() {
  const cache = await caches.open(RUNTIME_CACHE);
  const keys = await cache.keys();
  if (keys.length > 80) {
    for (const request of keys.slice(0, keys.length - 80)) await cache.delete(request);
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate') {
      event.respondWith(fetch(request).then(response => {
        const copy = response.clone();
        caches.open(SHELL_CACHE).then(cache => cache.put('./index.html', copy));
        return response;
      }).catch(async () => (await caches.match(request)) || (await caches.match('./index.html'))));
    } else {
      event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
        if (response && response.ok) caches.open(SHELL_CACHE).then(cache => cache.put(request, response.clone()));
        return response;
      }).catch(() => caches.match(request))));
    }
  } else {
    // Cache successfully fetched CDN assets, map tiles and location-list responses for later use.
    event.respondWith(caches.open(RUNTIME_CACHE).then(async cache => {
      const cached = await cache.match(request);
      try {
        const response = await fetch(request);
        if (response && (response.ok || response.type === 'opaque')) {
          cache.put(request, response.clone()).then(trimRuntimeCache).catch(() => {});
        }
        return response;
      } catch (error) {
        if (cached) return cached;
        throw error;
      }
    }));
  }
});
