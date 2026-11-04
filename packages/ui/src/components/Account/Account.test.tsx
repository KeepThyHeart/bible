import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AccountPanel, ChangePasswordForm, DEFAULT_SIGN_UP_LABELS, PrivacyPanel, RecoverForm, RecoveryCodeStep,
  SignInForm, SignUpForm, SyncStatusBadge,
} from './index';
import type { PasswordStrength } from './types';

const strong = async (): Promise<PasswordStrength> => ({ score: 4, feedback: [] });
const score = (n: 0 | 1 | 2 | 3 | 4) => async (): Promise<PasswordStrength> => ({ score: n, feedback: ['Add another word.'] });
const ok = async () => undefined;

async function fillSignUp(user: ReturnType<typeof userEvent.setup>, pw = 'correct horse', confirm = pw) {
  await user.type(screen.getByLabelText('Email address'), 'a@b.co');
  await user.type(screen.getByLabelText('Password'), pw);
  await user.type(screen.getByLabelText('Confirm password'), confirm);
}

describe('SignUpForm', () => {
  it('submits only after strength is checked, consents are ticked and passwords match', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(ok);
    render(<SignUpForm onSubmit={onSubmit} checkStrength={strong} minAge={16} termsUrl="https://example.org/t" privacyUrl="http://localhost:3000/p" />);
    const submit = screen.getByRole('button', { name: DEFAULT_SIGN_UP_LABELS.submit });
    await fillSignUp(user);
    expect(await screen.findByText('Strong')).toBeInTheDocument();
    expect(submit).toBeDisabled(); // consents missing
    await user.click(screen.getByLabelText(DEFAULT_SIGN_UP_LABELS.consentTerms));
    expect(submit).toBeDisabled(); // age missing
    await user.click(screen.getByLabelText('I am at least 16 years old.'));
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(onSubmit).toHaveBeenCalledWith({ email: 'a@b.co', password: 'correct horse', consentTerms: true, ageConfirmed: true });
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', 'https://example.org/t');
  });

  it('renders only https (or loopback http) terms/privacy URLs as links (R2 L4)', () => {
    render(<SignUpForm onSubmit={ok} checkStrength={strong} minAge={16} termsUrl="javascript:alert(1)" privacyUrl="http://evil.example/p" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(DEFAULT_SIGN_UP_LABELS.termsLink)).toBeInTheDocument();
    expect(screen.getByText(DEFAULT_SIGN_UP_LABELS.privacyLink)).toBeInTheDocument();
  });

  it('blocks submit below minScore (default 3) and shows the too-weak hint', async () => {
    const user = userEvent.setup();
    render(<SignUpForm onSubmit={ok} checkStrength={score(2)} minAge={13} />);
    await fillSignUp(user);
    await user.click(screen.getByLabelText(DEFAULT_SIGN_UP_LABELS.consentTerms));
    await user.click(screen.getByLabelText('I am at least 13 years old.'));
    expect(await screen.findByText(DEFAULT_SIGN_UP_LABELS.tooWeak)).toBeInTheDocument();
    expect(screen.getByText('Add another word.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: DEFAULT_SIGN_UP_LABELS.submit })).toBeDisabled();
  });

  it('honours a lower minScore', async () => {
    const user = userEvent.setup();
    render(<SignUpForm onSubmit={ok} checkStrength={score(2)} minScore={2} minAge={13} />);
    await fillSignUp(user);
    await user.click(screen.getByLabelText(DEFAULT_SIGN_UP_LABELS.consentTerms));
    await user.click(screen.getByLabelText('I am at least 13 years old.'));
    await waitFor(() => expect(screen.getByRole('button', { name: DEFAULT_SIGN_UP_LABELS.submit })).toBeEnabled());
  });

  it('blocks submit when the passwords differ and says so', async () => {
    const user = userEvent.setup();
    render(<SignUpForm onSubmit={ok} checkStrength={strong} minAge={13} />);
    await fillSignUp(user, 'correct horse', 'other');
    expect(screen.getByText(DEFAULT_SIGN_UP_LABELS.passwordsDiffer)).toBeInTheDocument();
    await user.click(screen.getByLabelText(DEFAULT_SIGN_UP_LABELS.consentTerms));
    await user.click(screen.getByLabelText('I am at least 13 years old.'));
    await screen.findByText('Strong');
    expect(screen.getByRole('button', { name: DEFAULT_SIGN_UP_LABELS.submit })).toBeDisabled();
  });

  it('shows busy text and error, and accepts label overrides', () => {
    render(<SignUpForm onSubmit={ok} checkStrength={strong} minAge={13} busy error="Nope" labels={{ busy: 'Wait', title: 'Join' }} />);
    expect(screen.getByRole('button', { name: 'Wait' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Nope');
    expect(screen.getByRole('heading', { name: 'Join' })).toBeInTheDocument();
  });
});

describe('RecoveryCodeStep', () => {
  const code = 'ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345-6789';
  // random() = 0 always picks the front of the shuffle; positions are asked in ascending order.
  const positionsAsked = () => screen.getAllByLabelText(/^Character \d+$/).map((el) => Number(el.getAttribute('id') && (document.querySelector(`label[for="${el.id}"]`)?.textContent ?? '').replace(/\D/g, '')));

  it('asks 4 positions, rejects wrong characters and confirms only on a match', async () => {
    const user = userEvent.setup();
    const onConfirmed = vi.fn();
    render(<RecoveryCodeStep code={code} onConfirmed={onConfirmed} random={() => 0} />);
    const chars = code.replace(/-/g, '');
    const pos = positionsAsked();
    expect(pos).toHaveLength(4);
    expect(new Set(pos).size).toBe(4);
    const inputs = screen.getAllByLabelText(/^Character \d+$/);
    const confirm = screen.getByRole('button', { name: 'I have saved my code' });
    expect(confirm).toBeDisabled();
    for (const i of inputs) await user.type(i, '!');
    await user.click(confirm);
    expect(screen.getByRole('alert')).toHaveTextContent('do not match');
    expect(onConfirmed).not.toHaveBeenCalled();
    for (let i = 0; i < 4; i++) { await user.clear(inputs[i]); await user.type(inputs[i], chars[pos[i] - 1].toLowerCase()); }
    await user.click(confirm);
    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });

  it('shows the code in groups, copies it and offers download when given', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const onDownload = vi.fn();
    render(<RecoveryCodeStep code={code} onConfirmed={() => undefined} onDownload={onDownload} />);
    expect(screen.getByText('ABCD')).toBeInTheDocument();
    expect(screen.getByText('6789')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(code);
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(onDownload).toHaveBeenCalled();
  });

  it('copes with a missing clipboard and hides download without a handler', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    render(<RecoveryCodeStep code={code} onConfirmed={() => undefined} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Copy' }));
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
  });
});

describe('SignInForm', () => {
  it('has remember off by default, only when showRemember, and submits it', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(ok);
    const { unmount } = render(<SignInForm onSubmit={onSubmit} onForgot={() => undefined} showRemember={false} />);
    expect(screen.queryByLabelText(/Keep me signed in/)).toBeNull();
    unmount();
    render(<SignInForm onSubmit={onSubmit} onForgot={() => undefined} showRemember />);
    const box = screen.getByLabelText(/Keep me signed in/);
    expect(box).not.toBeChecked();
    await user.type(screen.getByLabelText('Email address'), 'a@b.co');
    await user.type(screen.getByLabelText('Password'), 'pw');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSubmit).toHaveBeenLastCalledWith({ email: 'a@b.co', password: 'pw', remember: false });
    await user.click(box);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSubmit).toHaveBeenLastCalledWith({ email: 'a@b.co', password: 'pw', remember: true });
  });

  it('calls onForgot and shows the error', async () => {
    const onForgot = vi.fn();
    render(<SignInForm onSubmit={ok} onForgot={onForgot} showRemember={false} error="Wrong" />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Forgot your password?' }));
    expect(onForgot).toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Wrong');
  });
});

describe('RecoverForm', () => {
  it('recovers with email, code and a strong matching password', async () => {
    const user = userEvent.setup();
    const onRecover = vi.fn(ok);
    render(<RecoverForm onRecover={onRecover} onStartOver={ok} checkStrength={strong} />);
    await user.type(screen.getByLabelText('Email address'), 'a@b.co');
    await user.type(screen.getByLabelText('Recovery code'), 'ABCD-EFGH');
    await user.type(screen.getByLabelText('New password'), 'correct horse');
    await user.type(screen.getByLabelText('Confirm new password'), 'correct horse');
    const submit = screen.getByRole('button', { name: 'Recover account' });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);
    expect(onRecover).toHaveBeenCalledWith({ email: 'a@b.co', code: 'ABCD-EFGH', newPassword: 'correct horse' });
  });

  it('start over needs an email and shows the sent notice', async () => {
    const user = userEvent.setup();
    const onStartOver = vi.fn(ok);
    render(<RecoverForm onRecover={ok} onStartOver={onStartOver} checkStrength={strong} />);
    await user.click(screen.getByRole('button', { name: /don't have my recovery code/ }));
    const start = screen.getByRole('button', { name: 'Email me a link to start over' });
    expect(start).toBeDisabled();
    await user.type(screen.getByLabelText('Email address'), 'a@b.co');
    await user.click(start);
    expect(onStartOver).toHaveBeenCalledWith('a@b.co');
    expect(await screen.findByText(/an email is on its way/)).toBeInTheDocument();
  });

  it('blocks a weak password', async () => {
    const user = userEvent.setup();
    render(<RecoverForm onRecover={ok} onStartOver={ok} checkStrength={score(1)} />);
    await user.type(screen.getByLabelText('Email address'), 'a@b.co');
    await user.type(screen.getByLabelText('Recovery code'), 'X');
    await user.type(screen.getByLabelText('New password'), 'abc');
    await user.type(screen.getByLabelText('Confirm new password'), 'abc');
    await screen.findByText(/Choose a stronger/);
    expect(screen.getByRole('button', { name: 'Recover account' })).toBeDisabled();
  });
});

describe('ChangePasswordForm', () => {
  it('submits current, next and signOutOthers; cancel only with a handler', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(ok);
    const onCancel = vi.fn();
    render(<ChangePasswordForm onSubmit={onSubmit} checkStrength={strong} onCancel={onCancel} />);
    await user.type(screen.getByLabelText('Current password'), 'old');
    await user.type(screen.getByLabelText('New password'), 'new horse battery');
    await user.type(screen.getByLabelText('Confirm new password'), 'new horse battery');
    const submit = screen.getByRole('button', { name: 'Change password' });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);
    expect(onSubmit).toHaveBeenCalledWith({ current: 'old', next: 'new horse battery', signOutOthers: true });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('blocks mismatched passwords', async () => {
    const user = userEvent.setup();
    render(<ChangePasswordForm onSubmit={ok} checkStrength={strong} />);
    await user.type(screen.getByLabelText('Current password'), 'old');
    await user.type(screen.getByLabelText('New password'), 'aaaa');
    await user.type(screen.getByLabelText('Confirm new password'), 'bbbb');
    await waitFor(() => expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '4'));
    expect(screen.getByRole('button', { name: 'Change password' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });
});

describe('AccountPanel', () => {
  const status = { state: 'idle' as const, pending: 2, opaque: 1, lastSyncedAt: '2026-10-01T10:00:00Z' };
  const devices = [
    { id: 'd1', name: 'Laptop', lastSeenAt: '2026-10-01T10:00:00Z', current: true },
    { id: 'd2', name: 'Phone', lastSeenAt: '2026-09-30T10:00:00Z', current: false },
  ];
  const setup = (over = {}) => {
    const p = { onSyncNow: vi.fn(), onRevoke: vi.fn(ok), onChangePassword: vi.fn(), onNewRecoveryCode: vi.fn(), onSignOut: vi.fn(ok) };
    render(<AccountPanel email="me@x.co" status={status} usage={{ bytesUsed: 1048576, quotaBytes: 4194304 }} devices={devices} {...p} {...over} />);
    return p;
  };

  it('renders the account, usage, pending/opaque counts and revokes other devices only', async () => {
    const user = userEvent.setup();
    const p = setup();
    expect(screen.getByText('me@x.co')).toBeInTheDocument();
    expect(screen.getByText('1.0 MB / 4.0 MB')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByText('2 changes waiting to sync')).toBeInTheDocument();
    expect(screen.getByText(/1 items from a newer version/)).toBeInTheDocument();
    expect(screen.getByText('This device')).toBeInTheDocument();
    const revoke = screen.getAllByRole('button', { name: 'Sign out this device' });
    expect(revoke).toHaveLength(1);
    await user.click(revoke[0]);
    expect(p.onRevoke).toHaveBeenCalledWith('d2');
    await user.click(screen.getByRole('button', { name: 'Sync now' }));
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    await user.click(screen.getByRole('button', { name: 'Create a new recovery code' }));
    expect(p.onSyncNow).toHaveBeenCalled();
    expect(p.onChangePassword).toHaveBeenCalled();
    expect(p.onNewRecoveryCode).toHaveBeenCalled();
  });

  it('sign out offers keep or wipe with the warning, and cancel', async () => {
    const user = userEvent.setup();
    const p = setup();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.getByText(/will be lost/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /keep my data/ }));
    expect(p.onSignOut).toHaveBeenLastCalledWith(false);
    await user.click(screen.getByRole('button', { name: /remove my data/ }));
    expect(p.onSignOut).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText(/will be lost/)).toBeNull();
  });

  it('shows Never when nothing has synced', () => {
    setup({ status: { state: 'idle', pending: 0, opaque: 0 } });
    expect(screen.getByText(/Last synced: Never/)).toBeInTheDocument();
  });
});

describe('PrivacyPanel', () => {
  const setup = () => {
    const p = { onExportPlain: vi.fn(ok), onExportEncrypted: vi.fn(ok), onExportServerData: vi.fn(ok), onDeleteAccount: vi.fn(ok) };
    render(<PrivacyPanel {...p} serverSees={['Your email', 'Encrypted blobs']} />);
    return p;
  };

  it('lists what the server sees and runs the exports', async () => {
    const user = userEvent.setup();
    const p = setup();
    expect(screen.getByText('Your email')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Export readable data' }));
    await user.click(screen.getByRole('button', { name: 'Export encrypted backup' }));
    await user.click(screen.getByRole('button', { name: 'Export what the server holds' }));
    expect(p.onExportPlain).toHaveBeenCalled();
    expect(p.onExportEncrypted).toHaveBeenCalled();
    expect(p.onExportServerData).toHaveBeenCalled();
  });

  it('delete needs the password', async () => {
    const user = userEvent.setup();
    const p = setup();
    await user.click(screen.getByRole('button', { name: 'Delete account...' }));
    const confirm = screen.getByRole('button', { name: 'Delete my account permanently' });
    expect(confirm).toBeDisabled();
    fireEvent.submit(confirm.closest('form')!);
    expect(p.onDeleteAccount).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Enter your password to confirm'), 'secret');
    await user.click(confirm);
    expect(p.onDeleteAccount).toHaveBeenCalledWith('secret');
  });
});

describe('SyncStatusBadge', () => {
  it('shows the state, pending count and last-synced title', () => {
    render(<SyncStatusBadge status={{ state: 'offline', pending: 3, opaque: 0, lastSyncedAt: '2026-10-01T10:00:00Z' }} />);
    const el = screen.getByRole('status');
    expect(el).toHaveTextContent('Offline');
    expect(el).toHaveTextContent('3 waiting');
    expect(el.getAttribute('title')).toMatch(/^Last synced /);
  });

  it('is a button only with onClick, hides pending when signed out, and takes labels', async () => {
    const onClick = vi.fn();
    const { unmount } = render(<SyncStatusBadge status={{ state: 'signed-out', pending: 5, opaque: 0 }} onClick={onClick} labels={{ signedOut: 'Out' }} />);
    const btn = screen.getByRole('button', { name: 'Out' });
    expect(btn).not.toHaveTextContent('waiting');
    await userEvent.setup().click(btn);
    expect(onClick).toHaveBeenCalled();
    unmount();
    render(<SyncStatusBadge status={{ state: 'error', pending: 0, opaque: 0 }} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Sync problem');
  });
});

describe('Account CSS classes', () => {
  it('every kth- class used by the components is defined in kth-classes.css or kth-account.css', () => {
    const css = ['kth-classes.css', 'kth-account.css'].map((f) => readFileSync(join(__dirname, '../../../css', f), 'utf8')).join('\n');
    const defined = new Set(css.match(/\.kth-[\w-]+/g)!.map((c) => c.slice(1)));
    const used = new Set<string>();
    for (const f of readdirSync(__dirname).filter((n) => /\.tsx$/.test(n) && !/\.test\./.test(n))) {
      for (const m of readFileSync(join(__dirname, f), 'utf8').matchAll(/['"`]([^'"`\n]*\bkth-[\w-]+[^'"`\n]*)['"`]/g)) {
        for (const c of m[1].replace(/\$\{[^}]*\}/g, '').split(/\s+/)) if (c.startsWith('kth-')) used.add(c);
      }
    }
    // Template-built modifiers: check the concrete ones separately.
    const concrete = [...used].filter((c) => !c.includes('${') && !c.endsWith('--'));
    for (const st of ['signed-out', 'locked', 'idle', 'syncing', 'offline', 'error']) concrete.push(`kth-account__badge-dot--${st}`);
    const optional = new Set(['kth-account__badge-dot--signed-out', 'kth-account__badge-dot--locked']);
    const missing = concrete.filter((c) => !defined.has(c) && !optional.has(c));
    expect(missing).toEqual([]);
  });
});
