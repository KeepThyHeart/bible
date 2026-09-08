/**
 * Minimal extension fixture.
 *
 * Demonstrates the smallest useful extension surface:
 *   1. activate() resolves successfully
 *   2. Reads John 3:16 via api.bible.getVerse()
 *   3. Persists `lastVerse=43003016` via api.storage.set() so an external
 *      assertion can confirm the storage row landed in `extension_storage`
 *
 * This file runs inside the extension worker (utilityProcess). The host loads
 * it via require() after the extension-runtime bundle calls runtime.init.
 */

module.exports = {
  async activate(api) {
    try {
      const verse = await api.bible.getVerse(43003016);
      await api.storage.set('lastVerse', verse ? verse.verseId : 43003016);
      await api.storage.set('activatedAt', Date.now());
    } catch (err) {
      // Surface to the host so it appears in the lifecycle log.
      throw new Error('minimal-extension activate() failed: ' + (err && err.message ? err.message : String(err)));
    }
  },

  async deactivate() {
    /* nothing to clean up */
  },
};
