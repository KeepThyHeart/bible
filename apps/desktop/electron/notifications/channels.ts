/**
 * Main -> renderer channels of the notifications engine. They are the Notifications module's event
 * channels (`module:notifications:event:<name>`, see `modules/moduleIpc.ts`), written out here so the
 * engine does not depend on the module: with the module off nobody listens, and the sends are no-ops.
 */
export const NOTIFICATIONS_STATE_CHANGED_CHANNEL = 'module:notifications:event:state-changed';
export const NOTIFICATIONS_OPEN_TARGET_CHANNEL = 'module:notifications:event:open-target';
