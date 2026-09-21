/**
 * Acceptance fixture (test-extension-no-perms).
 *
 * Declares none of the permissions it exercises. The activate() body
 * deliberately calls a gated API so the host's permission guard rejects it
 * with `PermissionDeniedError`. The outcome is captured in storage so an
 * external test can assert "the gate fired" without needing the worker exit
 * code.
 *
 * `storage` IS declared, and has to be: the KV tier is itself gated on it, so
 * without it the fixture would have no way to report the very denial it
 * exists to prove. That does not weaken the fixture - the gate under test is
 * a different permission.
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
