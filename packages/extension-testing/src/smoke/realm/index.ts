/**
 * Realm mode — run an extension's bundle inside a real sandboxed realm
 * instead of calling `activate(api)` in Node.
 *
 * See `createRealmSmokeHarness` for how the two modes relate, and `types.ts`
 * for why the engine is injected rather than imported.
 */

export {
  createRealmSmokeHarness,
  type RealmSmokeHarness,
  type RealmSmokeHarnessOptions,
} from './createRealmSmokeHarness';
export { RealmHookInvoker } from './RealmHookInvoker';
export { dispatchToApi, type DispatchResult } from './apiDispatch';
export type {
  RealmFactory,
  RealmRuntimeError,
  RealmSession,
  RealmSessionOptions,
} from './types';
