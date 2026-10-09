import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/preact';
import { effectiveDisplay, itemTransitionKey, parseStoredOverride, useItemTransitionFlash } from '../viewerChrome';
import type { PresentItem } from '../protocol';

describe('parseStoredOverride', () => {
  it('reads back nothing when nothing was stored', () => {
    expect(parseStoredOverride(null)).toEqual({});
  });

  it('reads back a valid theme and font step', () => {
    expect(parseStoredOverride('{"theme":"max","fontStep":8}')).toEqual({ theme: 'max', fontStep: 8 });
  });

  it('drops an unreadable value rather than throwing', () => {
    expect(parseStoredOverride('not json')).toEqual({});
    expect(parseStoredOverride('null')).toEqual({});
  });

  it('drops a theme this build does not know, keeping a valid font step', () => {
    expect(parseStoredOverride('{"theme":"purple","fontStep":6}')).toEqual({ fontStep: 6 });
  });

  it('drops a font step outside the scale', () => {
    expect(parseStoredOverride('{"fontStep":0}')).toEqual({});
    expect(parseStoredOverride('{"fontStep":11}')).toEqual({});
  });
});

describe('effectiveDisplay', () => {
  const presenter = { theme: 'dark', fontStep: 5 } as const;

  it('follows the presenter when this screen has no override', () => {
    expect(effectiveDisplay(presenter, {})).toEqual({ theme: 'dark', fontStep: 5 });
  });

  it('overrides only the field this screen has chosen', () => {
    expect(effectiveDisplay(presenter, { theme: 'max' })).toEqual({ theme: 'max', fontStep: 5 });
    expect(effectiveDisplay(presenter, { fontStep: 8 })).toEqual({ theme: 'dark', fontStep: 8 });
  });

  it('overrides both when this screen has chosen both', () => {
    expect(effectiveDisplay(presenter, { theme: 'light', fontStep: 2 })).toEqual({ theme: 'light', fontStep: 2 });
  });

  it('follows the presenter to a new value once the override is cleared', () => {
    expect(effectiveDisplay({ theme: 'max', fontStep: 9 }, {})).toEqual({ theme: 'max', fontStep: 9 });
  });
});

describe('itemTransitionKey', () => {
  it('is null with nothing live', () => {
    expect(itemTransitionKey(null)).toBeNull();
  });

  it('is the same key for the same passage, and different for a different one', () => {
    const john3: PresentItem = { kind: 'passage', module: 'KJV', book: 43, chapter: 3 };
    const john4: PresentItem = { kind: 'passage', module: 'KJV', book: 43, chapter: 4 };
    expect(itemTransitionKey(john3)).toBe(itemTransitionKey({ ...john3 }));
    expect(itemTransitionKey(john3)).not.toBe(itemTransitionKey(john4));
  });

  it('distinguishes a narrowed passage from the whole chapter', () => {
    const whole: PresentItem = { kind: 'passage', module: 'KJV', book: 43, chapter: 3 };
    const narrow: PresentItem = { kind: 'passage', module: 'KJV', book: 43, chapter: 3, verseStart: 16, verseEnd: 16 };
    expect(itemTransitionKey(whole)).not.toBe(itemTransitionKey(narrow));
  });

  it('keys a hymn by id and verse order', () => {
    const a: PresentItem = { kind: 'hymn', hymnId: 'amazing-grace' };
    const b: PresentItem = { kind: 'hymn', hymnId: 'amazing-grace', verseOrder: ['1', 'R'] };
    expect(itemTransitionKey(a)).not.toBe(itemTransitionKey(b));
  });

  it('keys a text slide by its content', () => {
    const a: PresentItem = { kind: 'text', body: 'Glory be to the Father' };
    const b: PresentItem = { kind: 'text', body: 'Glory be to the Son' };
    expect(itemTransitionKey(a)).not.toBe(itemTransitionKey(b));
  });
});

describe('useItemTransitionFlash', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not flash on the first render', () => {
    const { result } = renderHook(({ key }) => useItemTransitionFlash(key), {
      initialProps: { key: 'passage:KJV:43:3::' },
    });
    expect(result.current).toBe(0);
  });

  it('bumps the sequence each time the key changes', () => {
    const { result, rerender } = renderHook(({ key }) => useItemTransitionFlash(key), {
      initialProps: { key: null as string | null },
    });
    expect(result.current).toBe(0);

    act(() => rerender({ key: 'passage:KJV:43:3::' }));
    expect(result.current).toBe(1);

    act(() => rerender({ key: 'passage:KJV:43:4::' }));
    expect(result.current).toBe(2);
  });

  it('does not flash when the key is unchanged, e.g. a reconnect resending the same item', () => {
    const { result, rerender } = renderHook(({ key }) => useItemTransitionFlash(key), {
      initialProps: { key: 'passage:KJV:43:3::' },
    });

    act(() => rerender({ key: 'passage:KJV:43:3::' }));
    expect(result.current).toBe(0);
  });

  it('never flashes when the viewer prefers reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);

    const { result, rerender } = renderHook(({ key }) => useItemTransitionFlash(key), {
      initialProps: { key: null as string | null },
    });
    act(() => rerender({ key: 'passage:KJV:43:3::' }));
    expect(result.current).toBe(0);
  });
});
