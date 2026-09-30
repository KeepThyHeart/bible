/*
 * Keep Thy Heart service-worker kill switch.
 *
 * The server hands this file out at /sw.js (and at /sw-kill.js) whenever
 * `features.pwa` is off. Browsers re-fetch a worker script on every navigation,
 * bypassing the HTTP cache, so this is the one channel that reaches a client
 * whose installed worker has wedged it. It registers no fetch handler, so while
 * it is alive every request goes straight to the network; it clears the shell
 * and content caches and then unregisters itself.
 *
 * Plain JS on purpose: it is copied verbatim from public/ and must never depend
 * on the bundle it exists to replace. KEEP_CACHES must equal `preservedOnReset`
 * of the rule registry in src/sw/cacheRules.ts (a unit test enforces it).
 */
self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    var KEEP_CACHES = ['transformers-cache', 'embedding-model-v1', 'semantic-index-v1', 'audio-manifests-v1', 'audio-chapters-v1', 'tts-models-v1'];
    try {
      var names = await caches.keys();
      await Promise.all(names.map(function (n) {
        return KEEP_CACHES.indexOf(n) === -1 ? caches.delete(n) : Promise.resolve(false);
      }));
    } catch (e) { /* best effort: unregistering matters more */ }
    await self.registration.unregister();
  })());
});
