import { describe, it, expect } from 'vitest';
import { createPermissionHandlers, fakeMicSwitches, isReciteEnabled } from './permissions';

const main = {};
const other = {};
const deps = (on = true) => ({
  enabled: () => on,
  isMainContents: (wc: unknown) => wc === main,
  isOwnUrl: (u: string) => u.startsWith('file://'),
});

describe('media permission policy', () => {
  it('grants audio to the main window\'s own page', () => {
    const h = createPermissionHandlers(deps());
    let granted: boolean | undefined;
    h.request(main, 'media', (g) => (granted = g), { mediaTypes: ['audio'], requestingUrl: 'file:///app/index.html' });
    expect(granted).toBe(true);
    expect(h.check(main, 'media', 'file://', { mediaType: 'audio', requestingUrl: 'file:///app/index.html' })).toBe(true);
  });

  it('denies video, other windows, foreign urls, subframes and flag off', () => {
    const ask = (wc: unknown, d: Record<string, unknown>, on = true) => {
      let g: boolean | undefined;
      createPermissionHandlers(deps(on)).request(wc, 'media', (v) => (g = v), d);
      return g;
    };
    const ok = { mediaTypes: ['audio'], requestingUrl: 'file:///a' };
    expect(ask(main, { ...ok, mediaTypes: ['audio', 'video'] })).toBe(false);
    expect(ask(main, { ...ok, mediaTypes: [] })).toBe(false);
    expect(ask(other, ok)).toBe(false);
    expect(ask(main, { ...ok, requestingUrl: 'https://evil.example' })).toBe(false);
    expect(ask(main, { ...ok, isMainFrame: false })).toBe(false);
    expect(ask(main, ok, false)).toBe(false);
  });

  it('leaves other permissions to the fallback', () => {
    let g: boolean | undefined;
    createPermissionHandlers(deps(), true).request(main, 'notifications', (v) => (g = v));
    expect(g).toBe(true);
    expect(createPermissionHandlers(deps()).check(main, 'geolocation', '')).toBe(false);
  });
});

describe('dev helpers', () => {
  it('recite flag: off by default and when packaged; KTH_FLAGS in dev', () => {
    expect(isReciteEnabled(false, {})).toBe(false);
    expect(isReciteEnabled(false, { KTH_FLAGS: 'recite' })).toBe(true);
    expect(isReciteEnabled(true, { KTH_FLAGS: 'recite' })).toBe(false);
  });

  it('fake mic switches only in dev with a wav', () => {
    expect(fakeMicSwitches(false, {})).toEqual([]);
    expect(fakeMicSwitches(true, { KTH_FAKE_MIC_WAV: '/x.wav' })).toEqual([]);
    expect(fakeMicSwitches(false, { KTH_FAKE_MIC_WAV: '/x.wav' }).map((s) => s[0])).toEqual([
      'use-fake-ui-for-media-stream',
      'use-fake-device-for-media-stream',
      'use-file-for-fake-audio-capture',
    ]);
  });
});
