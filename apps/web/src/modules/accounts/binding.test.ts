import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../i18n', () => ({ loadNamespace: vi.fn(async () => undefined) }));

import { accountsModule, parseAccountUrl, setAccountHandoffForTests, takeAccountHandoff } from './binding';

afterEach(() => {
  setAccountHandoffForTests(null);
  history.replaceState(null, '', '/');
});

describe('parseAccountUrl', () => {
  it('reads the two e-mail links the sync server generates', () => {
    expect(parseAccountUrl('/account/verify-email', '#token=abc_DEF-123')).toEqual({ kind: 'verify-email', token: 'abc_DEF-123' });
    expect(parseAccountUrl('/account/reset-password', '#token=xyz')).toEqual({ kind: 'reset-password', token: 'xyz' });
    expect(parseAccountUrl('/account/reset-password/', '#token=xyz')?.kind).toBe('reset-password');
  });

  it('ignores other addresses and links without a token', () => {
    expect(parseAccountUrl('/', '#token=abc')).toBeNull();
    expect(parseAccountUrl('/account', '#token=abc')).toBeNull();
    expect(parseAccountUrl('/account/verify-email', '')).toBeNull();
    expect(parseAccountUrl('/account/verify-email', '#other=1')).toBeNull();
  });
});

describe('parseAccountUrl under a base path', () => {
  it('strips BASE_URL before matching (BASE_PATH=/bible/)', () => {
    expect(parseAccountUrl('/bible/account/reset-password', '#token=x', '/bible/')).toEqual({ kind: 'reset-password', token: 'x' });
    expect(parseAccountUrl('/bible/account/verify-email/', '#token=y', '/bible/')?.kind).toBe('verify-email');
    expect(parseAccountUrl('/account/reset-password', '#token=x', '/bible/')?.kind).toBe('reset-password');
    expect(parseAccountUrl('/biblex/account/reset-password', '#token=x', '/bible/')).toBeNull();
  });

  it('takeUrl rewrites the address to the base path, not /', () => {
    vi.stubEnv('BASE_URL', '/bible/');
    try {
      history.replaceState(null, '', '/bible/account/reset-password#token=secret123');
      accountsModule.takeUrl?.();
      expect(location.pathname).toBe('/bible/');
      expect(location.href).not.toContain('secret123');
      expect(takeAccountHandoff()).toEqual({ kind: 'reset-password', token: 'secret123' });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('takeUrl', () => {
  it('keeps the token in memory and removes it from the address bar', () => {
    history.replaceState(null, '', '/account/reset-password#token=secret123');
    accountsModule.takeUrl?.();
    expect(location.pathname).toBe('/');
    expect(location.hash).toBe('');
    expect(location.href).not.toContain('secret123');
    expect(takeAccountHandoff()).toEqual({ kind: 'reset-password', token: 'secret123' });
    expect(takeAccountHandoff()).toBeNull();
  });

  it('leaves other addresses alone', () => {
    history.replaceState(null, '', '/#/read/John.3');
    accountsModule.takeUrl?.();
    expect(location.hash).toBe('#/read/John.3');
    expect(takeAccountHandoff()).toBeNull();
  });
});

describe('manifest', () => {
  it('is behind flag accounts and contributes the Settings section', () => {
    expect(accountsModule.manifest.flag).toBe('accounts');
    const section = accountsModule.manifest.contributes.preferencesSections?.[0];
    expect(section?.id).toBe('account');
    expect((section?.title as { key?: string } | undefined)?.key).toBe('settings.tabs.account');
    expect(accountsModule.manifest.contributes.i18nNamespace).toBe('accounts');
    expect(accountsModule.binding?.views?.['preferences:account']).toBeTypeOf('function');
  });

  it('opens no worker when only the binding is imported', () => {
    // The binding must not import src/userdb (entry-chunk rule); loading it creates no client.
    expect(accountsModule.probe?.()).toEqual({ activate: true });
  });
});
