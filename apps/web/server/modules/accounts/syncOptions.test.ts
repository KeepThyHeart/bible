import { describe, it, expect } from 'vitest';
import type { AccountsSettings } from '../../SiteConfig';
import { AccountsConfigError, buildSyncOptions, maxRecordBytesFor } from './syncOptions';

const SETTINGS: AccountsSettings = {
  publicUrl: 'https://bible.example.org',
  signupOpen: true,
  allowedOrigins: [],
  email: { kind: 'smtp', host: 'mail.example.org', from: 'Bible <noreply@example.org>' },
};
const parts = { sql: {} as never, serverSecret: new Uint8Array(32), email: { send: async () => {} } };

describe('accounts.maxRecordKB', () => {
  it('maps KiB of content to the server blob limit', () => {
    expect(maxRecordBytesFor(1024)).toBe(1024 * 1024 + 64);
    expect(maxRecordBytesFor(64)).toBe(64 * 1024 + 64);
    expect(maxRecordBytesFor(16384)).toBe(16 * 1024 * 1024 + 64);
  });

  it('is passed to the sync server only when set', () => {
    expect(buildSyncOptions(SETTINGS, parts).options.maxRecordBytes).toBeUndefined();
    expect(buildSyncOptions({ ...SETTINGS, maxRecordKB: 2048 }, parts).options.maxRecordBytes).toBe(2048 * 1024 + 64);
  });

  it('rejects values outside 64..16384 or non-integers with a config error', () => {
    for (const bad of [0, 63, 16385, 1.5, -1, Number.NaN]) {
      expect(() => buildSyncOptions({ ...SETTINGS, maxRecordKB: bad }, parts), String(bad)).toThrow(AccountsConfigError);
    }
  });
});
