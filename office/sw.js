// App-shell cache only. Cache-first for the files below; everything else (including every
// script.google.com / googleusercontent.com request and file.view response) goes straight to the network.
// Bump CACHE when any shell file changes. Later tasks add their screens (report/deposits/close/daybook) to SHELL.
const CACHE = 'lmcs-office-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'js/shell.js', 'js/today.js', 'js/api.js', 'js/outbox.js', 'js/idb-store.js', 'js/format.js', 'js/config.js',
  '../assets/style.css', '../assets/auth.js', '../assets/img/lms-logo.png',
];
const shellUrls = new Set(SHELL.map((p) => new URL(p, self.location).href));

// The cache key for a request the shell may serve, or null (cross-origin, non-GET, not a shell file).
function shellHref(req) {
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return null;
  const href = url.origin + url.pathname; // ignore ?query on shell files
  return shellUrls.has(href) ? href : null;
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const href = shellHref(e.request);
  if (!href) return;
  e.respondWith(caches.match(href).then((hit) => hit || fetch(e.request)));
});
