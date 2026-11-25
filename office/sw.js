// The old office's offline worker, retired (batch (a), 25 Nov): the Day Book, deposits, close, report, accounts, starting data and
// buses pages moved to the game, so phones must stop serving their cached copies. This version takes over at once, deletes every
// cache, unregisters itself and reloads the pages it controlled (so they load the new redirect stubs from the network). A page
// that still registers it (office/js/shell.js on the pages that stay) just installs and unregisters it again; it reloads pages
// only when it actually cleared a cache, so nothing loops.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.registration.unregister();
    if (!keys.length) return;
    const pages = await self.clients.matchAll({ type: 'window' });
    await Promise.all(pages.map((c) => c.navigate(c.url).catch(() => {})));
  })());
});
