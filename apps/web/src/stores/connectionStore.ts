import { Store } from './Store';

/** `error` value meaning "cannot reach the server": the banner shows it in the UI language. */
export const CONNECTION_ERROR_NETWORK = 'network';

/**
 * How long the network must have been failure-free before a success clears the banner. Some requests
 * can succeed while others keep failing (one route blocked, a flaky proxy); without this the banner
 * toggled on and off with every interleaved success and failure.
 */
export const NETWORK_CLEAR_QUIET_MS = 2000;

class ConnectionStore extends Store {
  error: string | null = null;
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;
  private lastNetworkFailureAt = 0;
  private clearTimer: ReturnType<typeof setTimeout> | null = null;

  setError(message: string): void {
    if (message === CONNECTION_ERROR_NETWORK) {
      this.lastNetworkFailureAt = Date.now();
      // A failure while a clear was pending: the connection is not steady yet.
      if (this.clearTimer) { clearTimeout(this.clearTimer); this.clearTimer = null; }
    }
    this.error = message;
    this.notify();

    // Auto-dismiss after 15 seconds
    if (this.dismissTimer) clearTimeout(this.dismissTimer);
    this.dismissTimer = setTimeout(() => {
      this.dismiss();
    }, 15000);
  }

  /**
   * A request just succeeded: a stale "cannot connect" banner no longer applies -- once the network
   * has been steady for {@link NETWORK_CLEAR_QUIET_MS}. A success sooner than that after a failure
   * schedules the clear for the end of the quiet period; another failure cancels it.
   */
  clearNetworkError(immediately = false): void {
    if (this.error !== CONNECTION_ERROR_NETWORK) return;
    const wait = immediately ? 0 : this.lastNetworkFailureAt + NETWORK_CLEAR_QUIET_MS - Date.now();
    if (wait <= 0) { this.dismiss(); return; }
    if (this.clearTimer) return;
    this.clearTimer = setTimeout(() => {
      this.clearTimer = null;
      if (this.error === CONNECTION_ERROR_NETWORK) this.dismiss();
    }, wait);
  }

  dismiss(): void {
    if (this.error === null && !this.dismissTimer) return;
    this.error = null;
    if (this.clearTimer) { clearTimeout(this.clearTimer); this.clearTimer = null; }
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
    this.notify();
  }
}

export const connectionStore = new ConnectionStore();

// Back online: the banner about the lost connection is over.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => connectionStore.clearNetworkError(true));
}
