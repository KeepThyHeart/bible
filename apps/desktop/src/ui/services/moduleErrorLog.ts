import { IpcResultError } from './ipcResult';

/** Only `module_missing` means "this module cannot be opened"; the UI shows a state, not a stack. Other `not_found`s are real errors. */
export function isModuleUnavailableError(err: unknown): err is IpcResultError {
  return err instanceof IpcResultError && err.code === 'module_missing';
}

const seen = new Set<string>();
const MAX_KEYS = 500;

/** Forget logged keys (tests, or a user-pressed Retry / module install). */
export function resetModuleErrorLog(kind?: string, abbr?: string): void {
  if (kind === undefined) {
    seen.clear();
    return;
  }
  const prefix = abbr === undefined ? `${kind}:` : `${kind}:${abbr}:`;
  for (const k of [...seen]) if (k.startsWith(prefix)) seen.delete(k);
}

/**
 * Log a module-unavailable failure once per module per session (one
 * `console.warn`). Returns true when `err` was such a failure (logged now or
 * suppressed); false means the caller should log it itself with `console.error`.
 */
export function logModuleErrorOnce(kind: string, abbr: string, where: string, err: unknown): boolean {
  if (!isModuleUnavailableError(err)) return false;
  const key = `${kind}:${abbr}:${err.code}`;
  if (seen.has(key)) return true;
  if (seen.size >= MAX_KEYS) seen.clear();
  seen.add(key);
  console.warn(`[${kind}] ${where}: ${err.message}`);
  return true;
}
