/**
 * Turns the site config's `accounts` block into sync-server options. Pure (no I/O) so it is easy to test.
 * Nothing here logs: the SMTP password and the server secret pass through untouched.
 */

import type { AccountsSettings } from '../../SiteConfig.js';
import type { EmailSender, SyncServerOptions } from './syncServerBridge.js';

/** Thrown for operator mistakes in the `accounts` block; the message names the setting, never a value that may be secret. */
export class AccountsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountsConfigError';
  }
}

const LOCAL_HOSTS = /^(localhost|127(\.\d{1,3}){3}|\[::1\]|[^.]+\.localhost)$/i;

/** The parsed `publicUrl` (http or https only, no path needed), or an AccountsConfigError. */
export function parsePublicUrl(raw: string): URL {
  if (!raw) throw new AccountsConfigError('accounts.publicUrl is not set');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AccountsConfigError('accounts.publicUrl is not a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AccountsConfigError('accounts.publicUrl must be an http(s) URL');
  }
  return url;
}

/** Cookies are `Secure` unless the site is plain http on a loopback host (local development). */
export function cookieSecureFor(publicUrl: URL): boolean {
  return !(publicUrl.protocol === 'http:' && LOCAL_HOSTS.test(publicUrl.hostname));
}

/**
 * Origins allowed to make cookie-authenticated writes: the origin of `publicUrl` plus the explicit
 * `accounts.allowedOrigins`. The request's own Host is never trusted (default strict).
 */
export function allowedOriginsFor(settings: Pick<AccountsSettings, 'allowedOrigins'>, publicUrl: URL): string[] {
  const out = new Set<string>([publicUrl.origin]);
  for (const o of settings.allowedOrigins) {
    try {
      out.add(new URL(o).origin);
    } catch {
      throw new AccountsConfigError('accounts.allowedOrigins holds an invalid URL');
    }
  }
  return [...out];
}

/** Console mail is allowed only for a loopback http `publicUrl` (development). */
export function consoleMailAllowed(publicUrl: URL): boolean {
  return !cookieSecureFor(publicUrl);
}

export interface EmailFactories {
  console: () => EmailSender;
  smtp: (o: { host: string; port: number; secure?: boolean; user?: string; pass?: string; from: string }) => EmailSender;
}

/**
 * `allowConsole`: the console sender writes sign-in and reset links to the server log, so it is for
 * a loopback http `publicUrl` only (see `consoleMailAllowed`).
 */
export function buildEmailSender(email: AccountsSettings['email'], f: EmailFactories, allowConsole = false): EmailSender {
  if (email.kind !== 'smtp') {
    if (!allowConsole) {
      throw new AccountsConfigError('accounts.email.kind "console" writes reset links to the server log and is only allowed for a local http publicUrl; configure kind "smtp"');
    }
    return f.console();
  }
  if (!email.host) throw new AccountsConfigError('accounts.email.host is required for kind "smtp"');
  if (!email.from) throw new AccountsConfigError('accounts.email.from is required for kind "smtp"');
  const port = email.port ?? (email.secure ? 465 : 587);
  return f.smtp({
    host: email.host,
    port,
    secure: email.secure,
    ...(email.user !== undefined ? { user: email.user, pass: email.pass ?? '' } : {}),
    from: email.from,
  });
}

export function buildSyncOptions(
  settings: AccountsSettings,
  parts: Pick<SyncServerOptions, 'sql' | 'serverSecret' | 'email'> & Partial<Pick<SyncServerOptions, 'log'>>,
): { options: SyncServerOptions; publicUrl: URL } {
  const publicUrl = parsePublicUrl(settings.publicUrl);
  return {
    publicUrl,
    options: {
      ...parts,
      publicUrl: publicUrl.origin + publicUrl.pathname.replace(/\/+$/, ''),
      signupOpen: settings.signupOpen,
      ...(settings.quotaBytes !== undefined ? { quotaBytes: settings.quotaBytes } : {}),
      ...(settings.minAge !== undefined ? { minAge: settings.minAge } : {}),
      ...(settings.termsUrl ? { termsUrl: settings.termsUrl } : {}),
      ...(settings.privacyUrl ? { privacyUrl: settings.privacyUrl } : {}),
      allowedOrigins: allowedOriginsFor(settings, publicUrl),
      cookieSecure: cookieSecureFor(publicUrl),
    },
  };
}
