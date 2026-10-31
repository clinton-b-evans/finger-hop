// Service worker: precaches the app (code, data, images) so it works offline, caches the
// game audio and the MediaPipe files on first use, and never caches source masters.
// Bump VERSION whenever app files change.

const VERSION = 'v4';
const APP_CACHE = `fingerhop-app-${VERSION}`;
const AUDIO_CACHE = `fingerhop-audio-${VERSION}`;
const CDN_CACHE = 'fingerhop-cdn-v1'; // versioned URLs, safe to keep across app versions

const IMAGES = [
  // world
  'tile_grass', 'tile_sand', 'tile_water', 'tile_stone', 'tile_number', 'tile_bridge',
  'strawberry', 'gem', 'heart', 'star', 'star_alt', 'chest',
  'rock', 'bush', 'tree', 'flowers', 'mushroom', 'flower_tulip',
  // characters
  'fox_idle', 'fox_crouch', 'fox_jump', 'fox_land', 'fox_cheer', 'fox_wave',
  'wolf_idle', 'wolf_jump', 'bear_idle', 'bear_jump',
  // outfits
  'hat_party', 'hat_crown', 'hat_pirate', 'hat_wizard',
  'wear_cape', 'wear_sunglasses', 'wear_scarf', 'wear_mask',
];
const APP_FILES = [
  './',
  'index.html',
  'style.css',
  'manifest.webmanifest',
  'levels/levels.json',
  'assets/characters.json',
  'src/main.js',
  'src/game.js',
  'src/render.js',
  'src/hands.js',
  'src/audio.js',
  'src/sounds.js',
  'src/levels.js',
  'src/characters.js',
  'src/wardrobe.js',
  ...IMAGES.map((s) => `assets/${s}.png`),
];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'storage.googleapis.com'];
// Never cached: full-quality source audio and licence PDFs (not used by the game).
const NEVER_CACHE = ['/assets/audio/masters/', '/assets/licences/'];

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
  const keep = new Set([APP_CACHE, AUDIO_CACHE, CDN_CACHE]);
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fingerhop-') && !keep.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Cache-first: serve from cache, otherwise fetch and remember. */
async function cacheFirst(cacheName, req) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

/** Stale-while-revalidate: answer from cache, refresh in the background. */
async function staleWhileRevalidate(cacheName, req) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: true });
  const net = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || net;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (CDN_HOSTS.includes(url.hostname)) return e.respondWith(cacheFirst(CDN_CACHE, req));
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE.some((p) => url.pathname.includes(p))) return; // straight to the network
  // Audio: only the format this device actually plays gets fetched, so cache on first use.
  if (url.pathname.includes('/assets/audio/')) return e.respondWith(cacheFirst(AUDIO_CACHE, req));
  e.respondWith(staleWhileRevalidate(APP_CACHE, req));
});
