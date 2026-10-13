/**
 * The Accounts module through the REAL web host: flag off registers and loads nothing (the worker is never opened),
 * flag on contributes the Settings tab and, once active, the header badge and the dialog overlay.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { validateBuiltinManifest } from '@bible/core/browser';
import type { UserDbEvent, UserDbRequest } from '../../userdb/protocol';
import { accountsManifest } from './manifest';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string) => (key === 'accounts.syncStatus.signedOut' ? 'Not signed in' : key),
  }),
}));
vi.mock('../../i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../i18n')>()),
  loadNamespace: async () => {},
}));

const listeners = new Set<(e: UserDbEvent) => void>();
const requests: UserDbRequest[] = [];
const getUserDbClient = vi.fn(async () => ({
  async request(req: UserDbRequest) {
    requests.push(req);
    if (req.op === 'sync' && (req.action === 'configure' || req.action === 'status')) return { state: 'signed-out', pending: 0, opaque: 0 };
    if (req.op === 'sync' && req.action === 'api' && req.method === 'info') {
      return { apiVersion: 1, signupOpen: true, quotaBytes: 1, minKdf: { m: 1, t: 1 }, minAge: 13 };
    }
    return null;
  },
  onEvent(cb: (e: UserDbEvent) => void) { listeners.add(cb); return () => { listeners.delete(cb); }; },
}));

async function boot(flags: Record<string, boolean>, url = '/') {
  vi.resetModules();
  vi.doMock('../../userdb/client', () => ({ getUserDbClient, isUserDbSupported: () => true }));
  history.replaceState(null, '', url);
  const { setClientConfig } = await import('../../utils/clientConfig');
  setClientConfig({ features: flags });
  const { registerBuiltinModules, takeModuleUrlHandoffs } = await import('../builtinModules');
  const host = await import('../moduleHost');
  const slots = await import('../../host/slots');
  takeModuleUrlHandoffs();
  registerBuiltinModules();
  return { host, slots };
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  requests.length = 0;
  listeners.clear();
});

describe('manifest', () => {
  it('validates and keeps the tab id, order and label key', () => {
    expect(validateBuiltinManifest(accountsManifest)).toEqual([]);
    expect(accountsManifest.contributes.preferencesSections).toEqual([
      { id: 'account', title: { key: 'settings.tabs.account', fallback: 'Account' }, icon: { kind: 'builtin', name: 'fa-user' }, order: 70 },
    ]);
  });
});

describe('flag accounts off', () => {
  it('registers nothing, runs no probe and never opens the worker', async () => {
    const { host, slots } = await boot({ localUserDb: true, accounts: false });
    expect(host.modulePoints.preferencesSections.get('account')).toBeUndefined();
    expect(host.modulePoints.views.resolve('preferences:account')).toBeUndefined();
    expect(host.runBootProbes().activate).not.toContain('accounts');
    expect(slots.headerItems.list()).toHaveLength(0);
    expect(slots.shellOverlays.list()).toHaveLength(0);
    expect(getUserDbClient).not.toHaveBeenCalled();
  });

  it('still takes the e-mail token out of the address bar', async () => {
    await boot({ accounts: false }, '/account/verify-email#token=zzz');
    expect(location.href).not.toContain('zzz');
  });
});

describe('flag accounts on', () => {
  it('contributes the Settings tab and its view, and loads no code at boot', async () => {
    const { host } = await boot({ localUserDb: true, accounts: true });
    expect(host.modulePoints.preferencesSections.get('account')).toBeDefined();
    expect(host.modulePoints.views.resolve('preferences:account')).toBeDefined();
    expect(host.featureModules.isActive('accounts')).toBe(false);
    expect(getUserDbClient).not.toHaveBeenCalled();
  });

  it('the boot probe activates it; activation registers the badge and dialog and configures the worker', async () => {
    const { host, slots } = await boot({ localUserDb: true, accounts: true });
    expect(host.runBootProbes().activate).toContain('accounts');
    await host.featureModules.activateNow('accounts', 'onBootProbe');
    expect(slots.headerItems.list()).toHaveLength(1);
    expect(slots.shellOverlays.list()).toHaveLength(1);
    await waitFor(() => expect(requests.some((r) => r.op === 'sync' && r.action === 'configure')).toBe(true));
    const configure = requests.find((r) => r.op === 'sync' && r.action === 'configure') as { baseUrl: string; remember: boolean };
    expect(configure.baseUrl).toBe(location.origin);
    expect(configure.remember).toBe(false);
  });

  it('renders the badge (click opens the dialog) and each dialog screen; Escape cannot dismiss an unconfirmed recovery code', async () => {
    const { host, slots } = await boot({ localUserDb: true, accounts: true });
    await host.featureModules.activateNow('accounts', 'onBootProbe');
    const Badge = slots.headerItems.list()[0];
    const Overlay = slots.shellOverlays.list()[0];
    const { accountStore } = await import('./instance');
    render(<><Badge /><Overlay /></>);
    await waitFor(() => expect(screen.getByTestId('accounts-header-badge')).toBeTruthy());
    expect(screen.getByText('Not signed in')).toBeTruthy();
    expect(screen.queryByTestId('accounts-dialog')).toBeNull();

    fireEvent.click(screen.getByText('Not signed in'));
    expect(await screen.findByTestId('accounts-dialog')).toBeTruthy();
    expect(screen.getByTestId('accounts-dialog').getAttribute('data-screen')).toBe('signIn');

    act(() => accountStore.openDialog('recover'));
    expect((await screen.findByTestId('accounts-dialog')).getAttribute('data-screen')).toBe('recover');

    await act(async () => {
      await accountStore.signUp({ email: 'a@b.c', password: 'x' }).catch(() => undefined);
    });
    // The fake answers null for signUp, so no code arrived: force the recovery screen the way the store does.
    act(() => (accountStore as unknown as { set(p: object): void }).set({ recoveryCode: 'AAAA-BBBB-CCCC', dialog: 'recovery', error: undefined }));
    expect((await screen.findByTestId('accounts-dialog')).getAttribute('data-screen')).toBe('recovery');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('accounts-dialog').getAttribute('data-screen')).toBe('recovery');
    act(() => accountStore.confirmRecoveryCode());
    expect((await screen.findByTestId('accounts-dialog')).getAttribute('data-screen')).toBe('account');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('accounts-dialog')).toBeNull());
  });

  it('deactivating removes the badge and the dialog', async () => {
    const { host, slots } = await boot({ localUserDb: true, accounts: true });
    await host.featureModules.activateNow('accounts', 'onBootProbe');
    expect(slots.headerItems.list()).toHaveLength(1);
    host.featureModules.deactivate("accounts");
    expect(slots.headerItems.list()).toHaveLength(0);
    expect(slots.shellOverlays.list()).toHaveLength(0);
  });

  it('a verify-email link is verified on activation and its token leaves the URL', async () => {
    const { host } = await boot({ localUserDb: true, accounts: true }, '/account/verify-email#token=tok-1');
    expect(location.href).not.toContain('tok-1');
    await host.featureModules.activateNow('accounts', 'onBootProbe');
    await waitFor(() => expect(requests).toContainEqual({ op: 'sync', action: 'api', method: 'verifyEmail', args: ['tok-1'] }));
  });

  it('a reset-password link opens the new-password screen', async () => {
    const { host } = await boot({ localUserDb: true, accounts: true }, '/account/reset-password#token=tok-2');
    await host.featureModules.activateNow('accounts', 'onBootProbe');
    const { accountStore } = await import('./instance');
    await waitFor(() => expect(accountStore.getSnapshot().dialog).toBe('resetPassword'));
  });
});
