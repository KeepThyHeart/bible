/**
 * Acceptance fixture (test-extension).
 *
 * 1. Activates and registers the `ext.test.bible-viewer` panel type.
 * 2. Reads John 3:16 via `api.bible.getVerse(43003016)`.
 * 3. Persists `lastVerse=43003016` via `api.storage.set` so an external
 *    assertion can confirm the row landed in `extension_storage`.
 * 4. Calls `api.ui.showNotification('hello')` so the renderer's notification
 *    stack picks it up.
 *
 * The companion `index.html` re-reads the same verse from inside the iframe
 * once the postMessage bridge channel is wired.
 */

module.exports = {
  async activate(api) {
    try {
      const verse = await api.bible.getVerse(43003016);
      await api.storage.set('lastVerse', verse ? verse.verseId : 43003016);
      await api.storage.set('activatedAt', Date.now());
      try {
        await api.ui.showNotification('hello from test-extension');
      } catch (_e) {
        // Notification surface may not be wired in every harness - never block
        // activation on it.
      }
      try {
        await api.ui.registerPanelType({
          id: 'viewer',
          title: 'Test Bible Viewer',
          uiEntry: './index.html',
        });
      } catch (_e) {
        // Already declared in extension.json contributes - registerPanelType
        // is the dynamic equivalent and may no-op for already-known ids.
      }
    } catch (err) {
      throw new Error(
        'test-extension activate() failed: ' + (err && err.message ? err.message : String(err)),
      );
    }
  },

  async deactivate() {
    /* nothing to clean up */
  },
};
