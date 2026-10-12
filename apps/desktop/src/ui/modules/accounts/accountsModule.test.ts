/**
 * The Accounts module through the real desktop host (task 0150): its Preferences section, view and namespace exist
 * after boot without loading any module code; with the `accounts` flag off nothing is contributed; startup
 * activation subscribes to main's status events; the command opens the section; the en catalog covers every label.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateBuiltinManifest } from '@bible/core/browser';
import en from '../../../../locales/en/accounts.json';
import { accountLabelKeys } from './labels';
import { accountsManifest } from './manifest';
import { failureToken } from './errors';
import { registerAccountsCommands } from './commands';

vi.setConfig({ testTimeout: 60_000 });

const off = vi.fn();
let statusListener: ((s: unknown) => void) | null = null;
const bridge = {
  invoke: vi.fn(async (_ns: string, method: string) => ({
    ok: true,
    value: method === 'status' ? { state: 'signed-out', pending: 0, opaque: 0 } : null,
  })),
  on: vi.fn((_ns: string, _event: string, cb: (s: unknown) => void) => { statusListener = cb; return off; }),
};

async function boot(flags: string) {
  vi.resetModules();
  window.localStorage.setItem('kth.flags', flags);
  (window as unknown as { electron: unknown }).electron = { modules: bridge };
  const host = await import('../moduleHost');
  const { accountsModule } = await import('./binding');
  host.addDesktopModule(accountsModule);
  host.reconcileModules();
  return host;
}

beforeEach(() => {
  window.localStorage.clear();
  statusListener = null;
  vi.clearAllMocks();
});

describe('manifest', () => {
  it('validates and declares the account section, flag and namespace', () => {
    expect(validateBuiltinManifest(accountsManifest)).toEqual([]);
    expect(accountsManifest.platforms).toEqual(['desktop']);
    expect(accountsManifest.flag).toBe('accounts');
    expect(accountsManifest.activationEvents).toEqual(['onStartupFinished']);
    expect(accountsManifest.contributes.preferencesSections).toEqual([
      { id: 'account', title: { key: 'preferencesDialog.sectionAccount', fallback: 'Account & sync' }, icon: { kind: 'builtin', name: 'account' }, order: 27 },
    ]);
    expect(accountsManifest.contributes.i18nNamespace).toBe('accounts');
  });
});

describe('flag', () => {
  it('contributes nothing while the accounts flag is off', async () => {
    const { modulePoints } = await boot('');
    expect(modulePoints.preferencesSections.has('account')).toBe(false);
    expect(modulePoints.views.resolve('preferences:account')).toBeUndefined();
  });

  it('contributes the section, view and namespace when on, and loads no code until startup finishes', async () => {
    const { modulePoints, featureModules } = await boot('localUserDb,accounts');
    expect(modulePoints.preferencesSections.has('account')).toBe(true);
    expect(modulePoints.views.resolve('preferences:account')).toBeDefined();
    expect(modulePoints.i18nNamespace.has('accounts')).toBe(true);
    expect(featureModules.isActive('accounts')).toBe(false);
    expect(bridge.on).not.toHaveBeenCalled();
  });

  it('onStartupFinished activates it: subscribes to statusChanged and loads the status', async () => {
    const { featureModules } = await boot('localUserDb,accounts');
    await featureModules.fire('onStartupFinished');
    expect(featureModules.isActive('accounts')).toBe(true);
    expect(bridge.on).toHaveBeenCalledWith('accounts', 'statusChanged', expect.any(Function));
    const { useAccountsStore } = await import('./useAccountsStore');
    await vi.waitFor(() => expect(useAccountsStore.getState().status?.state).toBe('signed-out')); // allow-getstate: test
    statusListener?.({ state: 'idle', pending: 2, opaque: 0, accountEmail: 'a@b.c' });
    expect(useAccountsStore.getState().status?.pending).toBe(2); // allow-getstate: test
  });

  it('switching it off at runtime removes the section and drops the subscription', async () => {
    const { modulePoints, featureModules, reconcileModules } = await boot('localUserDb,accounts');
    await featureModules.fire('onStartupFinished');
    window.localStorage.setItem('kth.modules', '-accounts');
    reconcileModules();
    expect(modulePoints.preferencesSections.has('account')).toBe(false);
    expect(off).toHaveBeenCalledTimes(1);
  });
});

describe('command', () => {
  it('accounts.openSettings opens the account section of Preferences', () => {
    const handlers = new Map<string, () => void>();
    registerAccountsCommands({ register: (cmd: { id: string; handler: () => void }) => { handlers.set(cmd.id, cmd.handler); return { dispose() {} }; } } as never);
    const seen: unknown[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener('open-preferences-section', listener);
    handlers.get('accounts.openSettings')?.();
    window.removeEventListener('open-preferences-section', listener);
    expect(seen).toEqual(['account']);
  });
});

describe('catalog and errors', () => {
  it('the en catalog has every label key, the failure strings and the section strings', () => {
    const catalog = en as Record<string, string>;
    for (const key of accountLabelKeys()) expect(catalog[key], key).toBeTruthy();
    for (const f of ['bad_request', 'unauthorized', 'network', 'network_blocked', 'weak_password', 'crypto', 'internal']) {
      expect(catalog[`accounts.error.${f}`], f).toBeTruthy();
    }
  });

  it('source check: every t() key used by the section exists in the en catalog', () => {
    const src = readFileSync(resolve(__dirname, 'AccountSection.tsx'), 'utf8');
    const catalog = en as Record<string, string>;
    for (const m of src.matchAll(/t\('(accounts\.[A-Za-z.0-9]+)'/g)) expect(catalog[m[1]!], m[1]).toBeTruthy();
  });

  it('maps rejections to a failure token and never leaks raw messages', () => {
    expect(failureToken(Object.assign(new Error('network_blocked'), { code: 'network_blocked' }))).toBe('network_blocked');
    expect(failureToken(new Error('unauthorized'))).toBe('unauthorized');
    expect(failureToken(new Error('secret-looking text'))).toBe('internal');
    expect(failureToken('boom')).toBe('internal');
  });
});
