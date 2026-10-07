/**
 * Starts the Presenter's session runtime (`presentStore`) only when it is needed:
 * a saved session or control link exists, the Presenter opens, or Study boots.
 * `presentStore` is imported lazily so the shell entry never carries it.
 */
import { PRESENT_SESSION_KEY } from '../present/sessionKey';
import type { ControllerSession } from '../stores/presentStore';

/**
 * True when a usable controller session is saved: parseable and not expired
 * (the same expiry rule as `presentStore`'s `readStoredSession`). An expired or
 * corrupt one is dropped so later boots stay lean and land in Study.
 */
export function hasStoredPresenterSession(): boolean {
  try {
    const raw = localStorage.getItem(PRESENT_SESSION_KEY);
    if (raw === null) return false;
    const parsed = JSON.parse(raw) as { expiresAt?: string } | null;
    if (!parsed || typeof parsed !== 'object') return false;
    if (parsed.expiresAt && Date.parse(parsed.expiresAt) <= Date.now()) {
      localStorage.removeItem(PRESENT_SESSION_KEY);
      return false;
    }
    return true;
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
