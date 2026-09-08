/**
 * The seam between the smoke harness and a real QuickJS realm.
 *
 * ── Why this is an interface and not an import ──────────────────────────────
 * The realm implementation (`QuickJSRealm`) lives in `apps/desktop`,
 * because that is where it is *shipped* — inside the per-extension
 * `utilityProcess`. This package is published to npm for extension authors and
 * must not depend on an Electron application, so it describes what it needs
 * from a realm and lets the caller supply one.
 *
 * That is not a workaround. Everything in this directory is protocol work —
 * activation handshake, routing guest calls to a mock API, capability
 * enforcement — and none of it is QuickJS-specific. Keeping the engine behind
 * `RealmFactory` means the harness would drive a different engine unchanged,
 * and it keeps the dependency arrow pointing the right way: desktop already
 * depends on this package's shape, not the reverse.
 *
 * A future extraction of the realm into its own package would make a default
 * factory possible. Until extensions open to third parties there is no
 * consumer for one, so none is invented here.
 */

/**
 * A live realm running one extension's bundle.
 *
 * Deliberately smaller than `QuickJSRealm`'s own surface: the harness needs to
 * push envelopes in, receive envelopes out, and tear down. Memory limits,
 * interrupt deadlines and handle lifetimes are the realm's business.
 */
export interface RealmSession {
  /** Deliver one host→guest envelope. May run guest code synchronously. */
  deliver(envelope: unknown): void;
  /**
   * Run the extension's `deactivate()` inside the realm and drop its
   * subscriptions, before the realm itself goes away.
   *
   * Optional because it is best-effort by nature — the realm is torn down
   * regardless of what the guest does here — but a realm that can offer it
   * should, since in-process mode calls the module's `deactivate` export and a
   * harness that skipped it would hide a lifecycle bug rather than surface one.
   */
  requestGuestDispose?(): void;
  /** Tear the realm down. Must be safe to call twice. */
  dispose(): void;
}

/** Everything a factory needs to stand up a realm for one extension. */
export interface RealmSessionOptions {
  extensionId: string;
  /**
   * The extension's bundled entry source. The harness reads this from
   * `manifest.main` so the factory does no file I/O and can be handed a
   * string directly in tests.
   */
  entrySource: string;
  /** Filename used in guest stack traces. */
  entryFilename: string;
  /** Called for every guest→host envelope. */
  onSend(envelope: unknown): void;
  /** `console.*` from inside the realm. */
  onLog(level: string, args: unknown[]): void;
  /** Unrecoverable realm failure — the harness fails activation. */
  onFatal(message: string): void;
}

export type RealmFactory = (opts: RealmSessionOptions) => Promise<RealmSession>;

/**
 * A runtime error the guest reported on the `__runtime.error` channel.
 *
 * In-process mode learns that an extension's event handler threw because the
 * throw propagates to the caller. Across the realm boundary it cannot: the
 * guest dispatches events without reporting a result, so the only evidence is
 * this out-of-band channel. The harness watches it and attributes any new
 * entry to the invocation that was in flight.
 */
export interface RealmRuntimeError {
  source: string;
  message: string;
  stack?: string;
}
