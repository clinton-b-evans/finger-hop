// Service worker: precaches the app shell + sprites, and caches the MediaPipe
// bundle / WASM / model from the CDN the first time they are fetched.
// Bump VERSION whenever app files change.

const VERSION = 'v3';
const APP_CACHE = `fingerhop-app-${VERSION}`;
const CDN_CACHE = 'fingerhop-cdn-v1'; // versioned URLs, safe to keep across app versions

const SPRITES = [
  'fox_idle', 'fox_crouch', 'fox_jump', 'fox_land', 'fox_cheer', 'fox_wave',
  'tile_grass', 'tile_sand', 'tile_water', 'tile_stone', 'tile_number', 'tile_bridge',
  'strawberry', 'star', 'chest', 'bush', 'tree', 'flowers',
];
// Keep in sync with src/sounds.js
const SFX = ['boing', 'land', 'collect', 'splash', 'fanfare', 'oops', 'ready', 'lock', 'tap', 'star'];
const APP_FILES = [
  './',
  'index.html',
  'style.css',
  'manifest.webmanifest',
  'levels/levels.json',
  'src/main.js',
  'src/game.js',
  'src/render.js',
  'src/hands.js',
  'src/audio.js',
  'src/levels.js',
  'src/sounds.js',
  ...SPRITES.map((s) => `assets/${s}.png`),
  ...SFX.map((s) => `assets/sfx/${s}.wav`),
];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'storage.googleapis.com'];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser HTTP cache (GitHub Pages sends max-age=600) so a new
  // VERSION really fetches the new files.
  e.waitUntil(
    caches
      .open(APP_CACHE)
      .then((c) => c.addAll(APP_FILES.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith('fingerhop-') && k !== APP_CACHE && k !== CDN_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (CDN_HOSTS.includes(url.hostname)) {
    // Cache-first: these URLs are pinned to a version.
    e.respondWith(
      caches.open(CDN_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (url.origin === self.location.origin) {
    // Stale-while-revalidate for the app itself.
    e.respondWith(
      caches.open(APP_CACHE).then(async (cache) => {
        const hit = await cache.match(req, { ignoreSearch: true });
        const net = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || net;
      }),
    );
  }
});
