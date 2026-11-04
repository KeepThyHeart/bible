/**
 * AccountSection.tsx
 *
 * Preferences > Account & sync (task 0150). A thin host for the shared `@bible/ui` Account components: all state
 * lives in the main process (`DesktopSyncService`), reached through the module client; this file chooses what to
 * show for each state (no server, web requests blocked, signed out, recovery code pending, signed in, locked),
 * wires the callbacks to `useAccountsStore` and localises every string (`accounts.*`).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Sync } from '@bible/core/browser';
import {
  AccountPanel, ChangePasswordForm, PrivacyPanel, RecoverForm, RecoveryCodeStep, SignInForm, SignUpForm, SyncStatusBadge,
} from '@bible/ui';
import { useI18n } from '../../contexts/useI18n';
import { useBackupStore } from '../../stores/useBackupStore';
import { useModuleNamespace } from '../host/useModuleNamespace';
import { failureKey } from './errors';
import { accountLabels } from './labels';
import { useAccountsStore, type AccountsErrorScope } from './useAccountsStore';

type SignedOutMode = 'signIn' | 'signUp' | 'recover';

/** zxcvbn-ts feedback keys that have an `accounts.feedback.<key>` string; others are dropped. */
const FEEDBACK_KEYS = new Set([
  'straightRow', 'keyPattern', 'simpleRepeat', 'extendedRepeat', 'sequences', 'recentYears', 'dates', 'topTen',
  'topHundred', 'common', 'similarToCommon', 'wordByItself', 'namesByThemselves', 'commonNames', 'userInputs', 'pwned',
  'l33t', 'reverseWords', 'allUppercase', 'capitalization', 'dictionary', 'extraWords', 'anotherWord', 'useWords',
  'useLonger', 'noNeed', 'repeated', 'associatedYears',
]);

const SERVER_SEES_KEYS = ['accounts.serverSees.1', 'accounts.serverSees.2', 'accounts.serverSees.3'];

function openPreferencesSection(id: string): void {
  window.dispatchEvent(new CustomEvent('open-preferences-section', { detail: id }));
}

function openBackupDialog(): Promise<void> {
  useBackupStore.getState().openDialog('backup'); // allow-getstate: click handler, outside render
  return Promise.resolve();
}

/** A one-field form (server URL, current password, unlock password). */
function SingleFieldForm(props: {
  title?: string; label: string; type: 'text' | 'password'; submitLabel: string; busy: boolean; error?: string;
  autoComplete?: string; hint?: string; initial?: string; onSubmit(value: string): void | Promise<void>;
  secondary?: { label: string; onClick(): void };
}) {
  const [value, setValue] = useState(props.initial ?? '');
  const id = `account-field-${props.label.replace(/\W+/g, '-')}`;
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (value.trim() === '' || props.busy) return;
    void props.onSubmit(value);
  };
  return (
    <form className="kth-account" onSubmit={submit} noValidate>
      {props.title ? <h2 className="kth-account__title">{props.title}</h2> : null}
      <div className="kth-field">
        <label htmlFor={id}>{props.label}</label>
        <input
          id={id} className="kth-input" type={props.type} value={value} autoComplete={props.autoComplete}
          spellCheck={false} autoCapitalize="off" disabled={props.busy} onChange={(e) => setValue(e.target.value)}
        />
        {props.hint ? <p className="kth-field__hint">{props.hint}</p> : null}
      </div>
      {props.error ? <p className="kth-account__error" role="alert">{props.error}</p> : null}
      <div className="kth-account__actions">
        <button type="submit" className="kth-btn kth-btn--primary" disabled={props.busy || value.trim() === ''}>{props.submitLabel}</button>
        {props.secondary ? (
          <button type="button" className="kth-account__link" onClick={props.secondary.onClick} disabled={props.busy}>{props.secondary.label}</button>
        ) : null}
      </div>
    </form>
  );
}

function AccountSectionBody() {
  const { t } = useI18n();
  const store = useAccountsStore();
  const { status, info, devices, busy, error, pendingRecoveryCode } = store;
  const [mode, setMode] = useState<SignedOutMode>('signIn');
  const [editingServer, setEditingServer] = useState(false);
  const [changing, setChanging] = useState(false);
  const [askingNewCode, setAskingNewCode] = useState(false);
  const [resent, setResent] = useState(false);

  const labels = useMemo(() => accountLabels(t), [t]);
  const errorFor = (...scopes: AccountsErrorScope[]): string | undefined =>
    error && scopes.includes(error.scope) ? t(failureKey(error.token)) : undefined;

  const email = status?.accountEmail ?? info?.email ?? '';
  const userInputs = useMemo(() => Sync.emailUserInputs(email), [email]);
  const checkStrength = useCallback(
    async (pw: string) => {
      const r = await Sync.passwordStrength(pw, userInputs);
      return {
        score: r.score,
        feedback: r.feedback.filter((k) => FEEDBACK_KEYS.has(k)).map((k) => t(`accounts.feedback.${k}`)),
      };
    },
    [t, userInputs],
  );

  if (!status || !info) {
    return <p data-testid="accounts-loading">{t(error ? 'accounts.loadError' : 'accounts.loading')}</p>;
  }

  const { settings, server, account } = info;
  const weakNotice = settings.secretStoreWeak ? (
    <p className="kth-account__notice" data-testid="accounts-weak-keyring">{t('accounts.weakKeyring')}</p>
  ) : null;
  const header = (
    <div className="kth-account__row kth-account__row--between">
      <h2 className="kth-account__title">{t('accounts.title')}</h2>
      <SyncStatusBadge status={status} labels={labels.syncStatus} />
    </div>
  );

  // The recovery code is shown before anything else and only a confirmed code clears it.
  if (pendingRecoveryCode) {
    return (
      <div className="kth-account__stack">
        {header}
        <RecoveryCodeStep
          code={pendingRecoveryCode}
          labels={labels.recoveryCode}
          onDownload={() => { void store.saveRecoveryCode(); }}
          onConfirmed={store.confirmRecoveryCode}
        />
        {errorFor('recoveryCode') ? <p className="kth-account__error" role="alert">{errorFor('recoveryCode')}</p> : null}
      </div>
    );
  }

  const signedIn = status.state !== 'signed-out' && status.state !== 'locked';

  const serverForm = (
    <SingleFieldForm
      title={settings.serverUrl ? undefined : t('accounts.server.title')}
      label={t('accounts.server.label')} hint={t('accounts.server.hint')} type="text" initial={settings.serverUrl}
      submitLabel={t('accounts.server.save')} busy={busy} error={errorFor('server')} autoComplete="url"
      onSubmit={async (url) => { await store.setServerUrl(url); if (!useAccountsStore.getState().error) setEditingServer(false); }} // allow-getstate: after await
      secondary={settings.serverUrl ? { label: t('accounts.cancel'), onClick: () => { setEditingServer(false); store.clearError(); } } : undefined}
    />
  );

  let body;
  if (signedIn) {
    const unverified = account && !account.emailVerified;
    body = (
      <>
        {unverified ? (
          <div className="kth-account__notice" role="status" data-testid="accounts-unverified">
            <p>{t('accounts.unverified')}</p>
            <button
              type="button" className="kth-btn kth-btn--sm" disabled={busy || resent}
              onClick={() => { void store.resendVerification().then(() => setResent(!useAccountsStore.getState().error)); }} // allow-getstate: after await
            >{resent ? t('accounts.resent') : t('accounts.resend')}</button>
          </div>
        ) : null}
        <AccountPanel
          email={email}
          status={status}
          usage={{ bytesUsed: account?.bytesUsed ?? 0, quotaBytes: account?.quotaBytes ?? server?.quotaBytes ?? 0 }}
          devices={devices.map((d) => ({ id: d.id, name: d.name, lastSeenAt: d.lastSeenAt, current: d.current }))}
          labels={labels.accountPanel}
          onSyncNow={() => { void store.syncNow(); }}
          onRevoke={(id) => store.revokeDevice(id)}
          onChangePassword={() => { setChanging((v) => !v); setAskingNewCode(false); store.clearError(); }}
          onNewRecoveryCode={() => { setAskingNewCode((v) => !v); setChanging(false); store.clearError(); }}
          onSignOut={(wipe) => store.signOut(wipe)}
        />
        {errorFor('account') ? <p className="kth-account__error" role="alert">{errorFor('account')}</p> : null}
        {changing ? (
          <ChangePasswordForm
            labels={labels.changePassword} checkStrength={checkStrength} busy={busy} error={errorFor('changePassword')}
            onCancel={() => setChanging(false)}
            onSubmit={async (v) => { await store.changePassword(v); if (!useAccountsStore.getState().error) setChanging(false); }} // allow-getstate: after await
          />
        ) : null}
        {askingNewCode ? (
          <SingleFieldForm
            label={t('accounts.newCode.password')} type="password" autoComplete="current-password"
            submitLabel={t('accounts.newCode.submit')} busy={busy} error={errorFor('changePassword')}
            onSubmit={async (pw) => { await store.newRecoveryCode(pw); setAskingNewCode(false); }}
            secondary={{ label: t('accounts.cancel'), onClick: () => setAskingNewCode(false) }}
          />
        ) : null}
        <label className="kth-account__check">
          <input
            type="checkbox"
            checked={settings.askPasswordEachLaunch || settings.secretStoreWeak}
            disabled={settings.secretStoreWeak || busy}
            onChange={(e) => { void store.setAskPasswordEachLaunch(e.target.checked); }}
          />
          <span>{t('accounts.askEachLaunch')}</span>
        </label>
        {info.bnWarnings.length > 0 ? (
          <div className="kth-account__section" data-testid="accounts-bn-warnings">
            <h3 className="kth-account__subtitle">{t('accounts.bnWarnings.title', { count: info.bnWarnings.length })}</h3>
            <p className="kth-account__muted">{t('accounts.bnWarnings.intro')}</p>
            <ul className="kth-account__list">
              {info.bnWarnings.map((w) => <li key={w.path}>{w.path} ({w.reason})</li>)}
            </ul>
          </div>
        ) : null}
        <PrivacyPanel
          labels={labels.privacy}
          serverSees={SERVER_SEES_KEYS.map((k) => t(k))}
          onExportPlain={openBackupDialog}
          onExportEncrypted={openBackupDialog}
          onExportServerData={() => store.exportServerData()}
          onDeleteAccount={(pw) => store.deleteAccount(pw)}
        />
      </>
    );
  } else if (!settings.serverUrl || editingServer) {
    body = serverForm;
  } else if (!settings.networkAllowed) {
    body = (
      <div className="kth-account__notice" data-testid="accounts-network-blocked">
        <p>{t('accounts.networkBlocked')}</p>
        <button type="button" className="kth-btn" onClick={() => openPreferencesSection('privacy')}>{t('accounts.openPrivacy')}</button>
      </div>
    );
  } else if (status.state === 'locked') {
    body = (
      <>
        <p className="kth-account__row">
          <span className="kth-account__muted">{t('accounts.lockedAs')}</span>{' '}
          <strong className="kth-account__email">{email}</strong>
        </p>
        <SingleFieldForm
          title={t('accounts.unlock.title')} label={t('accounts.unlock.password')} type="password" autoComplete="current-password"
          submitLabel={t('accounts.unlock.submit')} busy={busy} error={errorFor('unlock')}
          onSubmit={(pw) => store.unlock(pw)}
          secondary={{ label: t('accounts.unlock.signOut'), onClick: () => { void store.signOut(false); } }}
        />
      </>
    );
  } else {
    const signupOpen = server?.signupOpen ?? true;
    body = (
      <>
        <p className="kth-account__row kth-account__muted">
          <span>{t('accounts.server.current', { url: settings.serverUrl })}</span>{' '}
          <button type="button" className="kth-account__link" onClick={() => { setEditingServer(true); store.clearError(); }}>{t('accounts.server.change')}</button>
        </p>
        {!server ? (
          <div className="kth-account__notice" role="status" data-testid="accounts-server-unreachable">
            <p>{t('accounts.serverUnreachable')}</p>
            <button type="button" className="kth-btn kth-btn--sm" onClick={() => { void store.refresh(); }}>{t('accounts.retry')}</button>
          </div>
        ) : null}
        {mode === 'signIn' ? (
          <SignInForm
            labels={labels.signIn} showRemember={!settings.secretStoreWeak} busy={busy} error={errorFor('signIn')}
            onSubmit={(v) => store.signIn(v)} onForgot={() => { setMode('recover'); store.clearError(); }}
          />
        ) : null}
        {mode === 'signUp' && server ? (
          <SignUpForm
            labels={labels.signUp} checkStrength={checkStrength} busy={busy} error={errorFor('signUp')}
            minAge={server.minAge} termsUrl={server.termsUrl} privacyUrl={server.privacyUrl}
            onSubmit={(v) => store.signUp({ email: v.email, password: v.password, consent: { terms: true, ageConfirmed: true } })}
          />
        ) : null}
        {mode === 'recover' ? (
          <RecoverForm
            labels={labels.recover} checkStrength={checkStrength} busy={busy} error={errorFor('recover')}
            onRecover={(v) => store.recover(v)} onStartOver={(e) => store.requestStartOver(e)}
          />
        ) : null}
        <div className="kth-account__links">
          {mode !== 'signIn' ? <button type="button" className="kth-account__link" onClick={() => { setMode('signIn'); store.clearError(); }}>{t('accounts.haveAccount')}</button> : null}
          {mode !== 'signUp' && signupOpen && server ? <button type="button" className="kth-account__link" onClick={() => { setMode('signUp'); store.clearError(); }}>{t('accounts.createAccount')}</button> : null}
          {server && !signupOpen ? <span className="kth-account__muted">{t('accounts.signupClosed')}</span> : null}
        </div>
      </>
    );
  }

  return (
    <div className="kth-account__stack" data-testid="accounts-section">
      {header}
      {weakNotice}
      {body}
    </div>
  );
}

/** Holds the section back until the `accounts` catalog has loaded, so it never paints key placeholders. */
export function AccountSection() {
  const ready = useModuleNamespace('accounts');
  const refresh = useAccountsStore((s) => s.refresh);
  useEffect(() => { void refresh(); }, [refresh]);
  return ready ? <AccountSectionBody /> : null;
}
