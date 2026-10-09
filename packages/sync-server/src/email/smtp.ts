/** SMTP EmailSender over nodemailer (works with SES, Postmark or any SMTP relay). */
import { createTransport } from 'nodemailer';
import type { EmailSender } from '../types';

export interface SmtpOptions {
  host: string;
  port: number;
  /** TLS from the first byte (port 465); otherwise STARTTLS is used when offered. Default: port === 465. */
  secure?: boolean;
  user?: string;
  pass?: string;
  /** The From header, e.g. `Bible <noreply@example.org>`. */
  from: string;
}

/** The slice of a nodemailer transport this adapter needs (inject a fake in tests). */
export interface MailTransport {
  sendMail(message: { from: string; to: string; subject: string; text: string; html?: string }): Promise<unknown>;
  close?(): void;
}

export type TransportFactory = (o: SmtpOptions) => MailTransport;

const defaultFactory: TransportFactory = (o) => createTransport({
  host: o.host, port: o.port, secure: o.secure ?? o.port === 465,
  ...(o.user !== undefined ? { auth: { user: o.user, pass: o.pass ?? '' } } : {}),
});

const NO_NEWLINES = /[\r\n]/;

export function createSmtpEmailSender(o: SmtpOptions, transportFactory: TransportFactory = defaultFactory):
  EmailSender & { close(): void } {
  const transport = transportFactory(o);
  return {
    async send(m): Promise<void> {
      // Header injection guard (nodemailer folds headers, but a bare newline has no place in these fields).
      if (NO_NEWLINES.test(m.to) || NO_NEWLINES.test(m.subject)) throw new Error('invalid email header');
      await transport.sendMail({ from: o.from, to: m.to, subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}) });
    },
    close(): void { transport.close?.(); },
  };
}
