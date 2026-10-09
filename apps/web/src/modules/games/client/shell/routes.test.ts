import { describe, expect, it } from 'vitest';
import { PATHS, filterToCodeAlphabet, joinUrl, normaliseCode, readRoute, screenUrl } from './routes.js';

describe('join codes', () => {
  it('accepts a code the way someone reads it off a screen', () => {
    expect(normaliseCode('qk 7p')).toBe('QK7P');
  });

  it('drops the separators people put in by hand', () => {
    expect(normaliseCode(' qk-7p ')).toBe('QK7P');
  });

  it('is already canonical when it is typed correctly', () => {
    expect(normaliseCode('QK7P')).toBe('QK7P');
  });

  it('is empty when nothing usable was typed', () => {
    expect(normaliseCode('- -')).toBe('');
  });
});

describe('filtering a typed code to the actual alphabet', () => {
  it('keeps every character the alphabet actually uses', () => {
    expect(filterToCodeAlphabet('k7c48')).toBe('K7C48');
  });

  it('drops a look-alike the alphabet deliberately excludes, mid-typing', () => {
    // 0/O, 1/I/L, U and the low-contrast pairs are never in a real code.
    expect(filterToCodeAlphabet('K0O1IL U7')).toBe('K7');
  });

  it('still tidies separators the way normaliseCode does', () => {
    expect(filterToCodeAlphabet(' k7-c4 ')).toBe('K7C4');
  });
});

describe('routes', () => {
  it('opens a scanned link on the join screen with the code filled in', () => {
    expect(readRoute('/play', '?room=qk7p')).toEqual({ name: 'play', code: 'QK7P', displayToken: null });
  });

  it('lands a bare visit on the home screen, not straight on the join form', () => {
    expect(readRoute('/', '')).toEqual({ name: 'home', code: null, displayToken: null });
  });

  it('still treats a code at the bare root as a join, not the home screen', () => {
    expect(readRoute('/', '?room=qk7p')).toEqual({ name: 'play', code: 'QK7P', displayToken: null });
  });

  it('sends an explicit visit to /play straight to the join form', () => {
    expect(readRoute('/play', '')).toEqual({ name: 'play', code: null, displayToken: null });
  });

  it('names the screen at the front of the room', () => {
    expect(readRoute('/screen', '').name).toBe('screen');
  });

  it('still names the screen route when it is reached by its old path', () => {
    expect(readRoute('/host', '').name).toBe('screen');
  });

  it('names the solo route', () => {
    expect(readRoute('/solo/', '').name).toBe('solo');
  });

  it('carries a display token added to the screen route, and nowhere else', () => {
    expect(readRoute('/screen', '?room=qk7p&t=abc123').displayToken).toBe('abc123');
    expect(readRoute('/play', '?room=qk7p&t=abc123').displayToken).toBe(null);
  });

  it('round-trips the link a QR code carries', () => {
    const url = new URL(joinUrl('https://bible.games', 'QK7P'));

    expect(readRoute(url.pathname, url.search)).toEqual({ name: 'play', code: 'QK7P', displayToken: null });
  });

  it('round-trips the display-token link a second-screen QR carries', () => {
    const url = new URL(screenUrl('https://bible.games', 'QK7P', 'abc123'));

    expect(readRoute(url.pathname, url.search)).toEqual({
      name: 'screen',
      code: 'QK7P',
      displayToken: 'abc123',
    });
  });
});

describe('routes under /games (the app mounts the pages there)', () => {
  it('reads the pages the server serves', () => {
    expect(readRoute('/games/play', '?room=ab12c').name).toBe('play');
    expect(readRoute('/games/play/', '').name).toBe('play');
    expect(readRoute('/games/screen', '?room=ab12c&t=tok')).toEqual({ name: 'screen', code: 'AB12C', displayToken: 'tok' });
    expect(readRoute('/games/solo', '').name).toBe('solo');
    expect(readRoute('/games', '').name).toBe('home');
    expect(readRoute('/games/', '?room=ab12c').name).toBe('play');
  });

  it('builds join and screen links under /games', () => {
    expect(joinUrl('https://x.test', 'QK7P')).toBe('https://x.test/games/play?room=QK7P');
    expect(screenUrl('https://x.test', 'QK7P', 'tk')).toBe('https://x.test/games/screen?room=QK7P&t=tk');
    expect(PATHS.play).toBe('/games/play');
  });
});
