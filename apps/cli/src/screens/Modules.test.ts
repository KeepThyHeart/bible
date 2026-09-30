/**
 * The modules screen.
 *
 * Driven through injected `DiscoveredModule`s rather than a real library, for
 * the same reason `modules.test.ts` drives discovery through a fake
 * `DiscoveryEnv`: the cases that matter here are the ones a developer's disk
 * does not have — a module in a format this build cannot read, an unrecognised
 * filename, a Spanish translation, four roots contributing at once — and a test
 * that can only assert what happens to be installed asserts almost nothing.
 *
 * The screen never opens a module, so nothing here needs one to exist.
 */
import { describe, expect, test } from 'bun:test';

import { bodyMetrics } from '../app/frame';
import { classifyInput } from '../app/input';
import { Library } from '../app/library';
import { DEFAULT_TAB } from '../app/state';
import type { DiscoveredModule, ModuleType, RootKind } from '../data/modules';
import { createTheme, renderStyledLine, stripAnsi, type StyledLine } from '../term/style';
import type { Key } from '../term/keys';
import { formatBytes, Modules, moduleProblem, modulesShortcut, rootLabel } from './Modules';
import type { ScreenContext, ScreenView } from './types';
import { DEFAULT_DISPLAY } from './types';

const theme = createTheme('ansi256');

const ROOTS: Readonly<Record<RootKind, string>> = {
  override: '/custom/modules',
  cli: '/home/u/.bible/modules',
  'desktop-user': '/home/u/.config/Keep Thy Heart Bible Reader/data/modules',
  'desktop-bundled': '/opt/bible/resources/data/modules',
  repo: '/src/bible/data/modules',
};

interface Fake {
  readonly abbreviation: string;
  readonly fullName?: string;
  readonly type?: ModuleType | 'unknown';
  readonly kind?: RootKind;
  readonly language?: string;
  readonly schemaVersion?: string;
  readonly unsupported?: string;
}

function module(fake: Fake): DiscoveredModule {
  const kind = fake.kind ?? 'cli';
  return {
    path: `${ROOTS[kind]}/${fake.type ?? 'bible'}_${fake.abbreviation.toLowerCase()}.db`,
    root: { path: ROOTS[kind], kind, immutable: kind === 'desktop-bundled' },
    type: fake.type ?? 'bible',
    abbreviation: fake.abbreviation,
    fullName: fake.fullName ?? fake.abbreviation,
    language: fake.language ?? 'en',
    contentSha256: `sha-${fake.abbreviation}`,
    schemaVersion: fake.schemaVersion ?? '2.0.0',
    textDirection: undefined,
    unsupported: fake.unsupported,
  };
}

const LIBRARY: readonly DiscoveredModule[] = [
  module({ abbreviation: 'KJV', fullName: 'King James Version' }),
  module({ abbreviation: 'ASV', fullName: 'American Standard Version' }),
  module({ abbreviation: 'RVR', fullName: 'Reina-Valera', language: 'es' }),
  module({ abbreviation: 'MHC', fullName: 'Matthew Henry, Complete', type: 'commentary', kind: 'desktop-user' }),
  module({ abbreviation: 'TSK', fullName: 'Treasury of Scripture Knowledge', type: 'cross_reference', kind: 'desktop-bundled' }),
  module({
    abbreviation: 'LUTH',
    fullName: "Luther's Commentary",
    type: 'commentary',
    kind: 'desktop-user',
    schemaVersion: '3.0.0',
    unsupported: 'module format 3.0.0 is newer than this build supports (max 2.x)',
  }),
  module({ abbreviation: 'ODD', fullName: 'Something Else', type: 'unknown', kind: 'cli' }),
];

/** Every fake file is a round megabyte, so sizes are exact in the assertions. */
const sizes = (path: string): number | undefined => (path.endsWith('_odd.db') ? undefined : 1024 * 1024);

function context(
  modules: readonly DiscoveredModule[] = LIBRARY,
  input = '',
  columns = 88,
  // The screen scrolls its own body, so a test about the *whole* page asks for
  // a terminal tall enough to hold it rather than paging through it.
  rows = 24,
): ScreenContext {
  const size = { columns, rows };
  const { width, height } = bodyMetrics(size);
  return {
    size,
    bodyWidth: width,
    bodyHeight: height,
    theme,
    library: Library.open({ modules }),
    session: { tabs: [DEFAULT_TAB], activeTab: 0 },
    tab: DEFAULT_TAB,
    display: DEFAULT_DISPLAY,
    input,
    inputOpen: input.length > 0,
    bookmarks: [],
    lastCommentary: undefined,
  };
}

function screen(): Modules {
  return new Modules({ uiLanguage: 'en', fileSize: sizes });
}

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

const text = (lines: readonly StyledLine[] | undefined): string[] =>
  (lines ?? []).map((line) => stripAnsi(renderStyledLine(line, theme.depth)));

function body(view: ScreenView): string[] {
  expect(view.body).toBeDefined();
  return text(view.body);
}

/**
 * The whole page as one whitespace-normalised string.
 *
 * Prose on this screen is wrapped to the terminal, so a phrase can be split
 * across two rows with an indent between the halves. Normalising is what lets a
 * test assert the sentence rather than the wrap.
 */
function page(view: ScreenView): string {
  return body(view).join(' ').replace(/\s+/g, ' ');
}

const flat = (lines: readonly StyledLine[] | undefined): string =>
  text(lines).join(' ').replace(/\s+/g, ' ');

/** The row for one module, found by its abbreviation. */
function row(view: ScreenView, abbreviation: string): string {
  const found = body(view).find((line) => line.startsWith(abbreviation));
  expect(found).toBeDefined();
  return found ?? '';
}

describe('the list', () => {
  test('shows what was found, what kind it is, and which root it came from', () => {
    const view = screen().view(context());

    expect(row(view, 'KJV')).toContain('King James Version');
    expect(row(view, 'KJV')).toContain('Bible');
    expect(row(view, 'KJV')).toContain('1 MB');
    expect(row(view, 'KJV')).toContain('~/.bible');
    expect(row(view, 'MHC')).toContain('desktop');
    expect(row(view, 'TSK')).toContain('installed');
    expect(row(view, 'TSK')).toContain('Cross-refs');
  });

  test('the header counts what was found, where, and how much disk it takes', () => {
    const view = screen().view(context());
    // Six of the seven fakes report a megabyte; the seventh has no size.
    expect(view.status).toBe('7 found in 3 places · 6 MB');
    expect(view.title).toBe('modules');
  });

  test('a module in a newer format is listed and dimmed, never omitted', () => {
    // Omitting it would look like a missing file and send the user hunting on
    // disk for something that is already there.
    const view = screen().view(context());
    const rows = view.body ?? [];
    const luth = rows.find((line) => stripAnsi(renderStyledLine(line, theme.depth)).startsWith('LUTH'));

    expect(luth).toBeDefined();
    expect(luth?.[0]?.style).toEqual(theme.muted);
  });

  test('the reason is given, not just the dimming', () => {
    const modules = screen();
    const ctx = context();
    for (let i = 0; i < 5; i += 1) modules.key(key('down'), ctx); // LUTH is the sixth row

    const view = modules.view(ctx);
    expect(view.overlay?.title).toContain('LUTH');
    expect(flat(view.overlay?.rows)).toContain('newer than this build supports');
  });

  test('an unrecognised filename prefix is a problem in its own right', () => {
    // Not the same failure as a newer schema: nothing will ever build a
    // repository over it, whatever its schema says.
    const odd = LIBRARY.find((m) => m.abbreviation === 'ODD')!;
    expect(moduleProblem(odd)).toContain('unrecognised filename prefix');
    expect(moduleProblem(LIBRARY[0]!)).toBeUndefined();
  });

  test('a desktop module says it is read in place and is not ours to remove', () => {
    const modules = screen();
    const ctx = context();
    for (let i = 0; i < 3; i += 1) modules.key(key('down'), ctx); // MHC

    const detail = flat(modules.view(ctx).overlay?.rows);
    expect(detail).toContain('Read in place');
    expect(detail).toContain('desktop app’s job');
  });

  test('nothing drawn is wider than the body, at any width', () => {
    for (const columns of [40, 60, 88, 200]) {
      const ctx = context(LIBRARY, '', columns);
      const view = screen().view(ctx);
      for (const line of body(view)) expect(line.length).toBeLessThanOrEqual(ctx.bodyWidth);
      for (const line of text(view.overlay?.rows)) {
        expect(line.length).toBeLessThanOrEqual(ctx.bodyWidth - 4);
      }
    }
  });
});

describe('language', () => {
  test('a module in another language is tagged; the interface language is not', () => {
    const view = screen().view(context());
    expect(row(view, 'RVR')).toContain('[ES]');
    expect(row(view, 'KJV')).not.toContain('[');
  });

  test('l filters to one language, then back to all', () => {
    const modules = screen();
    const ctx = context();

    expect(modules.key(key('char', 'l'), ctx).kind).toBe('redraw');
    const english = body(modules.view(ctx));
    expect(english.some((line) => line.startsWith('KJV'))).toBe(true);
    expect(english.some((line) => line.startsWith('RVR'))).toBe(false);

    modules.key(key('char', 'l'), ctx);
    const spanish = body(modules.view(ctx));
    expect(spanish.some((line) => line.startsWith('RVR'))).toBe(true);
    expect(spanish.some((line) => line.startsWith('KJV'))).toBe(false);

    // Past the last language is "all" again, so the cycle always has a way out.
    modules.key(key('char', 'l'), ctx);
    const all = body(modules.view(ctx));
    expect(all.some((line) => line.startsWith('RVR'))).toBe(true);
    expect(all.some((line) => line.startsWith('KJV'))).toBe(true);
  });

  test('the filter says what it is hiding', () => {
    const modules = screen();
    const ctx = context();
    modules.key(key('char', 'l'), ctx);
    expect(modules.view(ctx).status).toContain('en only, 6 shown');
  });

  test('the footer names the key, so the cycle is not something to be discovered', () => {
    // A filter with no visible way in is a filter nobody finds, and this screen has
    // no menu bar: the hints line is the whole announcement.
    expect(screen().view(context()).hints).toContain('l language');
  });
});

describe('what ↵ does', () => {
  test('a translation is read here, closing the screen behind it', () => {
    const modules = screen();
    const ctx = context();
    modules.key(key('down'), ctx); // ASV

    const action = modules.submit(classifyInput('', { book: 1, chapter: 1 }), ctx);
    expect(action.kind).toBe('closeTo');
    if (action.kind !== 'closeTo') return;
    expect(action.tab.translation).toBe('ASV');
    expect(action.tab.bookNumber).toBe(DEFAULT_TAB.bookNumber);
  });

  test('a commentary explains itself rather than doing nothing', () => {
    const modules = screen();
    const ctx = context();
    for (let i = 0; i < 3; i += 1) modules.key(key('down'), ctx); // MHC

    const action = modules.submit(classifyInput('', { book: 1, chapter: 1 }), ctx);
    expect(action.kind).toBe('message');
    if (action.kind !== 'message') return;
    expect(action.text).toContain('study menu');
  });

  test('an unusable module reports why instead of being opened', () => {
    const modules = screen();
    const ctx = context();
    for (let i = 0; i < 5; i += 1) modules.key(key('down'), ctx); // LUTH

    const action = modules.submit(classifyInput('', { book: 1, chapter: 1 }), ctx);
    expect(action.kind).toBe('message');
    if (action.kind !== 'message') return;
    expect(action.tone).toBe('error');
  });

  test('the footer only offers ↵ when it would do something', () => {
    const modules = screen();
    const ctx = context();
    expect(modules.view(ctx).hints).toContain('↵ read it here');

    for (let i = 0; i < 5; i += 1) modules.key(key('down'), ctx); // LUTH, unusable
    expect(modules.view(ctx).hints).not.toContain('↵');
  });
});

describe('the repository half', () => {
  test('says it does not exist rather than offering a button that does nothing', () => {
    const shown = page(screen().view(context(LIBRARY, '', 88, 60)));
    expect(shown).toContain('REPOSITORY');
    expect(shown).toContain('deferred to 1.1');
    expect(shown).toContain('Nothing goes outbound');
    expect(shown).toContain('~/.bible/modules/');
  });

  test('r says the same thing rather than being an unbound key', () => {
    const action = screen().key(key('char', 'r'), context());
    expect(action.kind).toBe('message');
    if (action.kind !== 'message') return;
    expect(action.text).toContain('1.1');
  });

  test('is reachable by paging on a 24-row terminal, not cut off the bottom', () => {
    // The list, the search order and this note are together taller than the
    // frame, so the screen scrolls its own body rather than losing the tail.
    const modules = screen();
    const ctx = context();
    expect(page(modules.view(ctx))).not.toContain('REPOSITORY');
    expect(modules.view(ctx).hints).toContain('pgup/pgdn scroll');

    for (let i = 0; i < 4; i += 1) modules.key(key('pagedown'), ctx);
    expect(page(modules.view(ctx))).toContain('deferred to 1.1');
  });

  test('the footer does not advertise a repository', () => {
    expect(screen().view(context()).hints).not.toContain('repository');
  });
});

describe('where things come from', () => {
  test('all five roots are listed in search order, with the ones used marked', () => {
    const rendered = body(screen().view(context(LIBRARY, '', 88, 60)));
    const searched = rendered.slice(rendered.findIndex((line) => line.startsWith('SEARCHED')));

    expect(searched[1]).toContain('$BIBLE_HOME/modules');
    expect(searched[2]).toContain('~/.bible/modules');
    expect(searched[3]).toContain('<desktop userData>');
    expect(searched[4]).toContain('<desktop resources>');
    expect(searched[5]).toContain('data/modules');

    // A root that contributed shows its count and its real path; one that did
    // not just describes itself.
    expect(searched[2]).toContain('4 from /home/u/.bible/modules');
    expect(searched[1]).toContain('explicit override');
    expect(searched.join(' ')).toContain('Duplicates collapse');
  });

  test('root labels are short enough for the FROM column and distinct', () => {
    const labels = (Object.keys(ROOTS) as RootKind[]).map(rootLabel);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label.length).toBeLessThanOrEqual(10);
  });
});

describe('the ^O shortcut', () => {
  test('opens the modules screen, and claims nothing else', () => {
    const action = modulesShortcut(key('char', 'o', { ctrl: true }));
    expect(action?.kind).toBe('open');
    if (action?.kind !== 'open') return;
    expect(action.screen.name).toBe('modules');

    expect(modulesShortcut(key('char', 'o'))).toBeUndefined();
    expect(modulesShortcut(key('char', 't', { ctrl: true }))).toBeUndefined();
  });
});

describe('formatBytes', () => {
  test.each([
    [undefined, '—'],
    [0, '0 B'],
    [1024, '1 KB'],
    [1024 * 1024 * 1.8, '1.8 MB'],
    [1024 * 1024 * 632, '632 MB'],
    [1024 * 1024 * 1024 * 2.5, '2.5 GB'],
  ])('%p → %p', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe('an empty library', () => {
  test('says so rather than drawing an empty table', () => {
    const modules = new Modules({ uiLanguage: 'en', fileSize: sizes });
    const view = modules.view(context([], '', 88, 60));
    expect(view.status).toContain('0 found');
    expect(view.overlay).toBeUndefined();
    // The repository note is the useful thing on this screen when there is
    // nothing installed, so it had better still be there.
    expect(page(view)).toContain('drop its .db file into ~/.bible/modules/');
  });
});
