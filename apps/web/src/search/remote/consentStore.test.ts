import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CONSENT_STORAGE_KEY, RemoteConsentStore } from './consentStore';

function make(cfg: { via?: 'server' | 'browser'; noticeVersion?: number } | null = {}): RemoteConsentStore {
  const s = new RemoteConsentStore();
  s.configure(cfg ? { via: cfg.via ?? 'server', noticeVersion: cfg.noticeVersion } : null);
  return s;
}

describe('RemoteConsentStore', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('is unset with no record and when not configured', () => {
    expect(make().status).toBe('unset');
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ version: 1, decision: 'granted', at: 'x' }));
    expect(make(null).status).toBe('unset');
  });

  it('reads a stored granted / declined record', () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ version: 1, decision: 'granted', at: '2026-10-20T00:00:00Z' }));
    const s = make();
    expect(s.status).toBe('granted');
    expect(s.decidedAt).toBe('2026-10-20T00:00:00Z');
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ version: 1, decision: 'declined', at: 'x' }));
    expect(make().status).toBe('declined');
  });

  it('asks again when the notice version changed', () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ version: 1, decision: 'granted', at: 'x' }));
    expect(make({ noticeVersion: 2 }).status).toBe('unset');
  });

  it('request opens the dialog once for concurrent callers and resolves on grant', async () => {
    const s = make();
    const a = s.request();
    const b = s.request();
    expect(s.dialogOpen).toBe(true);
    s.grant();
    await expect(a).resolves.toBe('granted');
    await expect(b).resolves.toBe('granted');
    expect(s.dialogOpen).toBe(false);
    expect(s.status).toBe('granted');
    expect(JSON.parse(localStorage.getItem(CONSENT_STORAGE_KEY)!).decision).toBe('granted');
    // Already decided: no dialog.
    await expect(s.request()).resolves.toBe('granted');
    expect(s.dialogOpen).toBe(false);
  });

  it('decline records the answer and does not ask again', async () => {
    const s = make();
    const p = s.request();
    s.decline();
    await expect(p).resolves.toBe('declined');
    await expect(s.request()).resolves.toBe('declined');
    expect(s.dialogOpen).toBe(false);
  });

  it('withdraw = declined; reenable clears the record so the next search asks', () => {
    const s = make();
    s.grant();
    s.withdraw();
    expect(s.status).toBe('declined');
    s.reenable();
    expect(s.status).toBe('unset');
    expect(localStorage.getItem(CONSENT_STORAGE_KEY)).toBeNull();
  });

  it('keeps the decision in memory when storage is blocked, and asks again next session', () => {
    const blocked = () => { throw new Error('blocked'); };
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked });
    const s = make();
    expect(s.status).toBe('unset');
    s.grant();
    expect(s.status).toBe('granted'); // this session
    s.reenable();
    expect(s.status).toBe('unset');
    s.grant();
    // A new session (fresh store) knows nothing.
    expect(make().status).toBe('unset');
  });

  it('notifies subscribers', () => {
    const s = make();
    const fn = vi.fn();
    s.subscribe(fn);
    s.grant();
    expect(fn).toHaveBeenCalled();
  });
});
