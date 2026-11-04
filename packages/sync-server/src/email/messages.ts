/**
 * The transactional mails and how they are dispatched. Links carry one-time tokens in the URL fragment (never
 * sent to a server in a request line, Referer or access log); only the link is in the mail, never a key.
 */
import type { EmailSender } from '../types';
import type { ServerContext } from '../http';

export type Mail = Parameters<EmailSender['send']>[0];

export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

function base(publicUrl: string): string {
  return publicUrl.replace(/\/+$/, '');
}

export function verifyLink(publicUrl: string, token: string): string {
  return `${base(publicUrl)}/account/verify-email#token=${token}`;
}

export function resetLink(publicUrl: string, token: string): string {
  return `${base(publicUrl)}/account/reset-password#token=${token}`;
}

function html(paragraphs: string[], link?: string): string {
  const body = paragraphs.map((p) => `<p>${p}</p>`).join('');
  return link ? `${body}<p><a href="${link}">${link}</a></p>` : body;
}

export function verifyMail(to: string, publicUrl: string, token: string): Mail {
  const link = verifyLink(publicUrl, token);
  const lead = 'Confirm your email address to finish setting up sync for your Bible account.';
  const tail = 'The link works once and expires in 24 hours. If you did not create an account, ignore this message.';
  return {
    to, subject: 'Confirm your email address',
    text: `${lead}\n\n${link}\n\n${tail}\n`,
    html: html([lead], link) + html([tail]),
  };
}

export function resetMail(to: string, publicUrl: string, token: string): Mail {
  const link = resetLink(publicUrl, token);
  const lead = 'Someone asked to reset the password of your Bible sync account.';
  const warn = 'Resetting erases the synced data stored on the server (it can not be decrypted without your password '
    + 'or recovery code); data on your devices stays and syncs again afterwards.';
  const tail = 'The link works once and expires in 1 hour. If this was not you, ignore this message.';
  return {
    to, subject: 'Reset your password',
    text: `${lead}\n\n${link}\n\n${warn}\n${tail}\n`,
    html: html([lead], link) + html([warn, tail]),
  };
}

export function duplicateSignupMail(to: string, publicUrl: string): Mail {
  const link = `${base(publicUrl)}/account`;
  const lead = 'Someone tried to sign up with your address, but an account with it already exists. '
    + 'Nothing was changed.';
  const tail = 'If it was you, sign in, or reset your password if you have forgotten it. If it was not, '
    + 'you can ignore this message.';
  return {
    to, subject: 'Sign-up attempt with your address',
    text: `${lead}\n\n${tail}\n\n${link}\n`,
    html: html([lead, tail], link),
  };
}

export type SecurityChange = 'password-reset' | 'password-changed' | 'recovery-regenerated' | 'keys-rotated';

const SECURITY_LEAD: Record<SecurityChange, [string, string]> = {
  'password-reset': ['Your password was reset', 'The password of your Bible sync account was just reset.'],
  'password-changed': ['Your password was changed', 'The password of your Bible sync account was just changed.'],
  'recovery-regenerated': ['Your recovery code was regenerated',
    'The recovery code of your Bible sync account was just regenerated. The old one no longer works.'],
  'keys-rotated': ['Your encryption keys were rotated', 'The encryption keys of your Bible sync account were just rotated.'],
};

/** Generic security notice (no tokens, no secrets): something about the account's credentials changed. */
export function securityChangeMail(to: string, publicUrl: string, change: SecurityChange): Mail {
  const [subject, lead] = SECURITY_LEAD[change];
  const link = `${base(publicUrl)}/account`;
  const tail = 'If this was you, no action is needed. If it was not, reset your password right away and sign out '
    + 'your other devices.';
  return { to, subject, text: `${lead}\n\n${tail}\n\n${link}\n`, html: html([lead, tail], link) };
}

/**
 * Starts sending without waiting for the result: the response time must not reveal whether a mail was sent
 * (reset, duplicate sign-up). Failures are logged by name only.
 */
export function dispatchMail(ctx: ServerContext, mail: Mail): void {
  const fail = (e: unknown): void => {
    ctx.opts.log('warn', 'sync-server: sending email failed', { name: (e as Error)?.name });
  };
  try {
    ctx.opts.email.send(mail).catch(fail);
  } catch (e) {
    fail(e);
  }
}
