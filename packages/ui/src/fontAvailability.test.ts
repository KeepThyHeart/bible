import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isFontInstalled, resetFontAvailabilityCache } from './fontAvailability';

/** A canvas whose text width depends on the first family named, like a real one. */
function fakeCanvas(installed: string[]) {
  let font = '';
  const ctx = {
    set font(v: string) { font = v; },
    get font() { return font; },
    measureText: () => {
      const first = /^72px\s+("([^"]+)"|[a-z-]+)/.exec(font);
      const family = first?.[2];
      const generic = (/(monospace|sans-serif|serif)$/.exec(font)?.[1] ?? 'monospace') as 'monospace';
      const base = { monospace: 100, serif: 110, 'sans-serif': 120 }[generic];
      return { width: family && installed.includes(family) ? base + 17 : base };
    },
  };
  return vi.spyOn(document, 'createElement').mockReturnValue({ getContext: () => ctx } as unknown as HTMLElement);
}

describe('isFontInstalled', () => {
  beforeEach(() => resetFontAvailabilityCache());
  afterEach(() => vi.restoreAllMocks());

  it('finds a family whose width differs from the generic fallback', () => {
    fakeCanvas(['Candara']);
    expect(isFontInstalled('Candara')).toBe(true);
    expect(isFontInstalled('Corbel')).toBe(false);
  });

  it('caches the answer per family', () => {
    const spy = fakeCanvas(['Candara']);
    isFontInstalled('Candara');
    spy.mockClear();
    isFontInstalled('Candara');
    expect(spy).not.toHaveBeenCalled();
  });

  it('counts every family as installed when there is no canvas to measure with', () => {
    vi.spyOn(document, 'createElement').mockReturnValue({ getContext: () => null } as unknown as HTMLElement);
    expect(isFontInstalled('Anything')).toBe(true);
  });
});
