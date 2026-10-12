/** English defaults for every Account component (labels are props; the apps supply translations). */
import type {
  AccountPanelLabels, ChangePasswordLabels, PrivacyPanelLabels, RecoverFormLabels, RecoveryCodeLabels,
  SignInFormLabels, SignUpFormLabels, SyncStatusLabels,
} from './types';

export const DEFAULT_SIGN_UP_LABELS: SignUpFormLabels = {
  title: 'Create an account',
  email: 'Email address',
  password: 'Password',
  confirmPassword: 'Confirm password',
  passwordsDiffer: 'The passwords do not match.',
  strength: 'Password strength',
  strengthScores: ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'],
  tooWeak: 'Choose a stronger password.',
  consentTerms: 'I agree to the Terms of Service and the Privacy Policy.',
  termsLink: 'Terms of Service',
  privacyLink: 'Privacy Policy',
  ageConfirm: 'I am at least {age} years old.',
  noRecoveryWarning:
    'Your notes and highlights are encrypted with your password. If you forget it, only your recovery code can unlock them; we cannot reset it for you.',
  submit: 'Create account',
  busy: 'Creating account...',
};

export const DEFAULT_RECOVERY_CODE_LABELS: RecoveryCodeLabels = {
  title: 'Save your recovery code',
  intro: 'This code is the only way to get your data back if you forget your password.',
  warning: 'Store it somewhere safe and private. Anyone who has it can recover your account.',
  download: 'Download',
  copy: 'Copy',
  copied: 'Copied',
  confirmPrompt: 'Character {n}',
  confirmCharacter: 'To confirm you saved it, type these characters from your code.',
  mismatch: 'Those characters do not match your code. Check it and try again.',
  confirm: 'I have saved my code',
};

export const DEFAULT_SIGN_IN_LABELS: SignInFormLabels = {
  title: 'Sign in',
  email: 'Email address',
  password: 'Password',
  remember: 'Keep me signed in on this device',
  rememberHint: 'Only use this on a device you trust.',
  forgot: 'Forgot your password?',
  submit: 'Sign in',
  busy: 'Signing in...',
};

export const DEFAULT_RECOVER_LABELS: RecoverFormLabels = {
  title: 'Recover your account',
  intro: 'Enter your email address, your recovery code and a new password.',
  email: 'Email address',
  code: 'Recovery code',
  newPassword: 'New password',
  confirmPassword: 'Confirm new password',
  passwordsDiffer: 'The passwords do not match.',
  strength: 'Password strength',
  tooWeak: 'Choose a stronger password.',
  submit: 'Recover account',
  busy: 'Recovering...',
  noCodeTitle: "I don't have my recovery code",
  startOverIntro: 'Without the code, your synced data cannot be decrypted. You can start over with an empty account.',
  startOverWarning: 'Starting over permanently deletes the data stored on the server for this account.',
  startOver: 'Email me a link to start over',
  startOverSent: 'If an account exists for that address, an email is on its way.',
};

export const DEFAULT_ACCOUNT_PANEL_LABELS: AccountPanelLabels = {
  title: 'Account',
  signedInAs: 'Signed in as',
  usage: 'Storage used',
  syncNow: 'Sync now',
  lastSynced: 'Last synced',
  never: 'Never',
  pending: '{n} changes waiting to sync',
  opaque: '{n} items from a newer version are stored safely but not shown here.',
  devices: 'Devices',
  thisDevice: 'This device',
  lastSeen: 'Last seen',
  revoke: 'Sign out this device',
  changePassword: 'Change password',
  newRecoveryCode: 'Create a new recovery code',
  signOut: 'Sign out',
  signOutKeep: 'Sign out and keep my data on this device',
  signOutWipe: 'Sign out and remove my data from this device',
  signOutWipeWarning:
    'Anything that has not synced yet will be lost. Your synced data stays in your account.',
  cancel: 'Cancel',
};

export const DEFAULT_CHANGE_PASSWORD_LABELS: ChangePasswordLabels = {
  title: 'Change password',
  current: 'Current password',
  next: 'New password',
  confirm: 'Confirm new password',
  passwordsDiffer: 'The passwords do not match.',
  strength: 'Password strength',
  tooWeak: 'Choose a stronger password.',
  signOutOthers: 'Sign out my other devices',
  submit: 'Change password',
  busy: 'Changing password...',
  cancel: 'Cancel',
};

export const DEFAULT_PRIVACY_LABELS: PrivacyPanelLabels = {
  title: 'Privacy and your data',
  serverSeesTitle: 'What our server can see',
  exportTitle: 'Export your data',
  exportPlain: 'Export readable data',
  exportEncrypted: 'Export encrypted backup',
  exportServerData: 'Export what the server holds',
  deleteTitle: 'Delete your account',
  deleteWarning: 'This permanently deletes your account and everything stored on the server. It cannot be undone.',
  deletePassword: 'Enter your password to confirm',
  deleteConfirm: 'Delete my account permanently',
  deleteAccount: 'Delete account...',
  busy: 'Working...',
};

export const DEFAULT_SYNC_STATUS_LABELS: SyncStatusLabels = {
  signedOut: 'Not signed in',
  locked: 'Locked',
  idle: 'Synced',
  syncing: 'Syncing...',
  offline: 'Offline',
  error: 'Sync problem',
  pending: '{n} waiting',
  lastSynced: 'Last synced {time}',
};
