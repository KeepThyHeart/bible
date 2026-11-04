/**
 * Accounts failures in the renderer. The main process throws `IpcKnownError` whose message is an `AccountsFailure`
 * token (never server text, keys or passwords); this maps a rejection to that token, and the UI shows the
 * localised `accounts.error.<token>`. Anything unrecognised is `internal` (raw messages are never shown).
 */
export const ACCOUNTS_FAILURES = [
  'bad_request', 'unauthorized', 'forbidden', 'not_found', 'conflict_email', 'email_unverified', 'quota_exceeded',
  'too_large', 'rate_limited', 'signup_closed', 'server_error', 'weak_password', 'crypto', 'network', 'network_blocked',
  'internal',
] as const;
export type AccountsFailureToken = (typeof ACCOUNTS_FAILURES)[number];

export function failureToken(err: unknown): AccountsFailureToken {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === 'network_blocked') return 'network_blocked';
  const message = err instanceof Error ? err.message : '';
  return (ACCOUNTS_FAILURES as readonly string[]).includes(message) ? (message as AccountsFailureToken) : 'internal';
}

/** i18n key of a failure's text. */
export function failureKey(token: AccountsFailureToken): string {
  return `accounts.error.${token}`;
}
