/**
 * The smallest observable store: fields on the instance, `notify()` after a change.
 * Framework-neutral on purpose: Preact (web `useStore`) and React (desktop
 * `useSyncExternalStore` over `subscribe` and `version`) both read it.
 */
type Listener = () => void;

export class Store {
  private listeners: Set<Listener> = new Set();
  /** Bumped on every notify: a snapshot value for `useSyncExternalStore`. */
  version = 0;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** The store itself; with `subscribe` this satisfies core's `ReadableStore` structurally. */
  getSnapshot(): this {
    return this;
  }

  protected notify(): void {
    this.version++;
    this.listeners.forEach(fn => fn());
  }
}
