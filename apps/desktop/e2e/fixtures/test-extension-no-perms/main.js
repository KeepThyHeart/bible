/**
 * Acceptance fixture (test-extension-no-perms).
 *
 * Declares NO permissions. The activate() body deliberately tries to call
 * `api.bible.getVerse(43003016)` so the host's permission guard rejects it
 * with `PermissionDeniedError` (the api-impl gates on `bible:read`). The
 * outcome is captured in storage so an external test can assert "the gate
 * fired" without needing the worker exit code.
 *
 * The equivalent shape for the notes API is `api.notes.create(...)` gated on
 * `notes:write`. The principle is the same.
 */

module.exports = {
  async activate(api) {
    try {
      await api.ui.showNotification('this should be denied');
      // If we reach this line the host failed to enforce the gate. Persist
      // a failure marker so the test can assert against it.
      try {
        await api.storage.set('permissionGateOutcome', 'leaked');
      } catch (_e) {
        /* swallow */
      }
    } catch (err) {
      const code = err && err.code ? err.code : 'UnknownError';
      try {
        await api.storage.set('permissionGateOutcome', 'denied');
        await api.storage.set('permissionGateErrorCode', String(code));
      } catch (_e) {
        /* swallow */
      }
    }
  },

  async deactivate() {
    /* nothing to clean up */
  },
};
