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
