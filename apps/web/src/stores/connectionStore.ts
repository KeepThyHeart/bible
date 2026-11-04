import { Store } from './Store';

/** `error` value meaning "cannot reach the server": the banner shows it in the UI language. */
export const CONNECTION_ERROR_NETWORK = 'network';

class ConnectionStore extends Store {
  error: string | null = null;
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;

  setError(message: string): void {
    this.error = message;
    this.notify();

    // Auto-dismiss after 15 seconds
    if (this.dismissTimer) clearTimeout(this.dismissTimer);
    this.dismissTimer = setTimeout(() => {
      this.dismiss();
    }, 15000);
  }

  /** A request just succeeded: a stale "cannot connect" banner no longer applies. */
  clearNetworkError(): void {
    if (this.error === CONNECTION_ERROR_NETWORK) this.dismiss();
  }

  dismiss(): void {
    if (this.error === null && !this.dismissTimer) return;
    this.error = null;
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
  window.addEventListener('online', () => connectionStore.clearNetworkError());
}
