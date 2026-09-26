type Listener = () => void;

export class Store {
  private listeners: Set<Listener> = new Set();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * The current state, for `useSyncExternalStore`-style consumers. Together
   * with `subscribe` this makes every store satisfy core's `ReadableStore`
   * structurally (`@bible/core/browser`).
   *
   * Subclasses keep their state as fields on the instance and mutate it in
   * place, so the snapshot is the store itself and its identity never changes.
   * Read a field through `fromSelector(store, (s) => s.field)`: it recomputes
   * the selection per call and only wakes listeners when that field changed.
   * Passing the raw store straight to `useSyncExternalStore` would never
   * re-render.
   */
  getSnapshot(): this {
    return this;
  }

  protected notify(): void {
    this.listeners.forEach(fn => fn());
  }
}
