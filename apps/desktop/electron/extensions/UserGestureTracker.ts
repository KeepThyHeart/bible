/**
 * Remembers, per extension, when the user last did something in that
 * extension's own UI. `api.apps.open` asks for it: an extension may bring its
 * app forward only in response to the user (a click in its panel, a command
 * the user ran, a notification action the user chose), never on its own timer.
 *
 * Grants come only from host-side facts: the renderer reports whether the
 * browser's own user-activation flag was set while focus sat in that
 * extension's iframe (`extensions:panelInvoke`, `ext-bridge:command:invoke`),
 * and a notification action click resolves in the host. Nothing the extension
 * itself sends can call `grant`.
 */

/** How long a gesture keeps counting. Long enough for a round trip through the worker, short enough to be "just now". */
export const USER_GESTURE_WINDOW_MS = 5000;

export class UserGestureTracker {
  private readonly lastGesture = new Map<string, number>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Record a user gesture in `extensionId`'s own UI. */
  grant(extensionId: string): void {
    this.lastGesture.set(extensionId, this.now());
  }

  /** Whether `extensionId` had a gesture within the last `windowMs`. */
  hasRecent(extensionId: string, windowMs: number = USER_GESTURE_WINDOW_MS): boolean {
    const at = this.lastGesture.get(extensionId);
    if (at === undefined) return false;
    const age = this.now() - at;
    return age >= 0 && age <= windowMs;
  }

  /** Forget an extension (uninstalled). */
  forget(extensionId: string): void {
    this.lastGesture.delete(extensionId);
  }
}
