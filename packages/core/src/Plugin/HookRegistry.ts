/**
 * Generic typed hook system for plugin extensibility.
 *
 * Two hook types:
 * - **Filter hooks**: transform data through a waterfall chain (each handler
 *   receives the previous result and returns a new one).
 * - **Action hooks**: fire-and-forget side-effect notifications.
 *
 * Both are strongly typed via TFilterMap and TActionMap type parameters.
 *
 * Performance: applyFilters / runActions check Map.has() first - zero cost
 * when no handlers are registered for a given hook.
 */

export type FilterHandler<T> = (value: T) => T | Promise<T>;
export type ActionHandler<T> = (value: T) => void | Promise<void>;

interface HandlerEntry<T> {
  handler: T;
  priority: number;
}

export class HookRegistry<
  TFilterMap = Record<string, unknown>,
  TActionMap = Record<string, unknown>,
> {
  private filters = new Map<string, HandlerEntry<FilterHandler<unknown>>[]>();
  private actions = new Map<string, HandlerEntry<ActionHandler<unknown>>[]>();

  // ---------- Filters ----------

  /**
   * Register a filter hook handler. Lower priority runs first (default: 10).
   * Returns an unsubscribe function.
   */
  addFilter<K extends keyof TFilterMap & string>(
    hook: K,
    handler: FilterHandler<TFilterMap[K]>,
    priority = 10,
  ): () => void {
    if (!this.filters.has(hook)) {
      this.filters.set(hook, []);
    }
    const entry: HandlerEntry<FilterHandler<unknown>> = {
      handler: handler as FilterHandler<unknown>,
      priority,
    };
    const list = this.filters.get(hook)!;
    list.push(entry);
    list.sort((a, b) => a.priority - b.priority);

    return () => {
      const idx = list.indexOf(entry);
      if (idx !== -1) list.splice(idx, 1);
      if (list.length === 0) this.filters.delete(hook);
    };
  }

  /**
   * Run the filter chain for a hook. Returns the final transformed value.
   * If no handlers are registered, returns initialValue unchanged.
   */
  async applyFilters<K extends keyof TFilterMap & string>(
    hook: K,
    initialValue: TFilterMap[K],
  ): Promise<TFilterMap[K]> {
    const list = this.filters.get(hook);
    if (!list || list.length === 0) return initialValue;

    let result: unknown = initialValue;
    for (const entry of list) {
      result = await entry.handler(result);
    }
    return result as TFilterMap[K];
  }

  /**
   * Synchronous variant - only use when you know all handlers are sync.
   * Throws if a handler returns a Promise.
   */
  applyFiltersSync<K extends keyof TFilterMap & string>(
    hook: K,
    initialValue: TFilterMap[K],
  ): TFilterMap[K] {
    const list = this.filters.get(hook);
    if (!list || list.length === 0) return initialValue;

    let result: unknown = initialValue;
    for (const entry of list) {
      const out = entry.handler(result);
      if (out instanceof Promise) {
        throw new Error(
          `[HookRegistry] Filter handler for "${hook}" returned a Promise - use applyFilters() instead of applyFiltersSync()`,
        );
      }
      result = out;
    }
    return result as TFilterMap[K];
  }

  // ---------- Actions ----------

  /**
   * Register an action hook handler. Lower priority runs first (default: 10).
   * Returns an unsubscribe function.
   */
  addAction<K extends keyof TActionMap & string>(
    hook: K,
    handler: ActionHandler<TActionMap[K]>,
    priority = 10,
  ): () => void {
    if (!this.actions.has(hook)) {
      this.actions.set(hook, []);
    }
    const entry: HandlerEntry<ActionHandler<unknown>> = {
      handler: handler as ActionHandler<unknown>,
      priority,
    };
    const list = this.actions.get(hook)!;
    list.push(entry);
    list.sort((a, b) => a.priority - b.priority);

    return () => {
      const idx = list.indexOf(entry);
      if (idx !== -1) list.splice(idx, 1);
      if (list.length === 0) this.actions.delete(hook);
    };
  }

  /**
   * Fire an action hook. All handlers run; errors are logged, not thrown.
   * Uses Promise.allSettled so one failing handler doesn't block others.
   */
  async runActions<K extends keyof TActionMap & string>(
    hook: K,
    value: TActionMap[K],
  ): Promise<void> {
    const list = this.actions.get(hook);
    if (!list || list.length === 0) return;

    const results = await Promise.allSettled(
      list.map(entry => entry.handler(value)),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error(`[HookRegistry] Action handler error for "${hook}":`, result.reason);
      }
    }
  }

  /**
   * Fire-and-forget variant - kicks off action handlers without awaiting.
   * Useful in hot paths where you don't want to block the response.
   */
  fireActions<K extends keyof TActionMap & string>(
    hook: K,
    value: TActionMap[K],
  ): void {
    const list = this.actions.get(hook);
    if (!list || list.length === 0) return;
    // Intentionally not awaited
    void this.runActions(hook, value);
  }

  // ---------- Introspection ----------

  /** Check if any handlers are registered for a filter hook */
  hasFilters<K extends keyof TFilterMap & string>(hook: K): boolean {
    const list = this.filters.get(hook);
    return !!list && list.length > 0;
  }

  /** Check if any handlers are registered for an action hook */
  hasActions<K extends keyof TActionMap & string>(hook: K): boolean {
    const list = this.actions.get(hook);
    return !!list && list.length > 0;
  }

  /** Remove all registered handlers (useful for testing / shutdown) */
  clear(): void {
    this.filters.clear();
    this.actions.clear();
  }
}
