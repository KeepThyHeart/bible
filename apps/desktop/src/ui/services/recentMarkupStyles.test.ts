/**
 * The remembered-styles store: ordering, dedup, the cap, and what happens when
 * the persisted blob is not what we wrote.
 *
 * The corruption cases are the point of the file. This store is read on the
 * path that renders the floating toolbar, so anything it can throw takes the
 * toolbar down with it - and the value lives in localStorage, where a stale
 * app version, a hand edit or a private-mode failure are all ordinary.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  RECENT_MARKUP_STYLES_LIMIT,
  RECENT_MARKUP_STYLES_STORAGE_KEY,
  clearStoredRecentMarkupStyles,
  loadRecentMarkupStyles,
  markupStyleKey,
  normalizeMarkupStyle,
  persistRecentMarkupStyles,
  withRecentMarkupStyle,
  type MarkupStyle,
} from './recentMarkupStyles';

const YELLOW_HIGHLIGHT: MarkupStyle = { markupType: 'highlight', color: 'yellow' };
const RED_HIGHLIGHT: MarkupStyle = { markupType: 'highlight', color: 'red' };
const BLUE_HIGHLIGHT: MarkupStyle = { markupType: 'highlight', color: 'blue' };
const WAVY_RED_UNDERLINE: MarkupStyle = {
  markupType: 'underline',
  color: 'red',
  underlineStyle: 'wavy',
  underlineColor: 'red',
};

describe('recent markup styles', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('identity', () => {
    it('treats a wavy red underline and a red highlight as different styles', () => {
      expect(markupStyleKey(WAVY_RED_UNDERLINE)).not.toBe(markupStyleKey(RED_HIGHLIGHT));
    });

    it('treats two underlines that differ only in style as different', () => {
      expect(markupStyleKey(WAVY_RED_UNDERLINE)).not.toBe(
        markupStyleKey({ ...WAVY_RED_UNDERLINE, underlineStyle: 'dotted' }),
      );
    });

    /* The full menu keeps its underline state while "Highlight" is selected. */
    it('ignores underline fields on a highlight', () => {
      expect(
        markupStyleKey({ markupType: 'highlight', color: 'yellow', underlineStyle: 'wavy' }),
      ).toBe(markupStyleKey(YELLOW_HIGHLIGHT));
    });

    it('defaults an underline with no explicit style/colour to solid, in its own colour', () => {
      expect(normalizeMarkupStyle({ markupType: 'underline', color: 'green' })).toEqual({
        markupType: 'underline',
        color: 'green',
        underlineStyle: 'solid',
        underlineColor: 'green',
      });
    });
  });

  describe('ordering', () => {
    it('puts the newest style first', () => {
      const list = withRecentMarkupStyle(withRecentMarkupStyle([], YELLOW_HIGHLIGHT), RED_HIGHLIGHT);
      expect(list.map(markupStyleKey)).toEqual([
        markupStyleKey(RED_HIGHLIGHT),
        markupStyleKey(YELLOW_HIGHLIGHT),
      ]);
    });

    it('promotes a re-used style instead of duplicating it', () => {
      let list: MarkupStyle[] = [];
      for (const style of [YELLOW_HIGHLIGHT, RED_HIGHLIGHT, YELLOW_HIGHLIGHT]) {
        list = withRecentMarkupStyle(list, style);
      }
      expect(list).toHaveLength(2);
      expect(list.map(markupStyleKey)).toEqual([
        markupStyleKey(YELLOW_HIGHLIGHT),
        markupStyleKey(RED_HIGHLIGHT),
      ]);
    });

    it('keeps only the three most recent', () => {
      let list: MarkupStyle[] = [];
      for (const style of [YELLOW_HIGHLIGHT, RED_HIGHLIGHT, BLUE_HIGHLIGHT, WAVY_RED_UNDERLINE]) {
        list = withRecentMarkupStyle(list, style);
      }
      expect(RECENT_MARKUP_STYLES_LIMIT).toBe(3);
      expect(list).toHaveLength(3);
      expect(list.map(markupStyleKey)).toEqual([
        markupStyleKey(WAVY_RED_UNDERLINE),
        markupStyleKey(BLUE_HIGHLIGHT),
        markupStyleKey(RED_HIGHLIGHT),
      ]);
      // The oldest fell off the end.
      expect(list.map(markupStyleKey)).not.toContain(markupStyleKey(YELLOW_HIGHLIGHT));
    });
  });

  describe('persistence', () => {
    it('round-trips a list through localStorage', () => {
      const list = [WAVY_RED_UNDERLINE, YELLOW_HIGHLIGHT];
      persistRecentMarkupStyles(list);

      expect(localStorage.getItem(RECENT_MARKUP_STYLES_STORAGE_KEY)).toBeTruthy();
      expect(loadRecentMarkupStyles()).toEqual(list.map(normalizeMarkupStyle));
    });

    it('forgets everything when cleared', () => {
      persistRecentMarkupStyles([YELLOW_HIGHLIGHT]);
      clearStoredRecentMarkupStyles();

      expect(localStorage.getItem(RECENT_MARKUP_STYLES_STORAGE_KEY)).toBeNull();
      expect(loadRecentMarkupStyles()).toEqual([]);
    });

    it('starts empty when nothing was ever saved', () => {
      expect(loadRecentMarkupStyles()).toEqual([]);
    });
  });

  describe('a store we did not write', () => {
    it('survives malformed JSON', () => {
      localStorage.setItem(RECENT_MARKUP_STYLES_STORAGE_KEY, '{not json');
      expect(loadRecentMarkupStyles()).toEqual([]);
    });

    it('survives a value that is not an array', () => {
      localStorage.setItem(RECENT_MARKUP_STYLES_STORAGE_KEY, '{"color":"yellow"}');
      expect(loadRecentMarkupStyles()).toEqual([]);
    });

    it('drops unknown colours, markup types and underline styles, keeping the rest', () => {
      localStorage.setItem(
        RECENT_MARKUP_STYLES_STORAGE_KEY,
        JSON.stringify([
          { markupType: 'highlight', color: 'chartreuse' },
          { markupType: 'scribble', color: 'red' },
          { markupType: 'underline', color: 'red', underlineStyle: 'zigzag' },
          null,
          'yellow',
          RED_HIGHLIGHT,
        ]),
      );

      expect(loadRecentMarkupStyles()).toEqual([RED_HIGHLIGHT]);
    });

    it('collapses duplicates that normalise to the same style', () => {
      localStorage.setItem(
        RECENT_MARKUP_STYLES_STORAGE_KEY,
        JSON.stringify([
          { markupType: 'highlight', color: 'yellow', underlineStyle: 'wavy' },
          YELLOW_HIGHLIGHT,
        ]),
      );

      expect(loadRecentMarkupStyles()).toEqual([YELLOW_HIGHLIGHT]);
    });

    it('caps an over-long stored list', () => {
      localStorage.setItem(
        RECENT_MARKUP_STYLES_STORAGE_KEY,
        JSON.stringify([YELLOW_HIGHLIGHT, RED_HIGHLIGHT, BLUE_HIGHLIGHT, WAVY_RED_UNDERLINE]),
      );

      expect(loadRecentMarkupStyles()).toHaveLength(RECENT_MARKUP_STYLES_LIMIT);
    });

    /* Private browsing / blocked site data: the accessor itself throws. */
    it('survives a localStorage that throws on read, and one that throws on write', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('access denied');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota exceeded');
      });

      expect(loadRecentMarkupStyles()).toEqual([]);
      expect(() => persistRecentMarkupStyles([YELLOW_HIGHLIGHT])).not.toThrow();
    });
  });
});
