/**
 * Starts the Presenter's session runtime (`presentStore`) only when it is needed:
 * a saved session or control link exists, the Presenter opens, or Study boots.
 * `presentStore` is imported lazily so the shell entry never carries it.
 */
import { PRESENT_SESSION_KEY } from '../present/sessionKey';
import type { ControllerSession } from '../stores/presentStore';

/** True when a controller session is saved (its expiry is checked later by `readStoredSession`). */
export function hasStoredPresenterSession(): boolean {
  try {
    return localStorage.getItem(PRESENT_SESSION_KEY) !== null;
  } catch {
    return false;
  }
}

let runtime: Promise<void> | null = null;
let busySink: ((busy: boolean) => void) | null = null;
let busy = false;

/**
 * Where the Presenter's "has a live session" flag goes (wave B wires it to
 * `appRegistry.setBusy('present', busy)`). Called with the current value on
 * registration and on every change.
 */
export function setPresenterBusySink(fn: ((busy: boolean) => void) | null): void {
  busySink = fn;
  fn?.(busy);
}

export function ensurePresenterRuntime(adopted: ControllerSession | null = null): Promise<void> {
  runtime ??= (async () => {
    const { presentStore } = await import('../stores/presentStore');
    presentStore.restore(adopted);
    const sync = () => {
      busy = presentStore.session !== null;
      busySink?.(busy);
    };
    presentStore.subscribe(sync);
    sync();
  })();
  return runtime;
}

/** Test hook: forget the memoised start. */
export function resetPresenterRuntimeForTest(): void {
  runtime = null;
  busySink = null;
  busy = false;
}
