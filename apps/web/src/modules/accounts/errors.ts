/**
 * Accounts failures on the web. The worker rejects with `UserDbError.code` (never the input, a key or a password);
 * this maps a rejection (or a status error code) to a token and the UI shows the localized `accounts.error.<token>`.
 * Anything unrecognised is `internal`: raw messages are never shown.
 */
export const ACCOUNTS_FAILURES = [
  'invalid_credentials', 'invalid_recovery_code', 'damaged_keys', 'crypto', 'not_signed_in', 'weak_password',
  'bad_request', 'unauthorized', 'forbidden', 'not_found', 'conflict_email', 'email_unverified', 'quota_exceeded',
  'too_large', 'rate_limited', 'signup_closed', 'server_error', 'network', 'unavailable', 'leader_changed', 'internal',
] as const;
export type AccountsFailureToken = (typeof ACCOUNTS_FAILURES)[number];

const ALIASES: Record<string, AccountsFailureToken> = {
  unsafe_kdf: 'damaged_keys',
  not_configured: 'unavailable',
  unsupported: 'unavailable',
  open_timeout: 'unavailable',
  unknown_method: 'internal',
};

/** Map a thrown error, or a bare code string, to a failure token. */
export function failureToken(err: unknown): AccountsFailureToken {
  const code = typeof err === 'string' ? err : (err as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') return 'internal';
  if ((ACCOUNTS_FAILURES as readonly string[]).includes(code)) return code as AccountsFailureToken;
  return ALIASES[code] ?? 'internal';
}

export function failureKey(token: AccountsFailureToken): string {
  return `accounts.error.${token}`;
}
