import { Store } from './Store';

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

  dismiss(): void {
    this.error = null;
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
    this.notify();
  }
}

export const connectionStore = new ConnectionStore();
