// App-shell cache only, for working offline. Network-first for the files below (revalidated, so a release
// shows at once; the cached copy is used only when the network fails); everything else (including every
// script.google.com / googleusercontent.com request and file.view response) goes straight to the network.
// Bumping CACHE is no longer needed for updates; bump it only to drop old cached copies.
const CACHE = 'lmcs-office-v9';
const SHELL = [
  './', 'index.html', 'daybook.html', 'report.html', 'deposits.html', 'close.html', 'office.css', 'manifest.webmanifest',
  'js/shell.js', 'js/today.js', 'js/dom.js', 'js/daybook.js', 'js/report.js', 'js/deposits.js', 'js/close.js', 'js/attention.js', 'js/codes.js', 'js/image.js', 'js/api.js', 'js/outbox.js', 'js/idb-store.js', 'js/format.js', 'js/config.js',
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
  e.respondWith(fetch(e.request, { cache: 'no-cache' })
    .then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(href, copy)); } return res; })
    .catch(() => caches.open(CACHE).then((c) => c.match(href)).then((hit) => hit || Response.error())));
});
