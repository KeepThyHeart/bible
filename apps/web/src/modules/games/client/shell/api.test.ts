// @vitest-environment jsdom
import type { i18n } from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { joinRoom } from './api.js';
import { setGamesI18n } from './t.js';

const NOT_FOUND = {
  error: 'roomNotFound',
  message: 'No room is using that code. Check the code on the big screen.',
};

function respond(status: number, body: unknown): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

afterEach(() => {
  vi.unstubAllGlobals();
  setGamesI18n(null);
});

// 0209 R2 W14 item 2: the server's error code, not its English sentence, is what gets translated.
describe('request errors', () => {
  it('keeps the server sentence when there is no translation', async () => {
    respond(404, NOT_FOUND);
    const result = await joinRoom('CD234', 'Ana', null);
    expect(result).toEqual({ ok: false, error: NOT_FOUND.message });
  });

  it('translates a known error code', async () => {
    setGamesI18n({
      isInitialized: true,
      t: (key: string, o?: { defaultValue?: string }) =>
        key === 'games.errors.roomNotFound' ? 'Ninguna sala usa ese código.' : (o?.defaultValue ?? key),
    } as unknown as i18n);
    respond(404, NOT_FOUND);
    const result = await joinRoom('CD234', 'Ana', null);
    expect(result).toEqual({ ok: false, error: 'Ninguna sala usa ese código.' });
  });

  it('falls back to the server message for an unknown code, and to the status with none', async () => {
    respond(400, { error: 'badIntent', message: 'nope' });
    expect(await joinRoom('CD234', 'Ana', null)).toEqual({ ok: false, error: 'nope' });
    respond(500, null);
    expect(await joinRoom('CD234', 'Ana', null)).toEqual({ ok: false, error: 'Server said 500.' });
  });
});
