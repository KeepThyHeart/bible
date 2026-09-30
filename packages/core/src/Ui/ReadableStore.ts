/**
 * The smallest contract a UI framework needs from a state container: "tell me
 * when something changed" and "what is the current value". It is exactly the
 * shape React's `useSyncExternalStore(subscribe, getSnapshot)` consumes, and
 * Preact's `preact/compat` twin of it, so one store type can drive either app.
 *
 * Contract (the same rules `useSyncExternalStore` enforces):
 * - `getSnapshot()` returns the SAME value (`Object.is`) until the store
 *   changes. Returning a fresh object per call makes React re-render forever.
 * - `subscribe(listener)` returns an unsubscribe function; listeners take no
 *   arguments and read the new value through `getSnapshot()`.
 *
 * No framework, DOM or platform imports: safe in `@bible/core/browser`.
 */
export interface ReadableStore<T> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): T;
}

/** The structural slice of a Zustand store `fromZustand` reads. */
export interface ZustandLike<T> {
  subscribe(listener: (state: T, prevState: T) => void): () => void;
  getState(): T;
}

/**
 * Adapt a Zustand store (`useFooStore` is one; so is `useFooStore` created with
 * `create`, since the hook carries `subscribe`/`getState`).
 *
 * Zustand already replaces the state object only when it changes, so
 * `getState()` is a valid snapshot as it stands; nothing is copied or cached
 * here. Only the listener shape differs: Zustand passes `(state, prev)`, a
 * `ReadableStore` listener takes nothing.
 */
export function fromZustand<T>(store: ZustandLike<T>): ReadableStore<T> {
  return {
    subscribe: (listener) => store.subscribe(() => listener()),
    getSnapshot: () => store.getState(),
  };
}

/**
 * Derive a slice of another store.
 *
 * The selected value is recomputed on every `getSnapshot()` call but the
 * PREVIOUS value is returned whenever `isEqual` says the new one is the same,
 * so the snapshot is stable (a selector that builds a new array or object each
 * time is fine as long as `isEqual` compares by content). Recomputing rather
 * than memoising on the source's identity is deliberate: a source whose value
 * is mutated in place (web's `Store` subclasses return themselves) never
 * changes identity, yet its selected fields do.
 *
 * Listeners fire only when the selected value actually changed, so a component
 * watching one field is not woken by an unrelated one.
 *
 * @param isEqual Defaults to `Object.is`.
 */
export function fromSelector<T, S>(
  store: ReadableStore<T>,
  select: (value: T) => S,
  isEqual: (a: S, b: S) => boolean = Object.is,
): ReadableStore<S> {
  let hasCached = false;
  let cached: S;

  const getSnapshot = (): S => {
    const next = select(store.getSnapshot());
    if (hasCached && isEqual(cached, next)) return cached;
    cached = next;
    hasCached = true;
    return next;
  };

  return {
    getSnapshot,
    subscribe(listener) {
      // Tracked per subscription: the cache is shared, so a per-subscriber
      // "last seen" is what lets every listener see its own change.
      let last = getSnapshot();
      return store.subscribe(() => {
        const next = getSnapshot();
        if (next === last) return;
        last = next;
        listener();
      });
    },
  };
}

/** A `ReadableStore` you can also write to. */
export interface WritableStore<T> extends ReadableStore<T> {
  setState(next: T | ((prev: T) => T)): void;
}

/**
 * A minimal value store: holds `initial`, notifies subscribers when `setState`
 * changes it (by `Object.is`). For app state that has no store of its own yet.
 */
export function createStore<T>(initial: T): WritableStore<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setState(next) {
      const value = typeof next === 'function' ? (next as (prev: T) => T)(state) : next;
      if (Object.is(value, state)) return;
      state = value;
      // Copy first: a listener may unsubscribe (or subscribe) while we notify.
      for (const listener of [...listeners]) listener();
    },
  };
}
