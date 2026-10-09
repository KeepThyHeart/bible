/** @bible/sync-server: explicit named exports only (CJS build, required by the web server through a bridge). */
export { createSyncServer } from './createSyncServer';
export type { SyncServerOptions, EmailSender, SyncServer } from './types';
export type {
  SyncStore, AccountRow, NewAccount, SessionRow, DeviceRow, DeviceDetail, EmailTokenRow,
} from './store/SyncStore';
export { consoleEmailSender, createSmtpEmailSender } from './email';
export type { SmtpOptions, MailTransport, TransportFactory } from './email';
