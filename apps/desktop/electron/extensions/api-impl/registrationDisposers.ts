/**
 * Per-worker bookkeeping for registrations an extension can dispose.
 *
 * Every `register*` method in the API is declared `Promise<DisposableHandle>`,
 * but a disposable is a *function*, and functions do not survive the RPC
 * envelope. The host therefore mints an opaque id, keeps the real disposer on
 * its own side, and returns `{ disposalId }`; the guest proxy turns that back
 * into a `DisposableHandle` whose `dispose()` calls `<namespace>.dispose(id)`.
 * See `maybeWrapDisposable` in `extension-runtime/apiProxy.ts`.
 *
 * This class exists so that pattern is implemented once rather than open-coded
 * per namespace. Without it, an impl tends to return `{ providerId }` /
 * `{ handle }` and keep its disposers in an array only teardown can reach,
 * which makes the registration impossible to dispose individually - the
 * declared return type notwithstanding.
 *
 * Ids are namespaced per instance and per worker; they are never persisted and
 * never cross an extension boundary, so a counter is sufficient.
 */
export class RegistrationDisposers {
  private readonly disposers = new Map<string, () => void>();
  private next = 1;

  /** @param prefix Short tag for readability in logs, e.g. `'provider'`. */
  constructor(private readonly prefix: string) {}

  /** Track a disposer and return the id the guest will hand back. */
  add(dispose: () => void): string {
    const id = `${this.prefix}-${this.next++}`;
    this.disposers.set(id, dispose);
    return id;
  }

  /**
   * Body for the namespace's `dispose` RPC method.
   *
   * Unknown or already-disposed ids resolve rather than throw: `dispose()` is
   * overwhelmingly called from an extension's `deactivate()`, often after the
   * host has already torn the registration down, and turning a double-dispose
   * into a rejection would make correct cleanup code look broken. A throwing
   * disposer is swallowed for the same reason - the registration is gone from
   * the map either way, and the extension can do nothing useful with the
   * error.
   */
  async handleDispose(args: unknown[]): Promise<void> {
    const id = args[0];
    if (typeof id !== 'string') return;
    const dispose = this.disposers.get(id);
    if (!dispose) return;
    this.disposers.delete(id);
    try {
      dispose();
    } catch {
      /* best-effort */
    }
  }

  /** Drop everything. Called from the owning api-impl's `dispose()`. */
  disposeAll(): void {
    for (const dispose of this.disposers.values()) {
      try {
        dispose();
      } catch {
        /* best-effort */
      }
    }
    this.disposers.clear();
  }

  /** Number of live registrations. Test affordance. */
  get size(): number {
    return this.disposers.size;
  }
}
