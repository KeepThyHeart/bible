/**
 * Maps the shared Account components' label sets onto the `accounts` i18n namespace: every field of a
 * `DEFAULT_*_LABELS` object is the key `accounts.<component>.<field>` (`strengthScores` becomes
 * `accounts.signUp.strengthScore0..4`). The components fill `{age}`, `{n}` and `{time}` themselves, so those
 * placeholders are handed back verbatim.
 */
import {
  DEFAULT_ACCOUNT_PANEL_LABELS, DEFAULT_CHANGE_PASSWORD_LABELS, DEFAULT_PRIVACY_LABELS, DEFAULT_RECOVER_LABELS,
  DEFAULT_RECOVERY_CODE_LABELS, DEFAULT_SIGN_IN_LABELS, DEFAULT_SIGN_UP_LABELS, DEFAULT_SYNC_STATUS_LABELS,
  type AccountPanelLabels, type ChangePasswordLabels, type PrivacyPanelLabels, type RecoverFormLabels,
  type RecoveryCodeLabels, type SignInFormLabels, type SignUpFormLabels, type SyncStatusLabels,
} from '@bible/ui';

export type Translate = (key: string, params?: Record<string, unknown>) => string;

const KEEP = { age: '{age}', n: '{n}', time: '{time}' };

function map<L extends object>(defaults: L, prefix: string, t: Translate): L {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(defaults)) {
    if (key === 'strengthScores') {
      out[key] = [0, 1, 2, 3, 4].map((i) => t(`accounts.${prefix}.strengthScore${i}`));
    } else {
      out[key] = t(`accounts.${prefix}.${key}`, KEEP);
    }
  }
  return out as L;
}

export interface AccountLabelSets {
  signUp: SignUpFormLabels;
  recoveryCode: RecoveryCodeLabels;
  signIn: SignInFormLabels;
  recover: RecoverFormLabels;
  accountPanel: AccountPanelLabels;
  changePassword: ChangePasswordLabels;
  privacy: PrivacyPanelLabels;
  syncStatus: SyncStatusLabels;
}

export function accountLabels(t: Translate): AccountLabelSets {
  return {
    signUp: map(DEFAULT_SIGN_UP_LABELS, 'signUp', t),
    recoveryCode: map(DEFAULT_RECOVERY_CODE_LABELS, 'recoveryCode', t),
    signIn: map(DEFAULT_SIGN_IN_LABELS, 'signIn', t),
    recover: map(DEFAULT_RECOVER_LABELS, 'recover', t),
    accountPanel: map(DEFAULT_ACCOUNT_PANEL_LABELS, 'accountPanel', t),
    changePassword: map(DEFAULT_CHANGE_PASSWORD_LABELS, 'changePassword', t),
    privacy: map(DEFAULT_PRIVACY_LABELS, 'privacy', t),
    syncStatus: map(DEFAULT_SYNC_STATUS_LABELS, 'syncStatus', t),
  };
}

/** The i18n key prefixes and fields, for the catalog (used by the tests to check every key exists in `en`). */
export function accountLabelKeys(): string[] {
  const sets: Array<[string, object]> = [
    ['signUp', DEFAULT_SIGN_UP_LABELS], ['recoveryCode', DEFAULT_RECOVERY_CODE_LABELS], ['signIn', DEFAULT_SIGN_IN_LABELS],
    ['recover', DEFAULT_RECOVER_LABELS], ['accountPanel', DEFAULT_ACCOUNT_PANEL_LABELS],
    ['changePassword', DEFAULT_CHANGE_PASSWORD_LABELS], ['privacy', DEFAULT_PRIVACY_LABELS], ['syncStatus', DEFAULT_SYNC_STATUS_LABELS],
  ];
  return sets.flatMap(([prefix, defaults]) =>
    Object.keys(defaults).flatMap((k) =>
      k === 'strengthScores' ? [0, 1, 2, 3, 4].map((i) => `accounts.${prefix}.strengthScore${i}`) : [`accounts.${prefix}.${k}`]));
}
