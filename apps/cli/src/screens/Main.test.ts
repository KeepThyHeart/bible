/**
 * Acceptance tests for the main screen.
 *
 * Driven against the real KJV where a chapter has to be read correctly: a
 * fixture would only prove this screen agrees with the test's idea of a chapter. Where the real module is not
 * available (this checkout may not carry the multi-megabyte asset — see
 * `hasKjv` below) those tests are skipped, exactly as the rest of this
 * package already does.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { VerseIdHelper } from '@bible/core';

import { discoverModules } from '../data/modules';
import { Library } from '../app/library';
import { bodyMetrics } from '../app/frame';
import { classifyInput } from '../app/input';
import { DEFAULT_TAB, type TabState } from '../app/state';
import { createTheme, renderStyledLine, stripAnsi } from '../term/style';
import type { Key } from '../term/keys';
import { MainScreen } from './Main';
import { DEFAULT_DISPLAY, syncAction, type ScreenContext, type ScreenView } from './types';

const MODULES = join(import.meta.dir, '..', '..', '..', '..', 'data', 'modules');
const hasKjv = existsSync(join(MODULES, 'bible_kjv.db'));

const theme = createTheme('ansi256');

const JOHN = 43;
const ROMANS = 45;
const GENESIS = 1;

let shared: Library | undefined;
function library(): Library {
  shared ??= Library.open({ modules: discoverModules() });
  return shared;
}

function context(
  tab: Partial<TabState> = {},
  rows = 30,
  columns = 88,
  extra: Partial<
    Pick<ScreenContext, 'bookmarks' | 'lastCommentary' | 'input' | 'inputOpen' | 'display'>
  > = {},
): ScreenContext {
  const size = { columns, rows };
  const { width, height } = bodyMetrics(size, 0, extra.inputOpen ?? false);
  return {
    size,
    bodyWidth: width,
    bodyHeight: height,
    theme,
    library: library(),
    session: { tabs: [{ ...DEFAULT_TAB, ...tab }], activeTab: 0 },
    tab: { ...DEFAULT_TAB, ...tab },
    display: DEFAULT_DISPLAY,
    input: '',
    inputOpen: false,
    bookmarks: [],
    lastCommentary: undefined,
    ...extra,
  };
}

const at = (book: number, chapter: number, verse: number): Partial<TabState> => ({
  bookNumber: book,
  chapter,
  cursorVerse: VerseIdHelper.calculate(book, chapter, verse),
});

function key(name: Key['name'], char?: string, modifiers: Partial<Key> = {}): Key {
  return {
    name,
    ctrl: false,
    alt: false,
    shift: false,
    sequence: '',
    ...(char === undefined ? {} : { char }),
    ...modifiers,
  };
}

function bodyOf(view: ScreenView): readonly (readonly { text: string }[])[] {
  expect(view.body).toBeDefined();
  return view.body ?? [];
}

function textOf(view: ScreenView): string {
  return bodyOf(view)
    .map((line) => stripAnsi(renderStyledLine(line, theme.depth)))
    .join('\n');
}

describe.skipIf(!hasKjv)('the main screen — reading', () => {
  test('opens on the tab’s chapter and pane', () => {
    const screen = new MainScreen();
    const text = textOf(screen.view(context(at(JOHN, 3, 16))));
    expect(text).toContain('John 3');
    expect(text).toContain('For God so loved the world');
  });

  test('a wide terminal shows the Study pane’s hint menu beside the passage', () => {
    const screen = new MainScreen();
    const text = textOf(screen.view(context(at(JOHN, 3, 16), 30, 140)));
    expect(text).toContain('For God so loved the world');
    expect(text).toContain('Cross-References');
    expect(text).toContain('History');
  });

  test('a narrow terminal shows only the Bible pane by default', () => {
    const screen = new MainScreen();
    const text = textOf(screen.view(context(at(JOHN, 3, 16), 30, 80)));
    expect(text).toContain('For God so loved the world');
    expect(text).not.toContain('Cross-References');
  });

  test('`s` peeks at the shortcut legend on a narrow terminal, and back', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 80);

    const opened = syncAction(screen.key(key('char', 's'), ctx));
    expect(opened.kind).toBe('redraw');
    expect(textOf(screen.view(ctx))).toContain('Cross-References');
    // Still reading mode underneath: up/down still move the verse, not the legend.
    const moved = syncAction(screen.key(key('down'), ctx));
    expect(moved.kind).toBe('tab');

    const closed = syncAction(screen.key(key('char', 's'), ctx));
    expect(closed.kind).toBe('redraw');
    const text = textOf(screen.view(ctx));
    expect(text).not.toContain('Cross-References');
    expect(text).toContain('For God so loved the world');
  });

  test('a wide terminal shows the shortcut legend continuously, and `s` has nothing to add there', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    expect(textOf(screen.view(ctx))).toContain('History');

    syncAction(screen.key(key('char', 's'), ctx));
    // Still there — a wide terminal's right pane shows it whether or not the
    // (narrow-only) peek flag is set.
    expect(textOf(screen.view(ctx))).toContain('History');
  });

  test('up/down move the verse cursor and record it in history', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    screen.view(ctx); // seed history at the starting passage

    const action = syncAction(screen.key(key('down'), ctx));
    expect(action.kind).toBe('tab');
    if (action.kind === 'tab') {
      expect(VerseIdHelper.parse(action.tab.cursorVerse).verse).toBe(17);
    }
  });

  test('`n`/`p` page chapters and leave one history line, not one per page', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    screen.view(ctx);

    const forward = syncAction(screen.key(key('char', 'n'), ctx));
    expect(forward.kind).toBe('tab');
    const ctx2 = forward.kind === 'tab' ? context(forward.tab, 30, 140) : ctx;
    screen.view(ctx2);
    syncAction(screen.key(key('char', 'n'), ctx2));

    syncAction(screen.key(key('char', 'h'), ctx2));
    const historyText = textOf(screen.view(ctx2));
    // Exactly one line for the pages through John — not three. Only the
    // History list's own numbered rows count: history is now the *main*
    // pane's content (left of the divider), and the right pane's own current-
    // verse title may say "John" too, so only the left side is searched.
    const johnLines = historyText
      .split('\n')
      .map((l) => l.split('│')[0] ?? '')
      .filter((l) => /▸?\d+\s+John \d+/.test(l));
    expect(johnLines).toHaveLength(1);
  });

  test('a typed reference is a jump: `h` lists it, and picking it navigates there', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    screen.view(ctx);

    const jumped = syncAction(
      screen.submit(classifyInput('romans 8:28', { book: JOHN, chapter: 3 }), ctx),
    );
    expect(jumped.kind).toBe('tab');
    if (jumped.kind !== 'tab') throw new Error('expected a tab action');
    expect(jumped.tab.bookNumber).toBe(ROMANS);

    const ctx2 = context(jumped.tab, 30, 140);
    screen.view(ctx2);
    syncAction(screen.key(key('char', 'h'), ctx2));
    const listed = textOf(screen.view(ctx2));
    expect(listed).toContain('John 3');
    expect(listed).toContain('Romans 8');

    // Pick row 2 — John 3, the older entry — and go there.
    syncAction(screen.key(key('char', '2'), ctx2));
    const picked = syncAction(screen.key(key('enter'), ctx2));
    expect(picked.kind).toBe('tab');
    if (picked.kind === 'tab') {
      expect(picked.tab.bookNumber).toBe(JOHN);
      expect(picked.tab.chapter).toBe(3);
    }
  });

  test('`o` and `b` open Options and Bookmarks from the hint menu', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    expect(syncAction(screen.key(key('char', 'o'), ctx)).kind).toBe('redraw');
    expect(textOf(screen.view(ctx))).toContain('Options');

    syncAction(screen.key(key('escape'), ctx));
    expect(syncAction(screen.key(key('char', 'b'), ctx)).kind).toBe('redraw');
    expect(textOf(screen.view(ctx))).toContain('Bookmarks');
  });

  test('`q` quits', () => {
    const screen = new MainScreen();
    expect(syncAction(screen.key(key('char', 'q'), context(at(GENESIS, 1, 1)))).kind).toBe('quit');
  });
});

describe.skipIf(!hasKjv)('the main screen — settings bugs (0041)', () => {
  test('the Layout setting is no longer hardcoded to paragraph mode', () => {
    const screen = new MainScreen();
    const paragraph = textOf(screen.view(context(at(JOHN, 3, 16))));
    expect(paragraph).toContain('¹⁶For God so loved');

    // Same `screen` instance, same verse — only `displayMode` differs, which
    // also exercises the cache-key fix: a fresh `MainScreen` would prove
    // nothing about the cache, since it would recompute from cold either way.
    const numbered = textOf(screen.view(context({ ...at(JOHN, 3, 16), displayMode: 'numbered' })));
    expect(numbered).not.toContain('¹⁶For God so loved');
    expect(numbered).toContain('For God so loved');
  });

  test('"break on verse" takes effect on its own, with no other setting touched first', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16));
    const off = textOf(screen.view(ctx)); // seed the cache at the default (break on verse: off)

    const on = context(at(JOHN, 3, 16), 30, 88, { display: { ...DEFAULT_DISPLAY, breakOnVerse: true } });
    const withBreaks = textOf(screen.view(on));

    // A blank line between every verse: far more paragraph breaks than the
    // module's own formatting alone produces over the same window — not
    // dependent on which two verses the current scroll position happens to
    // show adjacent to each other.
    const blanksOff = (off.match(/\n\n/g) ?? []).length;
    const blanksOn = (withBreaks.match(/\n\n/g) ?? []).length;
    expect(blanksOn).toBeGreaterThan(blanksOff);
  });

  test('verse numbers take effect on their own, with no other setting touched first', () => {
    const screen = new MainScreen();
    const withNumbers = textOf(screen.view(context(at(JOHN, 3, 16))));
    expect(withNumbers).toContain('¹⁶For God so loved');

    const hidden = context(at(JOHN, 3, 16), 30, 88, {
      display: { ...DEFAULT_DISPLAY, verseNumbers: 'hidden' },
    });
    const withoutNumbers = textOf(screen.view(hidden));
    expect(withoutNumbers).not.toContain('¹⁶');
    expect(withoutNumbers).toContain('For God so loved');
  });
});

describe.skipIf(!hasKjv)('the main screen — the two-pane layout', () => {
  test('a wide terminal shows the current verse and the shortcut legend in the right pane', () => {
    const screen = new MainScreen();
    const text = textOf(screen.view(context(at(JOHN, 3, 16), 30, 140)));
    expect(text).toContain('For God so loved the world'); // main pane: the chapter
    expect(text).toContain('John 3:16'); // right pane: current verse reference
    expect(text).toContain('Cross-References'); // right pane: the shortcut legend
  });

  test('the right pane disappears below the breakpoint; the footer hint carries the shortcuts instead', () => {
    const screen = new MainScreen();
    const view = screen.view(context(at(JOHN, 3, 16), 30, 80));
    expect(textOf(view)).not.toContain('Cross-References');
    expect(view.hints).toContain('/ go to or search');
  });

  test('study mode puts the resource in the main pane; the right pane keeps showing the current verse', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    screen.view(ctx);
    syncAction(screen.key(key('char', 'x'), ctx));
    const text = textOf(screen.view(ctx));
    expect(text).toContain('Cross-References'); // main pane, now the resource
    expect(text).toContain('John 3:16'); // right pane, still the current verse
  });
});

describe.skipIf(!hasKjv)('the main screen — the "/" popup', () => {
  test('the line closed draws no popup; opened it shows usage text', () => {
    const screen = new MainScreen();
    const closed = screen.view(context(at(JOHN, 3, 16), 30, 140, { inputOpen: false }));
    expect(closed.overlay).toBeUndefined();

    const opened = screen.view(context(at(JOHN, 3, 16), 30, 140, { inputOpen: true, input: '' }));
    expect(opened.overlay).toBeDefined();
    expect(opened.overlay?.title).toBe('Go to or search');
  });

  test('typing a reference previews where it goes; typing plain text previews a search', () => {
    const screen = new MainScreen();
    const rowsText = (ctx: ScreenContext): string =>
      (screen.view(ctx).overlay?.rows ?? [])
        .map((r) => stripAnsi(renderStyledLine(r, theme.depth)))
        .join('\n');

    const ref = context(at(JOHN, 3, 16), 30, 140, { inputOpen: true, input: 'romans 8:28' });
    expect(rowsText(ref)).toContain('Romans 8:28');

    const search = context(at(JOHN, 3, 16), 30, 140, { inputOpen: true, input: 'everlasting life' });
    expect(rowsText(search)).toContain('Search for "everlasting life"');
  });

  test('typing the start of a book name suggests matches', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140, { inputOpen: true, input: 'jo' });
    const text = (screen.view(ctx).overlay?.rows ?? [])
      .map((r) => stripAnsi(renderStyledLine(r, theme.depth)))
      .join('\n');
    expect(text).toContain('Books:');
  });
});

const hasStudyModules =
  hasKjv &&
  existsSync(join(MODULES, 'xref_tsk.db')) &&
  existsSync(join(MODULES, 'topical_nave.db')) &&
  existsSync(join(MODULES, 'commentary_mhc.db'));

describe.skipIf(!hasStudyModules)('the main screen — study panes', () => {
  test('`x` lists cross references, and a number jumps and returns to the hints', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    screen.view(ctx);

    syncAction(screen.key(key('char', 'x'), ctx));
    const listed = textOf(screen.view(ctx));
    expect(listed).toContain('Cross-References');

    syncAction(screen.key(key('char', '1'), ctx));
    const jumped = syncAction(screen.key(key('enter'), ctx));
    expect(jumped.kind).toBe('tab');

    // Picking a reference is a plain jump: it returns to the hints.
    const after = jumped.kind === 'tab' ? context(jumped.tab, 30, 140) : ctx;
    expect(textOf(screen.view(after))).toContain('Cross-References (');
  });

  test('`esc` backs out of the cross-reference list without moving', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    screen.view(ctx);
    syncAction(screen.key(key('char', 'x'), ctx));
    const back = syncAction(screen.key(key('escape'), ctx));
    expect(back.kind).toBe('redraw');
    expect(textOf(screen.view(ctx))).toContain('Cross-References (');
  });

  test('`c` lists commentaries alphabetically, and a number opens one', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    screen.view(ctx);

    syncAction(screen.key(key('char', 'c'), ctx));
    const listed = textOf(screen.view(ctx));
    expect(listed).toContain('Commentaries');
    expect(listed.toLowerCase()).toContain('mhc');

    // Whichever number and name MHC landed on: read the row back rather than
    // assuming either — the alphabetical order is asserted
    // separately in `app/studyPanes.test.ts`.
    const row = listed.split('\n').find((l) => l.toLowerCase().includes('mhc'));
    expect(row).toBeDefined();
    if (row === undefined) return;
    const number = row.trim().slice(0, 2);
    const moduleName = row.trim().slice(2).trim().split(/\s{2,}/).pop()?.trim();
    expect(moduleName).toBeDefined();
    if (moduleName === undefined) return;

    for (const digit of number) syncAction(screen.key(key('char', digit), ctx));
    const opened = syncAction(screen.key(key('enter'), ctx));
    // Opening a commentary for the first time this session always differs
    // from `ctx.lastCommentary` (`undefined`), so it is persisted
    // rather than a plain redraw — see the dedicated `lastCommentary` tests.
    expect(opened.kind).toBe('lastCommentary');
    expect(textOf(screen.view(ctx))).toContain(moduleName);
  });

  test('`esc` from a commentary entry opened via `c` goes back to the list', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    screen.view(ctx);
    syncAction(screen.key(key('char', 'c'), ctx));
    syncAction(screen.key(key('char', '1'), ctx));
    syncAction(screen.key(key('enter'), ctx));
    syncAction(screen.key(key('escape'), ctx));
    expect(textOf(screen.view(ctx))).toContain('Commentaries');
  });

  test('`t` lists topics, and a number opens that topic\'s verses', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    screen.view(ctx);

    syncAction(screen.key(key('char', 't'), ctx));
    expect(textOf(screen.view(ctx))).toContain('Topics');

    syncAction(screen.key(key('char', '0'), ctx));
    syncAction(screen.key(key('char', '1'), ctx));
    const opened = syncAction(screen.key(key('enter'), ctx));
    expect(opened.kind).toBe('redraw');
    // The topic's verses are shown in full reference form, with their text.
    const text = textOf(screen.view(ctx));
    expect(text).not.toContain('No verses under this topic');
  });

  test('`esc` from a topic\'s verses goes back to the topics list, not the hints', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    screen.view(ctx);
    syncAction(screen.key(key('char', 't'), ctx));
    syncAction(screen.key(key('char', '0'), ctx));
    syncAction(screen.key(key('char', '1'), ctx));
    syncAction(screen.key(key('enter'), ctx));
    syncAction(screen.key(key('escape'), ctx));
    expect(textOf(screen.view(ctx))).toContain('Topics');
  });

  test('typing an out-of-range number reports an error instead of crashing', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    screen.view(ctx);
    syncAction(screen.key(key('char', 'x'), ctx));
    syncAction(screen.key(key('char', '9'), ctx));
    syncAction(screen.key(key('char', '9'), ctx));
    const action = syncAction(screen.key(key('enter'), ctx));
    expect(action.kind).toBe('message');
    if (action.kind === 'message') expect(action.tone).toBe('error');
  });

  test('in study mode, `pagedown` and `↓` both scroll the list — the verse cursor is untouched', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    screen.view(ctx);
    syncAction(screen.key(key('char', 'x'), ctx));
    screen.view(ctx);

    const scrolled = syncAction(screen.key(key('pagedown'), ctx));
    expect(scrolled.kind).toBe('redraw');

    // `↓` scrolls too now (Navigation: study mode's arrows browse the
    // resource, not the verse) — it is `redraw`, not a `tab` action.
    const moved = syncAction(screen.key(key('down'), ctx));
    expect(moved.kind).toBe('redraw');
  });

  test('in study mode, `<`/`>` step the verse cursor while staying on cross references', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    screen.view(ctx);
    syncAction(screen.key(key('char', 'x'), ctx));

    const action = syncAction(screen.key(key('char', '>'), ctx));
    expect(action.kind).toBe('tab');
    if (action.kind === 'tab') {
      expect(VerseIdHelper.parse(action.tab.cursorVerse).verse).toBe(17);
    }
    // Still on cross references — a verse step within study mode does not
    // pop back to reading the way picking a cross reference does.
    const ctx2 = action.kind === 'tab' ? context(action.tab, 30, 140) : ctx;
    expect(textOf(screen.view(ctx2))).toContain('Cross-References');
  });
});

// Real filenames documented in THIRD-PARTY-NOTICES.md and docs/Design/* — see
// `app/studyPanes.test.ts`'s note on why these are structural checks rather
// than assertions about specific headwords or section titles.
const hasDictionary = hasKjv && existsSync(join(MODULES, 'dictionary_strongsgreek.db'));
const hasBook = hasKjv && existsSync(join(MODULES, 'book_finney.db'));

describe.skipIf(!hasDictionary)('the main screen — dictionaries', () => {
  test('`d` lists dictionaries, drilling into a letter and then an entry', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    screen.view(ctx);

    syncAction(screen.key(key('char', 'd'), ctx));
    expect(textOf(screen.view(ctx))).toContain('Dictionaries');

    syncAction(screen.key(key('char', '1'), ctx));
    const letters = syncAction(screen.key(key('enter'), ctx));
    expect(letters.kind).toBe('redraw');
    const letterText = textOf(screen.view(ctx));
    expect(letterText).not.toContain('No dictionary is open');

    syncAction(screen.key(key('char', '1'), ctx));
    const entries = syncAction(screen.key(key('enter'), ctx));
    expect(entries.kind).toBe('redraw');
    const entriesText = textOf(screen.view(ctx));
    expect(entriesText).not.toContain('No letter is open');

    syncAction(screen.key(key('char', '1'), ctx));
    const opened = syncAction(screen.key(key('enter'), ctx));
    expect(opened.kind).toBe('redraw');
    expect(textOf(screen.view(ctx))).not.toContain('No entry is open');
  });

  test('`esc` walks a dictionary entry back out one level at a time', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    screen.view(ctx);

    syncAction(screen.key(key('char', 'd'), ctx));
    syncAction(screen.key(key('char', '1'), ctx));
    syncAction(screen.key(key('enter'), ctx));
    syncAction(screen.key(key('char', '1'), ctx));
    syncAction(screen.key(key('enter'), ctx));
    syncAction(screen.key(key('char', '1'), ctx));
    syncAction(screen.key(key('enter'), ctx));

    // entry -> that letter's entries
    syncAction(screen.key(key('escape'), ctx));
    expect(textOf(screen.view(ctx))).not.toContain('No letter is open');
    // entries -> the letter index
    syncAction(screen.key(key('escape'), ctx));
    expect(textOf(screen.view(ctx))).not.toContain('No dictionary is open');
    // letters -> the dictionary list
    syncAction(screen.key(key('escape'), ctx));
    expect(textOf(screen.view(ctx))).toContain('Dictionaries');
    // dictionary list -> the hints
    syncAction(screen.key(key('escape'), ctx));
    expect(textOf(screen.view(ctx))).toContain('Cross-References');
  });
});

describe.skipIf(!hasBook)('the main screen — books', () => {
  test('`k` lists books, drilling into the table of contents and a section', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    screen.view(ctx);

    syncAction(screen.key(key('char', 'k'), ctx));
    expect(textOf(screen.view(ctx))).toContain('Books');

    syncAction(screen.key(key('char', '1'), ctx));
    const opened = syncAction(screen.key(key('enter'), ctx));
    expect(opened.kind).toBe('redraw');
    const tocText = textOf(screen.view(ctx));
    expect(tocText).not.toContain('No book is open');

    // Row 1 is either a leaf (opens the reading view) or a parent (opens its
    // children) — either way it must not error, and reading further must not
    // claim nothing is open.
    syncAction(screen.key(key('char', '1'), ctx));
    const picked = syncAction(screen.key(key('enter'), ctx));
    expect(picked.kind).toBe('redraw');
    const text = textOf(screen.view(ctx));
    expect(text).not.toContain('No section is open');
  });

  test('`esc` from the book list goes back to the hints', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    screen.view(ctx);
    syncAction(screen.key(key('char', 'k'), ctx));
    syncAction(screen.key(key('escape'), ctx));
    expect(textOf(screen.view(ctx))).toContain('Cross-References');
  });
});

describe.skipIf(!hasKjv)('the main screen — options', () => {
  test('`o` lists every setting, with the first one selected', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    screen.view(ctx);

    syncAction(screen.key(key('char', 'o'), ctx));
    const listed = textOf(screen.view(ctx));
    expect(listed).toContain('Options');
    expect(listed).toContain('Translation');
    expect(listed).toContain('Layout');
    expect(listed).toContain('Colour');
    expect(listed).toMatch(/▸ Translation/);
  });

  test('↑/↓ move the selected row without changing any value', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    screen.view(ctx);

    syncAction(screen.key(key('char', 'o'), ctx));
    const moved = syncAction(screen.key(key('down'), ctx));
    expect(moved.kind).toBe('redraw');
    expect(textOf(screen.view(ctx))).toMatch(/▸ Layout/);

    // Up past the top stays on the first row rather than wrapping or erroring.
    syncAction(screen.key(key('up'), ctx));
    syncAction(screen.key(key('up'), ctx));
    expect(textOf(screen.view(ctx))).toMatch(/▸ Translation/);
  });

  test('↓ to Layout (row 2), then → changes the tab’s display mode, not a global display setting', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    screen.view(ctx);

    syncAction(screen.key(key('char', 'o'), ctx));
    syncAction(screen.key(key('down'), ctx));
    const action = syncAction(screen.key(key('right'), ctx));
    expect(action.kind).toBe('tab');
    if (action.kind === 'tab') expect(action.tab.displayMode).toBe('numbered');
  });

  test('↓ to Break on verse (row 4), then → changes a global display setting', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    screen.view(ctx);

    syncAction(screen.key(key('char', 'o'), ctx));
    syncAction(screen.key(key('down'), ctx));
    syncAction(screen.key(key('down'), ctx));
    syncAction(screen.key(key('down'), ctx));
    const action = syncAction(screen.key(key('right'), ctx));
    expect(action.kind).toBe('display');
    if (action.kind === 'display') expect(action.display.breakOnVerse).toBe(true);
  });

  test('→ on Translation (row 1) returns a tab action naming the next installed Bible, wrapping round; ← steps back', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    screen.view(ctx);

    syncAction(screen.key(key('char', 'o'), ctx));
    const forward = syncAction(screen.key(key('right'), ctx));
    expect(forward.kind).toBe('tab');
    // Whatever is installed, alphabetically: with only KJV that is KJV again.
    const installed = library()
      .bibleModules()
      .map((m) => m.abbreviation.toUpperCase())
      .sort((a, b) => a.localeCompare(b));
    const expected = installed[(installed.indexOf('KJV') + 1) % installed.length];
    if (forward.kind === 'tab') expect(forward.tab.translation).toBe(expected);

    // `left` is evaluated against the same, unchanged `ctx` (still KJV) — a
    // step backward from KJV, not an undo of the step forward above.
    const back = syncAction(screen.key(key('left'), ctx));
    expect(back.kind).toBe('tab');
    const expectedBack = installed[(installed.indexOf('KJV') - 1 + installed.length) % installed.length];
    if (back.kind === 'tab') expect(back.tab.translation).toBe(expectedBack);
  });

  test('a digit does nothing — there is no numbered entry any more', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    screen.view(ctx);
    syncAction(screen.key(key('char', 'o'), ctx));
    const action = syncAction(screen.key(key('char', '9'), ctx));
    expect(action.kind).toBe('none');
  });

  test('`esc` backs out of Options to the hints', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    screen.view(ctx);
    syncAction(screen.key(key('char', 'o'), ctx));
    const back = syncAction(screen.key(key('escape'), ctx));
    expect(back.kind).toBe('redraw');
    expect(textOf(screen.view(ctx))).toContain('Cross-References');
  });
});

describe.skipIf(!hasKjv)('the main screen — bookmarks', () => {
  test('`b` with nothing saved yet, and `a` adds the cursor verse, named after its reference', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    screen.view(ctx);

    syncAction(screen.key(key('char', 'b'), ctx));
    expect(textOf(screen.view(ctx))).toContain('No bookmarks yet');

    const added = syncAction(screen.key(key('char', 'a'), ctx));
    expect(added.kind).toBe('bookmarks');
    if (added.kind !== 'bookmarks') throw new Error('expected a bookmarks action');
    expect(added.bookmarks).toHaveLength(1);
    expect(added.bookmarks[0]?.name).toBe('John 3:16');
    expect(added.bookmarks[0]?.verseId).toBe(ctx.tab.cursorVerse);

    const ctx2 = context(at(JOHN, 3, 16), 30, 140, { bookmarks: added.bookmarks });
    expect(textOf(screen.view(ctx2))).toContain('John 3:16');
  });

  test('a number and Enter jumps to that bookmark, like every other picker (a plain jump)', () => {
    const screen = new MainScreen();
    const bookmarks = [
      { id: 1, name: 'Favourite', verseId: VerseIdHelper.calculate(ROMANS, 8, 28) },
    ];
    const ctx = context(at(JOHN, 3, 16), 30, 140, { bookmarks });
    screen.view(ctx);

    syncAction(screen.key(key('char', 'b'), ctx));
    syncAction(screen.key(key('char', '1'), ctx));
    const jumped = syncAction(screen.key(key('enter'), ctx));
    expect(jumped.kind).toBe('tab');
    if (jumped.kind === 'tab') {
      expect(jumped.tab.bookNumber).toBe(ROMANS);
      expect(jumped.tab.chapter).toBe(8);
    }
  });

  test('`r` arms a rename, and the next line submitted is the new name', () => {
    const screen = new MainScreen();
    const bookmarks = [{ id: 1, name: 'Old name', verseId: 43003016 }];
    const ctx = context(at(JOHN, 3, 16), 30, 140, { bookmarks });
    screen.view(ctx);

    syncAction(screen.key(key('char', 'b'), ctx));
    syncAction(screen.key(key('char', '1'), ctx));
    const armed = syncAction(screen.key(key('char', 'r'), ctx));
    expect(armed.kind).toBe('message');

    const renamed = syncAction(
      screen.submit(classifyInput('My favourite verse', { book: JOHN, chapter: 3 }), ctx),
    );
    expect(renamed.kind).toBe('bookmarks');
    if (renamed.kind === 'bookmarks') expect(renamed.bookmarks[0]?.name).toBe('My favourite verse');
  });

  test('a rename typed as a reference is read back as that reference, not lost', () => {
    const screen = new MainScreen();
    const bookmarks = [{ id: 1, name: 'Old name', verseId: 43003016 }];
    const ctx = context(at(JOHN, 3, 16), 30, 140, { bookmarks });
    screen.view(ctx);

    syncAction(screen.key(key('char', 'b'), ctx));
    syncAction(screen.key(key('char', '1'), ctx));
    syncAction(screen.key(key('char', 'r'), ctx));

    const renamed = syncAction(screen.submit(classifyInput('romans 8:28', { book: JOHN, chapter: 3 }), ctx));
    expect(renamed.kind).toBe('bookmarks');
    if (renamed.kind === 'bookmarks') expect(renamed.bookmarks[0]?.name).toBe('Romans 8:28');
  });

  test('`p` re-points the selected bookmark at the cursor verse', () => {
    const screen = new MainScreen();
    const bookmarks = [{ id: 1, name: 'Moves with me', verseId: 43003001 }];
    const ctx = context(at(JOHN, 3, 16), 30, 140, { bookmarks });
    screen.view(ctx);

    syncAction(screen.key(key('char', 'b'), ctx));
    syncAction(screen.key(key('char', '1'), ctx));
    const repointed = syncAction(screen.key(key('char', 'p'), ctx));
    expect(repointed.kind).toBe('bookmarks');
    if (repointed.kind === 'bookmarks') {
      expect(repointed.bookmarks[0]?.verseId).toBe(ctx.tab.cursorVerse);
    }
  });

  test('`d` needs a second press before it deletes anything', () => {
    const screen = new MainScreen();
    const bookmarks = [{ id: 1, name: 'Doomed', verseId: 43003016 }];
    const ctx = context(at(JOHN, 3, 16), 30, 140, { bookmarks });
    screen.view(ctx);

    syncAction(screen.key(key('char', 'b'), ctx));
    syncAction(screen.key(key('char', '1'), ctx));
    const asked = syncAction(screen.key(key('char', 'd'), ctx));
    expect(asked.kind).toBe('message');

    // The second press needs nothing retyped — "press d again" means exactly that.
    const deleted = syncAction(screen.key(key('char', 'd'), ctx));
    expect(deleted.kind).toBe('bookmarks');
    if (deleted.kind === 'bookmarks') expect(deleted.bookmarks).toHaveLength(0);
  });

  test('typing a different number after `d` cancels the pending confirmation', () => {
    const screen = new MainScreen();
    const bookmarks = [
      { id: 1, name: 'Safe', verseId: 43003001 },
      { id: 2, name: 'Also safe', verseId: 43003002 },
    ];
    const ctx = context(at(JOHN, 3, 16), 30, 140, { bookmarks });
    screen.view(ctx);

    syncAction(screen.key(key('char', 'b'), ctx));
    syncAction(screen.key(key('char', '1'), ctx));
    syncAction(screen.key(key('char', 'd'), ctx)); // arms row 1

    syncAction(screen.key(key('char', '2'), ctx)); // buffer becomes "12" — a different target
    const asked = syncAction(screen.key(key('char', 'd'), ctx));
    // Not yet confirmed for whatever "12" resolves to — a fresh warning, not a delete.
    expect(asked.kind).toBe('message');
  });

  test('`[` and `]` reorder the selected bookmark', () => {
    const screen = new MainScreen();
    const bookmarks = [
      { id: 1, name: 'A', verseId: 1001001 },
      { id: 2, name: 'B', verseId: 1001002 },
    ];
    const ctx = context(at(JOHN, 3, 16), 30, 140, { bookmarks });
    screen.view(ctx);

    syncAction(screen.key(key('char', 'b'), ctx));
    syncAction(screen.key(key('char', '2'), ctx));
    const moved = syncAction(screen.key(key('char', '['), ctx));
    expect(moved.kind).toBe('bookmarks');
    if (moved.kind === 'bookmarks') expect(moved.bookmarks.map((b) => b.name)).toEqual(['B', 'A']);
  });

  test('acting without a bookmark number typed reports an error instead of crashing', () => {
    const screen = new MainScreen();
    const bookmarks = [{ id: 1, name: 'A', verseId: 43003016 }];
    const ctx = context(at(JOHN, 3, 16), 30, 140, { bookmarks });
    screen.view(ctx);
    syncAction(screen.key(key('char', 'b'), ctx));
    const action = syncAction(screen.key(key('char', 'r'), ctx));
    expect(action.kind).toBe('message');
    if (action.kind === 'message') expect(action.tone).toBe('error');
  });

  test('`esc` backs out of Bookmarks to the hints', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    screen.view(ctx);
    syncAction(screen.key(key('char', 'b'), ctx));
    const back = syncAction(screen.key(key('escape'), ctx));
    expect(back.kind).toBe('redraw');
    expect(textOf(screen.view(ctx))).toContain('Cross-References');
  });
});

describe.skipIf(!hasStudyModules)('the main screen — `m` persists the last commentary', () => {
  test('opening one and remembering it across a render round-trip', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    screen.view(ctx);

    const opened = syncAction(screen.key(key('char', 'm'), ctx));
    expect(opened.kind).toBe('lastCommentary');
    if (opened.kind !== 'lastCommentary') throw new Error('expected a lastCommentary action');
    const abbreviation = opened.abbreviation;
    const firstText = textOf(screen.view(ctx));
    expect(firstText).not.toContain('none opened yet');

    syncAction(screen.key(key('escape'), ctx));

    // The shell would have persisted `abbreviation` by now (`app/App.ts`);
    // the next render carries it in `ctx.lastCommentary`.
    const remembered = context(at(JOHN, 3, 16), 30, 140, { lastCommentary: abbreviation });
    const hints = textOf(screen.view(remembered));
    expect(hints).toContain('Last commentary');
    expect(hints).not.toContain('none opened yet');

    const reopened = syncAction(screen.key(key('char', 'm'), remembered));
    // Already the remembered one — nothing new to persist.
    expect(reopened.kind).toBe('redraw');
    expect(textOf(screen.view(remembered))).toBe(firstText);
  });
});

describe.skipIf(!hasStudyModules)('the main screen — `<`/`>` in a commentary entry', () => {
  // These stop short of asserting the "same passage" notice's exact wording
  // against a specific MHC entry: which verses share an entry is a fact of
  // the installed module's content, not this screen's logic. What is this
  // screen's logic — that stepping never crashes, never falls back to
  // chapter navigation, and `f` is inert with nothing pending — is asserted
  // directly.

  test('`f` does nothing when no step is being held', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    screen.view(ctx);
    syncAction(screen.key(key('char', 'm'), ctx));
    const action = syncAction(screen.key(key('char', 'f'), ctx));
    expect(action.kind).toBe('none');
  });

  test('`>` either steps the verse or holds it for confirmation — never a chapter jump', () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 16), 30, 140);
    screen.view(ctx);
    syncAction(screen.key(key('char', 'm'), ctx));

    const action = syncAction(screen.key(key('char', '>'), ctx));
    expect(['tab', 'redraw']).toContain(action.kind);
    if (action.kind === 'tab') {
      // A verse step stays in the same chapter; `moveChapter` is what would
      // cross one, and that is not what `>` means here.
      expect(action.tab.bookNumber).toBe(JOHN);
      expect(action.tab.chapter).toBe(3);
    }
  });
});

describe.skipIf(!hasKjv)('the main screen — `/` search', () => {
  test('text that is not a reference opens the search results view, and a number jumps', async () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 1), 30, 140);
    screen.view(ctx);

    const intent = classifyInput('everlasting life', { book: JOHN, chapter: 3 });
    expect(intent.kind).toBe('search');
    const opened = await screen.submit(intent, ctx);
    expect(opened.kind).toBe('redraw');

    const listed = textOf(screen.view(ctx));
    expect(listed).toContain('Search: everlasting life');
    expect(listed).toContain('John 3:16');

    syncAction(screen.key(key('char', '1'), ctx));
    const jumped = syncAction(screen.key(key('enter'), ctx));
    expect(jumped.kind).toBe('tab');

    // A plain jump, same as a cross reference or a topic's
    // verse: it returns to the hints rather than staying on the results.
    const after = jumped.kind === 'tab' ? context(jumped.tab, 30, 140) : ctx;
    expect(textOf(screen.view(after))).toContain('Cross-References (');
  });

  test('a query with no matches says so, distinctly from a rejected one', async () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 1), 30, 140);
    screen.view(ctx);

    await screen.submit(classifyInput('zzzzqqq', { book: JOHN, chapter: 3 }), ctx);
    expect(textOf(screen.view(ctx))).toContain('No verse in KJV matches');

    await screen.submit(classifyInput('faith NEAR/3 works', { book: JOHN, chapter: 3 }), ctx);
    expect(textOf(screen.view(ctx))).toContain('could not be run');
  });

  test('`esc` backs out of the results without moving', async () => {
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 1), 30, 140);
    screen.view(ctx);

    await screen.submit(classifyInput('everlasting life', { book: JOHN, chapter: 3 }), ctx);
    const back = syncAction(screen.key(key('escape'), ctx));
    expect(back.kind).toBe('redraw');
    expect(textOf(screen.view(ctx))).toContain('Cross-References (');
  });

  test('a forced search with no text does nothing, rather than searching for nothing', async () => {
    // `classifyInput('/', …)` is the shape a bare second `/` produces (the
    // escape hatch, with nothing typed after it) — `query` is `''`, `forced`
    // is `true`, and this is the one case `runSearchView`'s own guard exists
    // for, since `classifyInput('', …)` never reaches the `search` branch at
    // all (it is `'empty'`).
    const screen = new MainScreen();
    const ctx = context(at(JOHN, 3, 1), 30, 140);
    screen.view(ctx);

    const intent = classifyInput('/', { book: JOHN, chapter: 3 });
    expect(intent.kind).toBe('search');
    const action = await screen.submit(intent, ctx);
    expect(action.kind).toBe('none');
  });
});
