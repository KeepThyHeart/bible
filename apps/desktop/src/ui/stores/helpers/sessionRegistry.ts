/**
 * Session serialization/restoration registry - decouples useSessionStore
 * from the individual domain stores.
 *
 * Each store registers a serializer (and optionally a restorer) at creation
 * time.  useSessionStore iterates the registry instead of directly importing
 * every store.
 */

type SessionSerializer = () => unknown;
type SessionRestorer = (data: unknown) => void;

const serializers = new Map<string, SessionSerializer>();
const restorers = new Map<string, SessionRestorer>();

/**
 * Register a function that returns session-relevant state for a given key.
 * Called once per store at module load time.
 */
export function registerSessionSerializer(key: string, fn: SessionSerializer): void {
  serializers.set(key, fn);
}

/**
 * Register a function that restores a store's state from saved session data.
 * Called once per store at module load time.
 */
export function registerSessionRestorer(key: string, fn: SessionRestorer): void {
  restorers.set(key, fn);
}

/** What a feature module may need from the saved session when its code loads after the session did. */
export interface StagedSession {
  readonly ui?: unknown;
  readonly dockviewState?: unknown;
}

let staged: StagedSession | null = null;

/** Called once by startup after reading the session: modules restore their own state from it when they load. */
export function stageSessionForModules(session: StagedSession): void {
  staged = session;
}

export function getStagedSession(): StagedSession | null {
  return staged;
}

/**
 * Collect serialized state from every registered store.
 * Returns a plain object mapping keys to their serialized data.
 */
export function collectSessionData(): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [key, fn] of serializers) {
    data[key] = fn();
  }
  return data;
}

/**
 * Return the raw serializer map (used by useSessionStore to build SessionData).
 */
export function getSessionSerializers(): ReadonlyMap<string, SessionSerializer> {
  return serializers;
}

/**
 * Return the raw restorer map.
 */
export function getSessionRestorers(): ReadonlyMap<string, SessionRestorer> {
  return restorers;
}

// ---------------------------------------------------------------------------
// Module-owned session sections (task 0127)
//
// A feature module keeps state in `sessionData.ui.<key>` (keyword-mark switches, measure
// preferences). Its store loads lazily, so the host cannot call it at restore time. Instead:
//   - a module entry DECLARES its keys when it is added to the host (data only, enabled or not);
//   - AppInit STASHES the restored `ui` blob;
//   - the module's store CLAIMS its key when it loads and is handed the saved data (immediately
//     when the blob is already there);
//   - on save, a declared key with a serializer is serialized, and one without (module off, or
//     not loaded yet) is written back unchanged, so switching a module off never drops its data.
// ---------------------------------------------------------------------------

const declaredKeys = new Set<string>();
const claimants = new Map<string, SessionRestorer>();
let restoredUi: Record<string, unknown> | null = null;

/** Declare session keys a module owns. Idempotent. */
export function declareSessionKeys(keys: readonly string[]): void {
  for (const k of keys) declaredKeys.add(k);
}

/** Keep the restored `ui` blob for claimants, and hand each declared claimed key its data. */
export function stashRestoredSessionUi(ui: unknown): void {
  restoredUi = ui && typeof ui === 'object' ? (ui as Record<string, unknown>) : null;
  if (!restoredUi) return;
  for (const [key, apply] of claimants) {
    if (key in restoredUi) apply(restoredUi[key]);
  }
}

/**
 * Claim a declared key: `apply` receives its saved data now (when the session was already restored)
 * or when it is. Re-claiming replaces the earlier claim.
 */
export function claimRestoredSessionSection(key: string, apply: SessionRestorer): void {
  claimants.set(key, apply);
  if (restoredUi && key in restoredUi) apply(restoredUi[key]);
}

/** The `ui` entries of every declared key: serialized when a serializer exists, else the stashed data. */
export function declaredSessionSections(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of declaredKeys) {
    const fn = serializers.get(key);
    if (fn) out[key] = fn();
    else if (restoredUi && key in restoredUi) out[key] = restoredUi[key];
  }
  return out;
}

/** Test hook. */
export function resetSessionSectionsForTests(): void {
  declaredKeys.clear();
  claimants.clear();
  restoredUi = null;
}
