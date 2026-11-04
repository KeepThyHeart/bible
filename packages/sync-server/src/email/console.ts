/** Development EmailSender: writes each message to the console (or any `write`), sends nothing. */
import type { EmailSender } from '../types';

export function consoleEmailSender(write: (line: string) => void = (l) => console.log(l)): EmailSender {
  return {
    send(m): Promise<void> {
      write(`[sync-server email] to: ${m.to}\n[sync-server email] subject: ${m.subject}\n${m.text}`);
      return Promise.resolve();
    },
  };
}
