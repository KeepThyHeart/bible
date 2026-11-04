/**
 * First-use consent for the online meaning search (task 0190).
 *
 * The decision lives in localStorage (`bible.remoteSemantic.consent`) as a
 * `ConsentRecord`. It is a UI preference, not user content, so it does not
 * break the web read-only rule. Every storage access is wrapped: when storage
 * is blocked the record is kept in memory for this session only, so the next
 * session asks again.
 *
 * Nothing here talks to the network. The store only decides whether the
 * remote provider may run, and drives the consent dialog.
 */
import { RemoteSemantic } from '@bible/core/browser';
import { Store } from '../../stores/Store';

export const CONSENT_STORAGE_KEY = 'bible.remoteSemantic.consent';

export interface RemoteConsentConfig {
  via: 'server' | 'browser';
  /** Notice version the server expects; defaults to the core constant. */
  noticeVersion?: number;
}

type Decision = 'granted' | 'declined';

export class RemoteConsentStore extends Store {
  /** True only when the site is in remote mode; everything else is a no-op. */
  configured = false;
  via: 'server' | 'browser' = 'server';
  noticeVersion: number = RemoteSemantic.REMOTE_SEMANTIC_NOTICE_VERSION;
  dialogOpen = false;
  private record: RemoteSemantic.ConsentRecord | null = null;
  private waiting: { promise: Promise<Decision>; resolve: (d: Decision) => void } | null = null;

  /** Called once at boot with the remote config, or null when not in remote mode. */
  configure(cfg: RemoteConsentConfig | null): void {
    this.configured = !!cfg;
    if (cfg) {
      this.via = cfg.via;
      this.noticeVersion = cfg.noticeVersion ?? RemoteSemantic.REMOTE_SEMANTIC_NOTICE_VERSION;
      this.record = this.readStorage();
    } else {
      this.record = null;
    }
    this.notify();
  }

  get status(): RemoteSemantic.ConsentStatus {
    if (!this.configured) return 'unset';
    return RemoteSemantic.consentStatus(this.record, this.noticeVersion);
  }

  /** ISO time of the current decision, for the settings status line. */
  get decidedAt(): string | null {
    return this.status === 'unset' ? null : (this.record?.at || null);
  }

  /**
   * Ask the user (opens the dialog) and resolve with the answer. Concurrent
   * callers share one dialog. Resolves at once when already decided.
   */
  request(): Promise<Decision> {
    const s = this.status;
    if (s !== 'unset') return Promise.resolve(s);
    if (!this.waiting) {
      let resolve!: (d: Decision) => void;
      const promise = new Promise<Decision>((r) => { resolve = r; });
      this.waiting = { promise, resolve };
      this.dialogOpen = true;
      this.notify();
    }
    return this.waiting.promise;
  }

  grant(): void { this.decide('granted'); }
  decline(): void { this.decide('declined'); }
  /** Withdraw consent in settings; same state as "Not now". */
  withdraw(): void { this.decide('declined'); }

  /** Turn the option back on from declined: clear the record so the next search asks. */
  reenable(): void {
    this.record = null;
    this.removeStorage();
    this.notify();
  }

  private decide(decision: Decision): void {
    this.record = RemoteSemantic.makeConsentRecord(decision, new Date(), this.noticeVersion);
    this.writeStorage(this.record);
    const w = this.waiting;
    this.waiting = null;
    this.dialogOpen = false;
    this.notify();
    w?.resolve(decision);
  }

  private readStorage(): RemoteSemantic.ConsentRecord | null {
    try {
      return RemoteSemantic.parseConsentRecord(localStorage.getItem(CONSENT_STORAGE_KEY));
    } catch {
      return null;
    }
  }

  private writeStorage(record: RemoteSemantic.ConsentRecord): void {
    try { localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record)); } catch { /* memory only */ }
  }

  private removeStorage(): void {
    try { localStorage.removeItem(CONSENT_STORAGE_KEY); } catch { /* memory only */ }
  }
}

export const remoteConsentStore = new RemoteConsentStore();
