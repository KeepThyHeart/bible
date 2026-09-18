/**
 * Unit tests for the detachable-pane configuration table.
 *
 * `paneConfig` is pure data plus one `titleFormat` function per pane type, and
 * it sits directly on the pop-out path: `main.ts`'s `window:detach-pane`
 * handler calls `getPaneConfig(paneType)` and then `config.titleFormat(state)`
 * to name the OS window, while `WindowManager` reads `component` to decide
 * which React component the detached renderer mounts.
 *
 * Two things make that worth pinning down:
 *
 *  - `titleFormat` receives whatever the renderer happened to serialize. It is
 *    called with `undefined`/`{}` in real usage (several pop-out paths send an
 *    empty state), so every formatter has to degrade to a sensible label rather
 *    than render "undefined" into a title bar.
 *  - `component` must name a key that actually exists in `detached.tsx`'s
 *    `COMPONENT_MAP`. A typo there is invisible until a user pops out that pane
 *    and gets the "Unknown component" error screen.
 */

import { describe, it, expect } from 'vitest';
import {
  DETACHED_WINDOW_MAX_HEIGHT,
  DETACHED_WINDOW_MAX_WIDTH,
  PANE_CONFIGS,
  getPaneConfig,
  isValidPaneType,
  resolveDetachedWindowSize,
  type PaneType,
} from './paneConfig';

const ALL_PANE_TYPES = Object.keys(PANE_CONFIGS) as PaneType[];

describe('getPaneConfig / isValidPaneType', () => {
  it('returns a config for every declared pane type', () => {
    for (const paneType of ALL_PANE_TYPES) {
      expect(getPaneConfig(paneType), paneType).toBeDefined();
    }
  });

  it('returns undefined for an unknown pane type', () => {
    // The return type says PaneTypeConfig, but a record lookup on a missing key
    // yields undefined at runtime. main.ts relies on exactly this to reject
    // bogus paneTypes with "Unknown pane type" instead of crashing on
    // `config.titleFormat`.
    expect(getPaneConfig('not-a-pane' as PaneType)).toBeUndefined();
  });

  it('accepts every declared pane type', () => {
    for (const paneType of ALL_PANE_TYPES) {
      expect(isValidPaneType(paneType), paneType).toBe(true);
    }
  });

  it('rejects unknown and prototype-inherited keys', () => {
    expect(isValidPaneType('not-a-pane')).toBe(false);
    expect(isValidPaneType('')).toBe(false);
    // `paneType in PANE_CONFIGS` walks the prototype chain, so guard against
    // Object.prototype keys being mistaken for valid pane types.
    expect(isValidPaneType('toString')).toBe(false);
    expect(isValidPaneType('constructor')).toBe(false);
  });
});

describe('pane config invariants', () => {
  // The "does every `component` exist in detached.tsx's COMPONENT_MAP?" check
  // lives in src/ui/components/DetachedWindow.test.tsx, where both sides can be
  // imported for real rather than compared against a hand-copied list.

  it('declares a non-empty component name for every pane type', () => {
    for (const paneType of ALL_PANE_TYPES) {
      expect(PANE_CONFIGS[paneType].component, paneType).toBeTruthy();
    }
  });

  it('declares usable default dimensions', () => {
    for (const paneType of ALL_PANE_TYPES) {
      const config = PANE_CONFIGS[paneType];
      expect(config.defaultWidth, paneType).toBeGreaterThan(0);
      expect(config.defaultHeight, paneType).toBeGreaterThan(0);
    }
  });

  it('never declares a minimum larger than the default it opens at', () => {
    // A window created smaller than its own minimum gets silently resized by
    // the OS, so the pane opens at a size the layout was never tuned for.
    for (const paneType of ALL_PANE_TYPES) {
      const config = PANE_CONFIGS[paneType];
      if (config.minWidth !== undefined) {
        expect(config.defaultWidth, paneType).toBeGreaterThanOrEqual(config.minWidth);
      }
      if (config.minHeight !== undefined) {
        expect(config.defaultHeight, paneType).toBeGreaterThanOrEqual(config.minHeight);
      }
    }
  });
});

describe('titleFormat: degradation on missing state', () => {
  // Several pop-out paths hand over `{}` (see DockviewTabRenderer's POP_OUT_PANE_TYPE
  // fallbacks), and `initialState` crosses IPC, so `undefined` is reachable too.
  const EMPTY_STATES: Array<[string, unknown]> = [
    ['undefined', undefined],
    ['null', null],
    ['empty object', {}],
  ];

  for (const paneType of ALL_PANE_TYPES) {
    describe(paneType, () => {
      for (const [label, state] of EMPTY_STATES) {
        it(`produces a non-empty title with ${label} state`, () => {
          const title = PANE_CONFIGS[paneType].titleFormat(state);
          expect(typeof title).toBe('string');
          expect(title.trim().length).toBeGreaterThan(0);
        });

        it(`never leaks "undefined"/"null"/"[object Object]" with ${label} state`, () => {
          const title = PANE_CONFIGS[paneType].titleFormat(state);
          expect(title).not.toMatch(/undefined|null|\[object Object\]/);
        });
      }
    });
  }
});

describe('titleFormat: populated state', () => {
  it('bible includes translation, book and chapter', () => {
    const title = PANE_CONFIGS.bible.titleFormat({
      activeTab: { abbreviation: 'KJV' },
      currentBookName: 'John',
      currentChapter: 3,
    });
    expect(title).toBe('Bible - KJV - John 3');
  });

  it('bible falls back to the translation alone when the passage is unknown', () => {
    expect(PANE_CONFIGS.bible.titleFormat({ activeTab: { abbreviation: 'ESV' } }))
      .toBe('Bible - ESV');
  });

  it('bible does not repeat the word "Bible" when a passage is present', () => {
    // Regression: the dockview tab context menu can serialize the panel state
    // without `activeTab`. If `abbreviation` then falls through to the literal
    // 'Bible', a popped-out passage is titled "Bible - Bible - John 3".
    const title = PANE_CONFIGS.bible.titleFormat({
      activeTab: { abbreviation: 'KJV' },
      currentBookName: 'John',
      currentChapter: 3,
    });
    expect(title).not.toContain('Bible - Bible');
  });

  it('commentary includes the commentary name', () => {
    expect(PANE_CONFIGS.commentary.titleFormat({ commentaryName: "Matthew Henry" }))
      .toBe('Commentary - Matthew Henry');
  });

  it('commentary names itself from the handed-over tab when nothing else does', () => {
    // Regression: no pop-out path sets `commentaryName`, so reading only that
    // field titled every commentary window "Commentary - Commentary".
    expect(PANE_CONFIGS.commentary.titleFormat({
      openTabs: [{ abbreviation: 'MHC', name: 'Matthew Henry' }],
      activeTabIndex: 0,
    })).toBe('Commentary - Matthew Henry');
  });

  it('book names itself from the active tab', () => {
    expect(PANE_CONFIGS.book.titleFormat({
      openTabs: [{ abbreviation: 'book_pp', name: 'Pilgrims Progress' }],
      activeTabIndex: 0,
    })).toBe('Book - Pilgrims Progress');
  });

  it('book degrades when the tab has no name', () => {
    expect(PANE_CONFIGS.book.titleFormat({ openTabs: [{}], activeTabIndex: 0 }))
      .toBe('Book - Book');
  });

  it('verse-notes names itself from the note the window opened on', () => {
    // Neither pop-out path sends `noteName`, so without the basename every
    // notes window was called "Verse Notes - My Verse Notes".
    expect(PANE_CONFIGS['verse-notes'].titleFormat({
      initialCurrentNotePath: String.raw`C:\notes\Sermons\Romans 8.bn`,
    })).toBe('Verse Notes - Romans 8');
    // Same path with the separator the notes store actually writes on POSIX.
    expect(PANE_CONFIGS['verse-notes'].titleFormat({
      initialCurrentNotePath: '/home/me/notes/Sermons/Romans 8.bn',
    })).toBe('Verse Notes - Romans 8');
  });

  it('verse-notes degrades when the pop-out carried no note', () => {
    expect(PANE_CONFIGS['verse-notes'].titleFormat({}))
      .toBe('Verse Notes - My Verse Notes');
  });

  it('book titles itself Dictionary when it is carrying a dictionary', () => {
    // Regression: a dictionary detaches as a Books window (it is the same
    // component), and the title followed the window type rather than
    // `paneKind` - so popping out Easton's opened a window called "Books".
    expect(PANE_CONFIGS.book.titleFormat({
      paneKind: 'dictionary',
      dictOpenTabs: [{ abbreviation: 'easton', name: "Easton's Bible Dictionary" }],
      dictActiveTabIndex: 0,
    })).toBe("Dictionary - Easton's Bible Dictionary");
  });

  it('a dictionary window degrades to Dictionary, not Book', () => {
    expect(PANE_CONFIGS.book.titleFormat({ paneKind: 'dictionary' }))
      .toBe('Dictionary - Dictionary');
  });

  it('has no document or journal entry: neither panel kind can be created', () => {
    // `POP_OUT_PANE_TYPE` in DockviewTabRenderer never produces 'document' or
    // 'journal', so nothing can detach one. There is deliberately no pane
    // config for either kind.
    expect(isValidPaneType('document')).toBe(false);
    expect(isValidPaneType('journal')).toBe(false);
  });

  it('has no dictionary entry: a dictionary detaches as a Books window', () => {
    // Both pop-out paths (`POP_OUT_PANE_TYPE` in DockviewTabRenderer and
    // `popOutModuleToWindow`) rewrite 'dictionary' to 'book', because the two
    // share one tab strip in one component. A dictionary config here was
    // unreachable, and named a component that renders without that strip.
    expect(isValidPaneType('dictionary')).toBe(false);
  });

  it('verse-notes includes the note name', () => {
    expect(PANE_CONFIGS['verse-notes'].titleFormat({ noteName: 'Romans study' }))
      .toBe('Verse Notes - Romans study');
  });

  it('chapter 0 is treated as absent rather than rendered', () => {
    // Chapter numbers are 1-based; a 0 means "not loaded yet", and the `||`
    // chain must not produce a dangling "John 0".
    const title = PANE_CONFIGS.bible.titleFormat({
      activeTab: { abbreviation: 'KJV' },
      currentBookName: 'John',
      currentChapter: 0,
    });
    expect(title).toBe('Bible - KJV');
  });
});

/**
 * The clamp is the trust boundary for an extension-supplied window size.
 *
 * The request originates in third-party code (`ui.registerPanelType`) and
 * arrives here over IPC from the renderer, so "the renderer already checked
 * it" is not a defence - anything that can reach `window:detach-pane` can send
 * whatever it likes. Electron does not clamp a requested size, so an
 * unchecked value opens a window whose title bar and close button are
 * off-screen, or one a few pixels tall that cannot be grabbed to resize.
 */
describe('resolveDetachedWindowSize', () => {
  const extension = PANE_CONFIGS.extension;

  it('falls back to the pane defaults when nothing is requested', () => {
    for (const requested of [undefined, null]) {
      expect(resolveDetachedWindowSize(extension, requested)).toEqual({
        width: extension.defaultWidth,
        height: extension.defaultHeight,
      });
    }
  });

  it('honours a sensible request', () => {
    expect(resolveDetachedWindowSize(extension, { width: 460, height: 1000 })).toEqual({
      width: 460,
      height: 1000,
    });
  });

  it('clamps up to the pane minimum', () => {
    // A 1px window has no grab handle and no title bar; the user's only
    // recourse would be the OS window list.
    expect(resolveDetachedWindowSize(extension, { width: 1, height: 1 })).toEqual({
      width: extension.minWidth,
      height: extension.minHeight,
    });
    expect(resolveDetachedWindowSize(extension, { width: -900, height: 0 })).toEqual({
      width: extension.minWidth,
      height: extension.minHeight,
    });
  });

  it('clamps down to the 4K ceiling', () => {
    expect(resolveDetachedWindowSize(extension, { width: 30000, height: 30000 })).toEqual({
      width: DETACHED_WINDOW_MAX_WIDTH,
      height: DETACHED_WINDOW_MAX_HEIGHT,
    });
  });

  it('resolves width and height independently', () => {
    // A panel that cares about width only should not lose its height to the
    // same fallback.
    expect(resolveDetachedWindowSize(extension, { width: 500 })).toEqual({
      width: 500,
      height: extension.defaultHeight,
    });
    expect(resolveDetachedWindowSize(extension, { height: 500 })).toEqual({
      width: extension.defaultWidth,
      height: 500,
    });
  });

  it('ignores non-numeric junk rather than failing the pop-out', () => {
    // The payload crossed an IPC boundary and was authored by an extension;
    // a bad value must degrade to the default, not throw and leave the user
    // with a pop-out menu item that silently does nothing.
    const junk = [
      { width: '900', height: '700' },
      { width: NaN, height: Infinity },
      { width: null, height: {} },
      'not an object',
      42,
    ];
    for (const requested of junk) {
      expect(
        resolveDetachedWindowSize(extension, requested as never),
        JSON.stringify(requested),
      ).toEqual({ width: extension.defaultWidth, height: extension.defaultHeight });
    }
  });

  it('rounds fractional sizes to whole pixels', () => {
    expect(resolveDetachedWindowSize(extension, { width: 640.4, height: 480.6 })).toEqual({
      width: 640,
      height: 481,
    });
  });

  it('uses each pane type\'s own minimum, not one global floor', () => {
    // Bible declares minWidth 600 (see PANE_CONFIGS); a request below it must
    // clamp to that, not to the extension pane's 320.
    const bible = PANE_CONFIGS.bible;
    const resolved = resolveDetachedWindowSize(bible, { width: 10, height: 10 });
    expect(resolved.width).toBe(bible.minWidth);
    expect(resolved.height).toBe(bible.minHeight);
  });
});
