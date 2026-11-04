import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Sync } from '@bible/core/browser';
import type { AccountsInfo } from '../../../../electron/modules/accounts/types';
import en from '../../../../locales/en/accounts.json';
import { AccountSection } from './AccountSection';
import { useAccountsStore } from './useAccountsStore';

const catalog = en as Record<string, string>;
vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({
    locale: 'en',
    t: (key: string, params?: Record<string, unknown>) => {
      let s = catalog[key] ?? key;
      for (const [k, v] of Object.entries(params ?? {})) if (v !== `{${k}}`) s = s.replace(`{${k}}`, String(v));
      return s;
    },
  }),
}));

const openDialog = vi.fn();
vi.mock('../../stores/useBackupStore', () => ({ useBackupStore: { getState: () => ({ openDialog }) } }));

vi.mock('@bible/core/browser', async (orig) => {
  const mod = await orig<typeof import('@bible/core/browser')>();
  return { ...mod, Sync: { ...mod.Sync, passwordStrength: async () => ({ score: 4, feedback: [] }) } };
});

const SERVER: Sync.InfoResponse = { apiVersion: 1, signupOpen: true, quotaBytes: 1000, minKdf: { m: 1, t: 1 }, minAge: 16 };
const idle: Sync.SyncStatus = { state: 'idle', accountEmail: 'me@example.org', pending: 0, opaque: 0 };

function makeInfo(over: Partial<AccountsInfo> = {}, settings: Partial<AccountsInfo['settings']> = {}): AccountsInfo {
  return {
    settings: { serverUrl: 'https://sync.example.org', askPasswordEachLaunch: false, secretStoreWeak: false, networkAllowed: true, ...settings },
    server: SERVER, account: null, email: null, bnWarnings: [], ...over,
  };
}

let state: { status: Sync.SyncStatus; info: AccountsInfo };
type Fn = (...args: unknown[]) => Promise<unknown>;
const api: Record<string, ReturnType<typeof vi.fn<Fn>>> = {};
const methods = ['status', 'info', 'signUp', 'signIn', 'unlock', 'recover', 'signOut', 'changePassword', 'newRecoveryCode', 'devices',
  'revokeDevice', 'syncNow', 'setServerUrl', 'setAskPasswordEachLaunch', 'requestStartOver', 'resendVerification',
  'saveRecoveryCode', 'deleteAccount', 'exportServerData'];

const bridge = {
  invoke: (_ns: string, method: string, ...args: unknown[]) =>
    (api[method] as unknown as Fn)(...args).then(
      (value: unknown) => ({ ok: true, value }),
      (err: Error & { code?: string }) => ({ ok: false, error: { code: err.code ?? 'internal', message: err.message } }),
    ),
  on: () => () => undefined,
};

beforeEach(() => {
  for (const m of methods) api[m] = vi.fn().mockResolvedValue(undefined);
  openDialog.mockReset();
  state = { status: { state: 'signed-out', pending: 0, opaque: 0 }, info: makeInfo() };
  api.status!.mockImplementation(async () => state.status);
  api.info!.mockImplementation(async () => state.info);
  api.devices!.mockResolvedValue([]);
  useAccountsStore.setState({ status: null, info: null, devices: [], busy: false, error: null, pendingRecoveryCode: null });
  (window as unknown as { electron: unknown }).electron = { modules: bridge };
});

describe('AccountSection', () => {
  it('asks for a server address first and saves it', async () => {
    state.info = makeInfo({}, { serverUrl: '' });
    api.setServerUrl!.mockImplementation(async (url: unknown) => { state.info = makeInfo({}, { serverUrl: String(url) }); return state.info.settings; });
    render(<AccountSection />);
    await userEvent.type(await screen.findByLabelText('Server address'), 'https://sync.example.org');
    await userEvent.click(screen.getByRole('button', { name: 'Save server' }));
    expect(api.setServerUrl).toHaveBeenCalledWith('https://sync.example.org');
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows a localised error for a rejected server address', async () => {
    state.info = makeInfo({}, { serverUrl: '' });
    api.setServerUrl!.mockRejectedValue(Object.assign(new Error('bad_request'), { code: 'invalid_input' }));
    render(<AccountSection />);
    await userEvent.type(await screen.findByLabelText('Server address'), 'http://evil');
    await userEvent.click(screen.getByRole('button', { name: 'Save server' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(catalog['accounts.error.bad_request']!);
  });

  it('explains blocked web requests and points at the Privacy section', async () => {
    state.info = makeInfo({}, { networkAllowed: false });
    const seen: unknown[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener('open-preferences-section', listener);
    render(<AccountSection />);
    await userEvent.click(await screen.findByRole('button', { name: 'Open Privacy settings' }));
    window.removeEventListener('open-preferences-section', listener);
    expect(seen).toEqual(['privacy']);
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('signs in with the remember choice (offered when the keyring is secure)', async () => {
    render(<AccountSection />);
    await userEvent.type(await screen.findByLabelText('Email address'), 'me@example.org');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse');
    await userEvent.click(screen.getByLabelText('Keep me signed in on this device'));
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(api.signIn).toHaveBeenCalledWith({ email: 'me@example.org', password: 'correct horse', remember: true });
  });

  it('hides "remember" and warns when the keyring is weak', async () => {
    state.info = makeInfo({}, { secretStoreWeak: true });
    render(<AccountSection />);
    await screen.findByLabelText('Email address');
    expect(screen.queryByLabelText('Keep me signed in on this device')).not.toBeInTheDocument();
    expect(screen.getByTestId('accounts-weak-keyring')).toBeInTheDocument();
  });

  it('shows a failed sign-in as localised text', async () => {
    api.signIn!.mockRejectedValue(Object.assign(new Error('unauthorized'), { code: 'unauthorized' }));
    render(<AccountSection />);
    await userEvent.type(await screen.findByLabelText('Email address'), 'me@example.org');
    await userEvent.type(screen.getByLabelText('Password'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(catalog['accounts.error.unauthorized']!)).toBeInTheDocument();
  });

  it('keeps showing the recovery code until it is confirmed, and downloads it through main', async () => {
    api.signUp!.mockResolvedValue({ recoveryCode: 'ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345-6789' });
    state.info = makeInfo();
    render(<AccountSection />);
    await userEvent.click(await screen.findByRole('button', { name: 'Create an account' }));
    await userEvent.type(await screen.findByLabelText('Email address'), 'new@example.org');
    await userEvent.type(screen.getByLabelText('Password'), 'a very long unusual passphrase');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'a very long unusual passphrase');
    const boxes = screen.getAllByRole('checkbox');
    for (const b of boxes) await userEvent.click(b);
    const create = screen.getByRole('button', { name: 'Create account' });
    await waitFor(() => expect(create).toBeEnabled());
    await userEvent.click(create);
    expect(await screen.findByText('Save your recovery code')).toBeInTheDocument();
    expect(api.signUp).toHaveBeenCalledWith({ email: 'new@example.org', password: 'a very long unusual passphrase', consent: { terms: true, ageConfirmed: true } });
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(api.saveRecoveryCode).toHaveBeenCalledWith({ code: 'ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345-6789' });
    expect(screen.getByText('Save your recovery code')).toBeInTheDocument();
    act(() => useAccountsStore.getState().confirmRecoveryCode()); // allow-getstate: test
    await waitFor(() => expect(screen.queryByText('Save your recovery code')).not.toBeInTheDocument());
  });

  describe('signed in', () => {
    beforeEach(() => {
      state.status = idle;
      state.info = makeInfo({
        email: 'me@example.org',
        account: { email: 'me@example.org', emailVerified: false, bytesUsed: 100, quotaBytes: 1000, createdAt: '2026-01-01T00:00:00Z', recordCount: 3 },
      });
      api.devices!.mockResolvedValue([
        { id: 'd1', name: 'Laptop', createdAt: '2026-01-01T00:00:00Z', lastSeenAt: '2026-01-02T00:00:00Z', userAgent: null, current: true },
        { id: 'd2', name: 'Phone', createdAt: '2026-01-01T00:00:00Z', lastSeenAt: '2026-01-02T00:00:00Z', userAgent: null, current: false },
      ]);
    });

    it('shows the account, devices, unverified banner and resends the mail', async () => {
      render(<AccountSection />);
      expect(await screen.findByText('me@example.org')).toBeInTheDocument();
      expect(await screen.findByText('Phone')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Resend email' }));
      expect(api.resendVerification).toHaveBeenCalledTimes(1);
    });

    it('revokes another device and signs out keeping data', async () => {
      render(<AccountSection />);
      await userEvent.click(await screen.findByRole('button', { name: 'Sign out this device' }));
      expect(api.revokeDevice).toHaveBeenCalledWith('d2');
      await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
      await userEvent.click(screen.getByRole('button', { name: 'Sign out and keep syncing data on this computer' }));
      expect(api.signOut).toHaveBeenCalledWith({ wipeLocal: false });
    });

    it('toggles ask-password-each-launch; it is checked and disabled when the keyring is weak', async () => {
      render(<AccountSection />);
      const box = await screen.findByLabelText('Ask for my password each time the app starts');
      expect(box).not.toBeChecked();
      api.setAskPasswordEachLaunch!.mockResolvedValue({ ...state.info.settings, askPasswordEachLaunch: true });
      await userEvent.click(box);
      expect(api.setAskPasswordEachLaunch).toHaveBeenCalledWith(true);
    });

    it('weak keyring: the checkbox is on and disabled', async () => {
      state.info = { ...state.info, settings: { ...state.info.settings, secretStoreWeak: true } };
      render(<AccountSection />);
      const box = await screen.findByLabelText('Ask for my password each time the app starts');
      expect(box).toBeChecked();
      expect(box).toBeDisabled();
    });

    it('change password toggles a form that can be cancelled and submits', async () => {
      render(<AccountSection />);
      await userEvent.click(await screen.findByRole('button', { name: 'Change password' }));
      await userEvent.type(screen.getByLabelText('Current password'), 'old pass phrase');
      await userEvent.type(screen.getByLabelText('New password'), 'new unusual pass phrase');
      await userEvent.type(screen.getByLabelText('Confirm new password'), 'new unusual pass phrase');
      const submit = screen.getByLabelText('Current password').closest('form')!.querySelector('button[type=submit]') as HTMLButtonElement;
      await waitFor(() => expect(submit).toBeEnabled());
      await userEvent.click(submit);
      expect(api.changePassword).toHaveBeenCalledWith({ current: 'old pass phrase', next: 'new unusual pass phrase', signOutOthers: true });
    });

    it('lists skipped .bn files', async () => {
      state.info = { ...state.info, bnWarnings: [{ path: 'big.bn', reason: 'too_large' }] };
      render(<AccountSection />);
      expect(await screen.findByTestId('accounts-bn-warnings')).toHaveTextContent('big.bn');
    });

    it('export buttons open the backup dialog / ask main for the server export', async () => {
      render(<AccountSection />);
      await userEvent.click(await screen.findByRole('button', { name: 'Export readable data' }));
      expect(openDialog).toHaveBeenCalledWith('backup');
      await userEvent.click(screen.getByRole('button', { name: 'Export what the server holds' }));
      expect(api.exportServerData).toHaveBeenCalledTimes(1);
    });
  });

  it('locked: unlocks with the password, or signs out', async () => {
    state.status = { state: 'locked', accountEmail: 'me@example.org', pending: 0, opaque: 0 };
    state.info = makeInfo({ email: 'me@example.org' });
    render(<AccountSection />);
    await userEvent.type(await screen.findByLabelText('Password'), 'pw one two');
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(api.unlock).toHaveBeenCalledWith({ password: 'pw one two' });
    await userEvent.click(screen.getByRole('button', { name: 'Sign out instead' }));
    expect(api.signOut).toHaveBeenCalledWith({ wipeLocal: false });
  });
});
