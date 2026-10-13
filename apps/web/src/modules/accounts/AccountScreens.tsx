/**
 * The account screens (lazy chunk): a thin host for the shared `@bible/ui` Account components. It decides what each
 * dialog id shows, wires callbacks to the `AccountStore` and localizes every string (`accounts.*`, labels from
 * `labels.ts`). Used by the dialog (`AccountDialog.tsx`) and by Settings > Account (`AccountSettingsView.tsx`).
 */
import { useCallback, useMemo, useState } from 'preact/hooks';
import { useSyncExternalStore } from 'preact/compat';
import type { ComponentType } from 'preact';
import { useTranslation } from 'react-i18next';
import { Sync } from '@bible/core/browser';
import {
  AccountPanel, ChangePasswordForm, PrivacyPanel, RecoverForm, RecoveryCodeStep, SignInForm, SignUpForm, SyncStatusBadge,
} from '@bible/ui';
import type {
  AccountPanelProps, ChangePasswordFormProps, PrivacyPanelProps, RecoverFormProps, RecoveryCodeStepProps, SignInFormProps,
  SignUpFormProps, SyncStatusBadgeProps,
} from '@bible/ui';
import { accountStore } from './instance';
import type { AccountStore, AccountDialogId, ErrorScope } from './accountStore';
import { isSignedIn } from './accountStore';
import { failureKey, failureToken } from './errors';
import { accountLabels } from './labels';

// Shared components are typed against React; Preact (aliased as react) renders them fine.
const SignUp = SignUpForm as unknown as ComponentType<SignUpFormProps>;
const RecoveryStep = RecoveryCodeStep as unknown as ComponentType<RecoveryCodeStepProps>;
const SignIn = SignInForm as unknown as ComponentType<SignInFormProps>;
const Recover = RecoverForm as unknown as ComponentType<RecoverFormProps>;
const Panel = AccountPanel as unknown as ComponentType<AccountPanelProps>;
const ChangePassword = ChangePasswordForm as unknown as ComponentType<ChangePasswordFormProps>;
const Privacy = PrivacyPanel as unknown as ComponentType<PrivacyPanelProps>;
export const StatusBadge = SyncStatusBadge as unknown as ComponentType<SyncStatusBadgeProps>;

/** zxcvbn-ts feedback keys that have an `accounts.feedback.<key>` string; others are dropped. */
export const FEEDBACK_KEYS = new Set([
  'straightRow', 'keyPattern', 'simpleRepeat', 'extendedRepeat', 'sequences', 'recentYears', 'dates', 'topTen',
  'topHundred', 'common', 'similarToCommon', 'wordByItself', 'namesByThemselves', 'commonNames', 'userInputs', 'pwned',
  'l33t', 'reverseWords', 'allUppercase', 'capitalization', 'dictionary', 'extraWords', 'anotherWord', 'useWords',
  'useLonger', 'noNeed', 'repeated', 'associatedYears',
]);

const SERVER_SEES_KEYS = ['accounts.serverSees.1', 'accounts.serverSees.2', 'accounts.serverSees.3'];

export function useAccountState(store: AccountStore = accountStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** A one-field form (unlock password, current password, backup password). */
function SingleFieldForm(props: {
  title?: string; label: string; submitLabel: string; busy: boolean; error?: string; hint?: string;
  onSubmit(value: string): void | Promise<unknown>; secondary?: { label: string; onClick(): void };
}) {
  const [value, setValue] = useState('');
  const id = `account-field-${props.label.replace(/\W+/g, '-')}`;
  const submit = (e: Event): void => {
    e.preventDefault();
    if (value === '' || props.busy) return;
    void props.onSubmit(value);
  };
  return (
    <form class="kth-account" onSubmit={submit} noValidate>
      {props.title ? <h2 class="kth-account__title">{props.title}</h2> : null}
      <div class="kth-field">
        <label for={id}>{props.label}</label>
        <input
          id={id} class="kth-input" type="password" value={value} autoComplete="current-password" spellcheck={false}
          disabled={props.busy} onInput={(e) => setValue((e.target as HTMLInputElement).value)}
        />
        {props.hint ? <p class="kth-field__hint">{props.hint}</p> : null}
      </div>
      {props.error ? <p class="kth-account__error" role="alert">{props.error}</p> : null}
      <div class="kth-account__actions">
        <button type="submit" class="kth-btn kth-btn--primary" disabled={props.busy || value === ''}>{props.submitLabel}</button>
        {props.secondary ? (
          <button type="button" class="kth-account__link" onClick={props.secondary.onClick} disabled={props.busy}>{props.secondary.label}</button>
        ) : null}
      </div>
    </form>
  );
}

/** The reset e-mail's landing form: a new password (no current one, no e-mail). */
function ResetPasswordForm(props: {
  checkStrength: SignUpFormProps['checkStrength']; busy: boolean; error?: string;
  t(key: string): string; onSubmit(password: string): Promise<unknown>;
}) {
  const { t } = props;
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [score, setScore] = useState<number | null>(null);
  const [hints, setHints] = useState<string[]>([]);
  const differ = again !== '' && again !== pw;
  const onPw = (v: string) => {
    setPw(v);
    if (v === '') { setScore(null); setHints([]); return; }
    void props.checkStrength(v).then((r) => { setScore(r.score); setHints(r.feedback); }, () => undefined);
  };
  const ok = pw !== '' && pw === again && score !== null && score >= 3 && !props.busy;
  return (
    <form class="kth-account" noValidate onSubmit={(e) => { e.preventDefault(); if (ok) void props.onSubmit(pw); }}>
      <h2 class="kth-account__title">{t('accounts.resetPassword.title')}</h2>
      <p class="kth-account__muted">{t('accounts.resetPassword.intro')}</p>
      <div class="kth-field">
        <label for="account-reset-pw">{t('accounts.recover.newPassword')}</label>
        <input id="account-reset-pw" class="kth-input" type="password" value={pw} autoComplete="new-password" disabled={props.busy}
          onInput={(e) => onPw((e.target as HTMLInputElement).value)} />
        {score !== null ? <p class="kth-field__hint" role="status">{t('accounts.signUp.strength')}: {t(`accounts.signUp.strengthScore${score}`)}{hints.length ? ` ${hints.join(' ')}` : ''}</p> : null}
      </div>
      <div class="kth-field">
        <label for="account-reset-pw2">{t('accounts.recover.confirmPassword')}</label>
        <input id="account-reset-pw2" class="kth-input" type="password" value={again} autoComplete="new-password" disabled={props.busy}
          onInput={(e) => setAgain((e.target as HTMLInputElement).value)} />
        {differ ? <p class="kth-account__error" role="alert">{t('accounts.recover.passwordsDiffer')}</p> : null}
      </div>
      <p class="kth-account__notice">{t('accounts.resetPassword.warning')}</p>
      {props.error ? <p class="kth-account__error" role="alert">{props.error}</p> : null}
      <div class="kth-account__actions">
        <button type="submit" class="kth-btn kth-btn--primary" disabled={!ok}>{t('accounts.resetPassword.submit')}</button>
      </div>
    </form>
  );
}

/** Signed-in view: unverified banner, the account panel and the links to the other screens. */
export function SignedInView({ store = accountStore }: { store?: AccountStore }) {
  const { t } = useTranslation();
  const s = useAccountState(store);
  const labels = useMemo(() => accountLabels(t), [t]);
  const unverified = s.account && !s.account.emailVerified;
  const err = s.error?.scope === 'account' ? t(failureKey(s.error.token)) : s.status.error ? t(failureKey(failureToken(s.status.error.code))) : undefined;
  return (
    <div class="kth-account__stack" data-testid="accounts-signed-in">
      {unverified ? (
        <div class="kth-account__notice" role="status" data-testid="accounts-unverified">
          <p>{t('accounts.unverified')}</p>
          <button type="button" class="kth-btn kth-btn--sm" disabled={s.busy || s.notice?.id === 'resent'} onClick={() => { void store.resendVerification(); }}>
            {s.notice?.id === 'resent' ? t('accounts.resent') : t('accounts.resend')}
          </button>
        </div>
      ) : null}
      <Panel
        email={s.status.accountEmail ?? ''}
        status={s.status}
        usage={{ bytesUsed: s.account?.bytesUsed ?? 0, quotaBytes: s.account?.quotaBytes ?? s.info?.quotaBytes ?? 0 }}
        devices={s.devices}
        labels={labels.accountPanel}
        onSyncNow={() => { void store.syncNow(); }}
        onRevoke={async (id) => { await store.revokeDevice(id); }}
        onChangePassword={() => store.openDialog('changePassword')}
        onNewRecoveryCode={() => store.openDialog('newRecoveryCode')}
        onSignOut={async (wipe) => { await store.signOut(wipe); }}
      />
      {err ? <p class="kth-account__error" role="alert">{err}</p> : null}
      <p class="kth-account__links">
        <button type="button" class="kth-account__link" onClick={() => store.openDialog('privacy')}>{t('accounts.privacy.title')}</button>
      </p>
    </div>
  );
}

/** Signed-out view for Settings: the two entry points. */
export function SignedOutView({ store = accountStore }: { store?: AccountStore }) {
  const { t } = useTranslation();
  const s = useAccountState(store);
  const locked = s.status.state === 'locked';
  return (
    <div class="kth-account__stack" data-testid="accounts-signed-out">
      <p class="kth-account__muted">{t(locked ? 'accounts.lockedAs' : 'accounts.intro')} {locked ? <strong>{s.status.accountEmail}</strong> : null}</p>
      <div class="kth-account__actions">
        {locked ? (
          <button type="button" class="kth-btn kth-btn--primary" onClick={() => store.openDialog('unlock')}>{t('accounts.unlock.submit')}</button>
        ) : (
          <>
            <button type="button" class="kth-btn kth-btn--primary" onClick={() => store.openDialog('signIn')}>{t('accounts.signIn.title')}</button>
            <button type="button" class="kth-btn" onClick={() => store.openDialog('signUp')}>{t('accounts.createAccount')}</button>
          </>
        )}
      </div>
    </div>
  );
}

/** One dialog screen. */
export function AccountScreen({ dialog, store = accountStore }: { dialog: AccountDialogId; store?: AccountStore }) {
  const { t } = useTranslation();
  const s = useAccountState(store);
  const labels = useMemo(() => accountLabels(t), [t]);
  const errorFor = (...scopes: ErrorScope[]): string | undefined =>
    s.error && scopes.includes(s.error.scope) ? t(failureKey(s.error.token)) : undefined;

  const email = s.status.accountEmail ?? store.knownEmail;
  const userInputs = useMemo(() => Sync.emailUserInputs(email), [email]);
  const checkStrength = useCallback(
    async (pw: string) => {
      const r = await Sync.passwordStrength(pw, userInputs);
      return { score: r.score, feedback: r.feedback.filter((k) => FEEDBACK_KEYS.has(k)).map((k) => t(`accounts.feedback.${k}`)) };
    },
    [t, userInputs],
  );
  const link = (to: AccountDialogId, key: string) => (
    <button type="button" class="kth-account__link" onClick={() => store.openDialog(to)}>{t(key)}</button>
  );

  switch (dialog) {
    case 'signUp': {
      if (!s.info) return <p>{t('accounts.loading')}</p>;
      if (!s.info.signupOpen) {
        return <div class="kth-account__stack"><p class="kth-account__notice">{t('accounts.signupClosed')}</p>{link('signIn', 'accounts.haveAccount')}</div>;
      }
      return (
        <div class="kth-account__stack">
          <SignUp
            labels={labels.signUp} checkStrength={checkStrength} busy={s.busy} error={errorFor('signUp')}
            minAge={s.info.minAge} termsUrl={s.info.termsUrl} privacyUrl={s.info.privacyUrl}
            onSubmit={async (v) => { await store.signUp({ email: v.email, password: v.password }); }}
          />
          <p class="kth-account__links">{link('signIn', 'accounts.haveAccount')}</p>
        </div>
      );
    }
    case 'recovery':
      return s.recoveryCode ? (
        <div class="kth-account__stack">
          <RecoveryStep
            code={s.recoveryCode} labels={labels.recoveryCode}
            onDownload={() => store.saveRecoveryCode()} onConfirmed={() => store.confirmRecoveryCode()}
          />
        </div>
      ) : null;
    case 'signIn':
      return (
        <div class="kth-account__stack">
          <SignIn
            labels={labels.signIn} showRemember busy={s.busy} error={errorFor('signIn')}
            onSubmit={async (v) => { await store.signIn(v); }} onForgot={() => store.openDialog('recover')}
          />
          <p class="kth-account__links">{s.info && !s.info.signupOpen ? <span class="kth-account__muted">{t('accounts.signupClosed')}</span> : link('signUp', 'accounts.createAccount')}</p>
        </div>
      );
    case 'recover':
    case 'startOver':
      return (
        <div class="kth-account__stack">
          <Recover
            labels={labels.recover} checkStrength={checkStrength} busy={s.busy} error={errorFor('recover')}
            onRecover={async (v) => { await store.recover(v); }}
            onStartOver={async (e) => { await store.requestStartOver(e); }}
          />
          <p class="kth-account__links">{link('signIn', 'accounts.haveAccount')}</p>
        </div>
      );
    case 'resetPassword':
      return (
        <ResetPasswordForm
          t={t} checkStrength={checkStrength} busy={s.busy} error={errorFor('resetPassword')}
          onSubmit={(pw) => store.resetPassword(pw)}
        />
      );
    case 'unlock':
      return (
        <div class="kth-account__stack">
          <p class="kth-account__row">
            <span class="kth-account__muted">{t('accounts.lockedAs')}</span> <strong class="kth-account__email">{s.status.accountEmail}</strong>
          </p>
          <SingleFieldForm
            title={t('accounts.unlock.title')} label={t('accounts.unlock.password')} submitLabel={t('accounts.unlock.submit')}
            busy={s.busy} error={errorFor('unlock')} onSubmit={(pw) => store.unlock(pw)}
            secondary={{ label: t('accounts.unlock.signOut'), onClick: () => { void store.signOut(false); } }}
          />
        </div>
      );
    case 'account':
      return isSignedIn(s.status) ? <SignedInView store={store} /> : <SignedOutView store={store} />;
    case 'changePassword':
      return (
        <ChangePassword
          labels={labels.changePassword} checkStrength={checkStrength} busy={s.busy} error={errorFor('changePassword')}
          onCancel={() => store.openDialog('account')} onSubmit={async (v) => { await store.changePassword(v); }}
        />
      );
    case 'newRecoveryCode':
      return (
        <SingleFieldForm
          title={t('accounts.accountPanel.newRecoveryCode')} label={t('accounts.newCode.password')}
          submitLabel={t('accounts.newCode.submit')} busy={s.busy} error={errorFor('changePassword')}
          onSubmit={(pw) => store.newRecoveryCode(pw)} secondary={{ label: t('accounts.cancel'), onClick: () => store.openDialog('account') }}
        />
      );
    case 'exportPassword':
      return (
        <SingleFieldForm
          title={t('accounts.privacy.exportEncrypted')} label={t('accounts.exportPassword.label')} hint={t('accounts.exportPassword.hint')}
          submitLabel={t('accounts.exportPassword.submit')} busy={s.busy} error={errorFor('privacy')}
          onSubmit={(pw) => store.exportEncrypted(pw)} secondary={{ label: t('accounts.cancel'), onClick: () => store.openDialog('privacy') }}
        />
      );
    case 'privacy':
      return (
        <div class="kth-account__stack">
          <p class="kth-account__notice" data-testid="accounts-export-partial">{t('accounts.privacy.exportPartial')}</p>
          <Privacy
            labels={labels.privacy}
            serverSees={SERVER_SEES_KEYS.map((k) => t(k))}
            onExportPlain={async () => { await store.exportPlain(); }}
            onExportEncrypted={async () => { store.openDialog('exportPassword'); }}
            onExportServerData={async () => { await store.exportServerData(); }}
            onDeleteAccount={async (pw) => { await store.deleteAccount(pw); }}
          />
          {errorFor('privacy') ? <p class="kth-account__error" role="alert">{errorFor('privacy')}</p> : null}
          <p class="kth-account__links">{link('account', 'accounts.back')}</p>
        </div>
      );
  }
}
