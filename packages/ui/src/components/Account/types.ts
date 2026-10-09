/**
 * Account UI component contracts (contracts 0063 §14; W5-A builds the components, W5-B/C code against these props).
 * Labels are props with English defaults (package rule); no i18n library, no fetch; kth-* classes only.
 * Each *Labels interface lists every visible string; W5-A exports DEFAULT_*_LABELS.
 */
import type { Sync } from '@bible/core/browser';

type SyncStatus = Sync.SyncStatus;

export interface PasswordStrength { score: 0 | 1 | 2 | 3 | 4; feedback: string[] }

export interface SignUpFormLabels {
  title: string; email: string; password: string; confirmPassword: string; passwordsDiffer: string;
  strength: string; strengthScores: [string, string, string, string, string]; tooWeak: string;
  consentTerms: string; termsLink: string; privacyLink: string;
  /** `{age}` is replaced with `minAge`. */
  ageConfirm: string;
  noRecoveryWarning: string; submit: string; busy: string;
}
export interface RecoveryCodeLabels {
  title: string; intro: string; warning: string; download: string; copy: string; copied: string;
  /** `{n}` is replaced with the 1-based character position asked for. */
  confirmPrompt: string; confirmCharacter: string; mismatch: string; confirm: string;
}
export interface SignInFormLabels {
  title: string; email: string; password: string; remember: string; rememberHint: string; forgot: string;
  submit: string; busy: string;
}
export interface RecoverFormLabels {
  title: string; intro: string; email: string; code: string; newPassword: string; confirmPassword: string;
  passwordsDiffer: string; strength: string; tooWeak: string; submit: string; busy: string;
  noCodeTitle: string; startOverIntro: string; startOverWarning: string; startOver: string; startOverSent: string;
}
export interface AccountPanelLabels {
  title: string; signedInAs: string; usage: string; syncNow: string; lastSynced: string; never: string;
  pending: string; opaque: string; devices: string; thisDevice: string; lastSeen: string; revoke: string;
  changePassword: string; newRecoveryCode: string; signOut: string; signOutKeep: string; signOutWipe: string;
  signOutWipeWarning: string; cancel: string;
}
export interface ChangePasswordLabels {
  title: string; current: string; next: string; confirm: string; passwordsDiffer: string; strength: string;
  tooWeak: string; signOutOthers: string; submit: string; busy: string; cancel: string;
}
export interface PrivacyPanelLabels {
  title: string; serverSeesTitle: string; exportTitle: string; exportPlain: string; exportEncrypted: string;
  exportServerData: string; deleteTitle: string; deleteWarning: string; deletePassword: string; deleteConfirm: string;
  deleteAccount: string; busy: string;
}
export interface SyncStatusLabels {
  signedOut: string; locked: string; idle: string; syncing: string; offline: string; error: string;
  /** `{n}` is replaced with the pending count. */
  pending: string;
  /** `{time}` is replaced with the formatted time. */
  lastSynced: string;
}

export interface SignUpFormProps { onSubmit(v: { email: string; password: string; consentTerms: boolean; ageConfirmed: boolean }): Promise<void>;
  checkStrength(pw: string): Promise<PasswordStrength>; minScore?: number; minAge: number; termsUrl?: string; privacyUrl?: string;
  busy?: boolean; error?: string; labels?: Partial<SignUpFormLabels> }
/** Shows the code, asks for 4 characters at random positions; onConfirmed only after they match. */
export interface RecoveryCodeStepProps { code: string; /* 8 groups */ onConfirmed(): void; onDownload?(): void; labels?: Partial<RecoveryCodeLabels> }
export interface SignInFormProps { onSubmit(v: { email: string; password: string; remember: boolean }): Promise<void>;
  onForgot(): void; showRemember: boolean; busy?: boolean; error?: string; labels?: Partial<SignInFormLabels> }
export interface RecoverFormProps { onRecover(v: { email: string; code: string; newPassword: string }): Promise<void>;
  onStartOver(email: string): Promise<void>; checkStrength: SignUpFormProps['checkStrength']; busy?: boolean; error?: string; labels?: Partial<RecoverFormLabels> }
export interface AccountPanelProps { email: string; status: SyncStatus; usage: { bytesUsed: number; quotaBytes: number };
  devices: Array<{ id: string; name: string; lastSeenAt: string; current: boolean }>;
  onSyncNow(): void; onRevoke(id: string): Promise<void>; onChangePassword(): void; onNewRecoveryCode(): void;
  onSignOut(wipeLocal: boolean): Promise<void>; labels?: Partial<AccountPanelLabels> }
export interface ChangePasswordFormProps { onSubmit(v: { current: string; next: string; signOutOthers: boolean }): Promise<void>;
  checkStrength: SignUpFormProps['checkStrength']; busy?: boolean; error?: string; labels?: Partial<ChangePasswordLabels> }
export interface PrivacyPanelProps { onExportPlain(): Promise<void>; onExportEncrypted(): Promise<void>; onExportServerData(): Promise<void>;
  onDeleteAccount(password: string): Promise<void>; serverSees: string[]; labels?: Partial<PrivacyPanelLabels> }
export interface SyncStatusBadgeProps { status: SyncStatus; onClick?(): void; labels?: Partial<SyncStatusLabels> }
