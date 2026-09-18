/**
 * The shell, and the key-routing rule every screen inherits.
 *
 * The rule under test: **a screen is never offered a printable key while the
 * input line is open, and gets every one of them while it is closed.** That is
 * what lets a reference be typed at all and single-letter commands still work,
 * and it is why no screen has to consult what is typed. Get it wrong in either
 * direction and the app is unusable — either you cannot type, or you cannot
 * press `q`.
 *
 * Driven through a stub screen rather than the reader, so these test the shell
 * and not the reader's key table.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { App } from './App';
import { Library } from './library';
import { DEFAULT_TAB, StateStore, type TabState } from './state';
import type { Intent } from './input';
import { decodeKeys, type Key } from '../term/keys';
import { createTheme, stripAnsi, type StyledLine } from '../term/style';
import { Screen as Renderer } from '../term/screen';
import { TerminalInput } from '../term/raw';
import { DEFAULT_DISPLAY } from '../screens/types';
import type { DisplaySettings } from '../screens/types';
import type {
  Overlay,
  Screen,
  ScreenAction,
  ScreenContext,
  ScreenView,
} from '../screens/types';

const theme = createTheme('none');
const scratch: string[] = [];
const opened: Array<{ close(): void }> = [];

afterEach(() => {
  // Close before removing. Windows refuses to delete a directory holding an
  // open SQLite handle, and these tests never call `run()`, so nothing else
  // closes the store for them.
  for (const closeable of opened.splice(0)) closeable.close();
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bible-app-'));
  scratch.push(dir);
  return dir;
}

function openStore(dir: string): StateStore {
  const { store } = StateStore.open(dir);
  opened.push(store);
  return store;
}

/** Records what it was asked, and answers however the test tells it to. */
class StubScreen implements Screen {
  readonly name = 'stub';
  readonly keys: Key[] = [];
  readonly intents: Intent[] = [];
  answer: (key: Key) => ScreenAction = () => ({ kind: 'none' });
  onSubmit: (intent: Intent) => ScreenAction = () => ({ kind: 'none' });
  lastContext: ScreenContext | undefined;

  view(ctx: ScreenContext): ScreenView {
    this.lastContext = ctx;
    return { status: 'STUB', body: [[{ text: 'body' }]], hints: 'hints' };
  }

  key(key: Key, ctx: ScreenContext): ScreenAction {
    this.lastContext = ctx;
    this.keys.push(key);
    return this.answer(key);
  }

  submit(intent: Intent, ctx: ScreenContext): ScreenAction {
    this.lastContext = ctx;
    this.intents.push(intent);
    return this.onSubmit(intent);
  }
}

/**
 * A renderer and an input that touch no terminal.
 *
 * `run()` is the only way to reach the command-line reference — it is applied
 * after the terminal has been measured, deliberately — so a test of it has to
 * start the shell. Without these it starts the *real* one: the suite scribbles
 * escape sequences over the reporter and then blocks on a stdin nobody types
 * into. Keys still arrive through `handleKey`, which is how every other test
 * here drives the app, so the fake input only has to exist and report a size.
 */
function silentIo() {
  const stdin = {
    setRawMode: () => undefined,
    setEncoding: () => undefined,
    resume: () => undefined,
    pause: () => undefined,
    on: () => undefined,
    off: () => undefined,
    isTTY: true,
  };
  const size = { columns: 80, rows: 24 };
  return {
    renderer: new Renderer({ out: { write: () => undefined }, measure: () => size }),
    input: new TerminalInput({
      onKey: () => undefined,
      input: stdin,
      measure: () => size,
      onResizeSource: () => () => undefined,
    }),
  };
}

function app(overrides: { screen?: StubScreen; dir?: string; openAt?: string } = {}) {
  const screen = overrides.screen ?? new StubScreen();
  const store = openStore(overrides.dir ?? home());
  const library = Library.open({ modules: [] });
  opened.push(library);
  const options = { library, store, theme, screen, ...silentIo() };
  return {
    app: new App(overrides.openAt === undefined ? options : { ...options, openAt: overrides.openAt }),
    screen,
    store,
  };
}

function char(c: string, mods: Partial<Key> = {}): Key {
  return { name: 'char', ctrl: false, alt: false, shift: false, sequence: c, char: c, ...mods };
}

/**
 * Type a string the way a terminal delivers it.
 *
 * `char()` hand-builds a key, and for the space bar that is a *fiction*: the
 * real decoder names it `space`, not `char`. A test that spelled its own keys
 * asserted `john 3:16` typed correctly while the running app dropped every
 * space. Anything about what typing produces goes through the decoder.
 */
function typeKeys(instance: App, text: string): void {
  for (const key of decodeKeys(text).keys) instance.handleKey(key);
}

/**
 * Open the input line the way a user does, then type into it.
 *
 * The line is closed until `/` is pressed, so almost every test about typing has
 * to open it first. Going through the real keystroke rather than reaching for a
 * setter is the point: the opening is part of the contract being tested.
 */
function openAndType(instance: App, text: string): void {
  instance.handleKey(char('/'));
  typeKeys(instance, text);
}

function named(name: Key['name'], mods: Partial<Key> = {}): Key {
  return { name, ctrl: false, alt: false, shift: false, sequence: '', ...mods };
}

function typed(instance: App): string {
  const line = instance.frame().lines.map(stripAnsi).find((l) => l.startsWith('> '));
  return line === undefined ? '' : line.slice(2);
}

describe('the input line, which is opened rather than always live', () => {
  test('a printable key does nothing at all until the line is opened', () => {
    // The whole point of the mode. With the line closed a letter is a command,
    // and an unbound one is simply unbound -- it is not silently collected into
    // a line the user cannot see.
    const { app: a } = app();
    typeKeys(a, 'john');
    expect(a.isLineOpen()).toBe(false);
    expect(typed(a)).toBe('');
  });

  test('slash opens the line, and what follows is text', () => {
    const { app: a } = app();
    openAndType(a, 'john 3:16');
    expect(a.isLineOpen()).toBe(true);
    expect(typed(a)).toBe('john 3:16');
  });

  test('the slash itself is not typed into the line it opens', () => {
    const { app: a } = app();
    a.handleKey(char('/'));
    expect(typed(a)).toBe('');
  });

  test('the opening key is never offered to a screen', () => {
    // It is the only route to the input line, so a screen that claimed it
    // would make the app unusable from inside itself.
    const { app: a, screen } = app();
    a.handleKey(char('/'));
    a.handleKey(named('escape'));
    a.handleKey(char('/'));
    expect(screen.keys.some((k) => k.char === '/')).toBe(false);
  });

  test('a screen is never offered a printable while the line is open', () => {
    // The invariant every screen leans on. It is what lets the copy dialog bind
    // `1`-`4` and the reader bind `g` without either of them checking anything.
    const screen = new StubScreen();
    screen.answer = () => ({ kind: 'message', text: 'claimed' });
    const { app: a } = app({ screen });

    a.handleKey(char('/'));
    const before = screen.keys.length;
    typeKeys(a, 'genesis 1');
    expect(screen.keys.length).toBe(before);
    expect(typed(a)).toBe('genesis 1');
  });

  test('the space bar reaches the line, from a real decoded keystroke', () => {
    // keys.ts gives space a name of its own so a screen can bind it (the copy
    // dialog does). Both insert paths gated on `name === 'char'`, so a space
    // matched neither and `john 3` was untypable.
    const { app: a } = app();
    const [space] = decodeKeys(' ').keys;
    expect(space?.name).toBe('space');

    openAndType(a, 'john');
    a.handleKey(space!);
    expect(typed(a)).toBe('john ');
  });

  test('backspace deletes, and closes the line at the start of it', () => {
    const { app: a } = app();
    openAndType(a, 'abc');
    a.handleKey(named('backspace'));
    expect(typed(a)).toBe('ab');

    a.handleKey(named('backspace'));
    a.handleKey(named('backspace'));
    expect(typed(a)).toBe('');
    expect(a.isLineOpen()).toBe(true);

    // One more, at the start: the line goes rather than sitting there empty.
    a.handleKey(named('backspace'));
    expect(a.isLineOpen()).toBe(false);
  });

  test('backspace with the line closed belongs to the screen', () => {
    const { app: a, screen } = app();
    a.handleKey(named('backspace'));
    expect(screen.keys.map((k) => k.name)).toContain('backspace');
  });

  test('the caret can be moved and text inserted in the middle', () => {
    const { app: a } = app();
    openAndType(a, 'john316');
    a.handleKey(named('left'));
    a.handleKey(named('left'));
    typeKeys(a, ':');
    expect(typed(a)).toBe('john3:16');
  });

  test('escape abandons the line without the screen seeing it', () => {
    const { app: a, screen } = app();
    openAndType(a, 'abc');
    a.handleKey(named('escape'));
    expect(typed(a)).toBe('');
    expect(a.isLineOpen()).toBe(false);
    expect(screen.keys.some((k) => k.name === 'escape')).toBe(false);

    // Closed, so the next one is the screen's -- which is how `esc back` works.
    a.handleKey(named('escape'));
    expect(screen.keys.some((k) => k.name === 'escape')).toBe(true);
  });

  test('enter hands the screen a classified intent and closes the line', () => {
    const { app: a, screen } = app();
    openAndType(a, '3:16');
    a.handleKey(named('enter'));

    expect(typed(a)).toBe('');
    expect(a.isLineOpen()).toBe(false);
    expect(screen.intents).toHaveLength(1);
    expect(screen.intents[0]!.kind).toBe('reference');
  });

  test('free text becomes a search intent, not a reference', () => {
    const { app: a, screen } = app();
    openAndType(a, 'everlasting life');
    a.handleKey(named('enter'));
    expect(screen.intents[0]!.kind).toBe('search');
  });

  test('a second slash forces a search for words that parse as a reference', () => {
    // The escape hatch. `/` opens the line and a leading `/` inside it still
    // means "search", so `//genesis 1` looks for the words rather than going to
    // the book. No new syntax was needed for it.
    const { app: a, screen } = app();
    openAndType(a, '/genesis 1');
    a.handleKey(named('enter'));
    const intent = screen.intents[0]!;
    expect(intent.kind).toBe('search');
    if (intent.kind !== 'search') return;
    expect(intent.forced).toBe(true);
  });

  test('enter with the line closed goes to the screen and submits nothing', () => {
    // The reader binds it to "study this verse". It must not also mean "submit",
    // or one key would do two things depending on a state nobody can see.
    const { app: a, screen } = app();
    a.handleKey(named('enter'));
    expect(screen.keys.map((k) => k.name)).toContain('enter');
    expect(screen.intents).toHaveLength(0);
  });

  test('arrows and function keys stay with the screen while the line is open', () => {
    // So the command palette can be steered with the arrows while its filter is
    // being typed, which is the whole way that screen works.
    const screen = new StubScreen();
    screen.answer = () => ({ kind: 'redraw' });
    const { app: a } = app({ screen });

    openAndType(a, 'v');
    a.handleKey(named('down'));
    a.handleKey(named('f1'));
    expect(screen.keys.map((k) => k.name)).toContain('down');
    expect(screen.keys.map((k) => k.name)).toContain('f1');
  });

  test('the prompt says how to open the line while it is closed', () => {
    // A mode the user cannot see is a trap, and this row is the only place the
    // opening key is guaranteed to appear.
    const { app: a } = app();
    const closed = a.frame().lines.map(stripAnsi).join('\n');
    expect(closed).toContain('/ go to or search');

    a.handleKey(char('/'));
    const open = a.frame().lines.map(stripAnsi).join('\n');
    expect(open).not.toContain('/ go to or search');
  });
});

describe('the command line reference', () => {
  test('`bible "i cor 9"` reaches the screen as a reference intent', async () => {
    // The argument used to be parsed for flags and then dropped: `startup()`
    // took no reference at all, so every `bible <passage>` opened wherever the
    // last session had left off, silently.
    const screen = new StubScreen();
    const { app: a } = app({ screen, openAt: 'i cor 9' });

    const run = a.run();
    expect(screen.intents).toHaveLength(1);
    expect(screen.intents[0]!.kind).toBe('reference');
    const intent = screen.intents[0]!;
    if (intent.kind !== 'reference') throw new Error('expected a reference');
    expect(intent.reference.book).toBe(46);
    expect(intent.reference.chapter).toBe(9);

    a.handleKey(char('c', { ctrl: true }));
    await run;
  });

  test('text that is not a reference is submitted as a search', async () => {
    const screen = new StubScreen();
    const { app: a } = app({ screen, openAt: 'everlasting life' });

    const run = a.run();
    expect(screen.intents[0]!.kind).toBe('search');

    a.handleKey(char('c', { ctrl: true }));
    await run;
  });

  test('no argument submits nothing, and opens where it left off', async () => {
    const screen = new StubScreen();
    const { app: a } = app({ screen });

    const run = a.run();
    expect(screen.intents).toHaveLength(0);

    a.handleKey(char('c', { ctrl: true }));
    await run;
  });
});

describe('key routing', () => {
  test('with the line closed every key belongs to the screen', () => {
    const screen = new StubScreen();
    screen.answer = (key) => (key.char === 'q' ? { kind: 'quit' } : { kind: 'none' });
    const { app: a } = app({ screen });

    a.handleKey(char('s'));
    // Offered, and declined, and that is the end of it. Nothing is typed, because
    // there is no line to type into until `/` opens one.
    expect(screen.keys.some((k) => k.char === 's')).toBe(true);
    expect(typed(a)).toBe('');
  });

  test('a letter a screen claims is a command, whatever word it starts', () => {
    // `g` is the case that drove the change: it used to fire the reader's "first
    // verse" while somebody was typing Genesis. Genesis is typed after `/` now,
    // so `g` is free to be a command and is no longer ambiguous.
    const screen = new StubScreen();
    const seen: string[] = [];
    screen.answer = (key) => {
      if (key.char !== undefined) seen.push(key.char);
      return { kind: 'redraw' };
    };
    const { app: a } = app({ screen });

    typeKeys(a, 'gsyq');
    expect(seen).toEqual(['g', 's', 'y', 'q']);
    expect(typed(a)).toBe('');
  });

  test('ctrl+c quits from anywhere, typed line or not', () => {
    const { app: a, screen } = app();
    for (const c of 'abc') a.handleKey(char(c));
    a.handleKey(char('c', { ctrl: true }));
    expect(screen.keys.some((k) => k.ctrl)).toBe(false);
  });

  test('a control character is never typed into the line', () => {
    // A byte no reference parser and no search index can do anything with.
    const { app: a } = app();
    a.handleKey(char('\x01', { ctrl: true }));
    expect(typed(a)).toBe('');
  });

  test('alt-modified keys are commands, not text', () => {
    const { app: a } = app();
    a.handleKey(char('n', { alt: true }));
    expect(typed(a)).toBe('');
  });
});

describe('actions', () => {
  test('a tab action replaces the active tab', () => {
    const screen = new StubScreen();
    const { app: a } = app({ screen });

    a.handleKey(named('down')); // once, to capture the current tab
    const tab = { ...screen.lastContext!.tab, chapter: 9 };
    screen.answer = () => ({ kind: 'tab', tab });
    a.handleKey(named('down'));

    // `frame()` is the test hook for "what would be drawn now"; nothing renders
    // without a terminal, so the context the screen last saw comes from here.
    a.frame();
    expect(screen.lastContext?.tab.chapter).toBe(9);
  });

  test('a display action is persisted, so `w` survives a relaunch', () => {
    const dir = home();
    const first = app({ screen: new StubScreen(), dir });
    first.screen.answer = () => ({
      kind: 'display',
      display: { ...DEFAULT_DISPLAY, redLetter: false },
    });
    first.app.handleKey(named('down'));
    first.app.frame();
    expect(first.screen.lastContext?.display.redLetter).toBe(false);
    first.store.close();

    // A second App over the same directory is what a relaunch looks like.
    const second = app({ screen: new StubScreen(), dir });
    second.app.frame();
    expect(second.screen.lastContext?.display.redLetter).toBe(false);
  });

  test('a bookmarks action is persisted, so the list survives a relaunch', () => {
    const dir = home();
    const first = app({ screen: new StubScreen(), dir });
    const bookmarks = [{ id: 1, name: 'So loved', verseId: 43003016 }];
    first.screen.answer = () => ({ kind: 'bookmarks', bookmarks });
    first.app.handleKey(named('down'));
    first.app.frame();
    expect(first.screen.lastContext?.bookmarks).toEqual(bookmarks);
    first.store.close();

    const second = app({ screen: new StubScreen(), dir });
    second.app.frame();
    expect(second.screen.lastContext?.bookmarks).toEqual(bookmarks);
  });

  test('a lastCommentary action is persisted, so `m` reopens the same one next time', () => {
    const dir = home();
    const first = app({ screen: new StubScreen(), dir });
    first.screen.answer = () => ({ kind: 'lastCommentary', abbreviation: 'MHC' });
    first.app.handleKey(named('down'));
    first.app.frame();
    expect(first.screen.lastContext?.lastCommentary).toBe('MHC');
    first.store.close();

    const second = app({ screen: new StubScreen(), dir });
    second.app.frame();
    expect(second.screen.lastContext?.lastCommentary).toBe('MHC');
  });

  test('a message shows on the footer and is dismissed by the next key', () => {
    const screen = new StubScreen();
    const { app: a } = app({ screen });

    screen.answer = () => ({ kind: 'message', text: 'Nothing to copy.' });
    a.handleKey(named('down'));
    expect(a.frame().lines.map(stripAnsi).join('\n')).toContain('Nothing to copy.');

    screen.answer = () => ({ kind: 'none' });
    a.handleKey(named('down'));
    // It described the result of the previous keystroke; leaving it up makes it
    // look like it describes this one.
    expect(a.frame().lines.map(stripAnsi).join('\n')).not.toContain('Nothing to copy.');
  });
});

describe('the frame', () => {
  test('the screen is given the body size, not the terminal size', () => {
    const { app: a, screen } = app();
    a.frame();
    const ctx = screen.lastContext!;
    expect(ctx.bodyHeight).toBeLessThan(ctx.size.rows);
    expect(ctx.bodyWidth).toBeLessThanOrEqual(ctx.size.columns);
  });

  test('tabs are named by their passage, with no name to invent (§4.5)', () => {
    const { app: a } = app();
    // No modules, so book names come from the fixed canon: tab 1 is Genesis 1.
    expect(stripAnsi(a.frame().lines[0]!)).toContain('Genesis 1');
  });
});

/**
 * Wave 4 — the screen stack.
 *
 * These are the shell mechanics every screen after the reader is written to, so
 * they are pinned here rather than discovered separately by each of them.
 */
class Pushed implements Screen {
  constructor(
    readonly name: string,
    private readonly opts: {
      body?: readonly StyledLine[];
      title?: string;
      overlay?: Overlay;
      answer?: (key: Key) => ScreenAction;
    } = {},
  ) {}

  view(): ScreenView {
    return {
      status: this.name.toUpperCase(),
      hints: 'esc back',
      ...(this.opts.body === undefined ? {} : { body: this.opts.body }),
      ...(this.opts.title === undefined ? {} : { title: this.opts.title }),
      ...(this.opts.overlay === undefined ? {} : { overlay: this.opts.overlay }),
    };
  }

  key(key: Key): ScreenAction {
    return this.opts.answer?.(key) ?? { kind: 'none' };
  }

  submit(): ScreenAction {
    return { kind: 'none' };
  }
}

describe('the screen stack', () => {
  test('a screen opens on top and takes the keyboard', () => {
    const { app: a, screen } = app();
    const pushed = new Pushed('pushed');
    screen.answer = () => ({ kind: 'open', screen: pushed });

    a.handleKey(char('s'));
    expect(a.screens()).toEqual(['stub', 'pushed']);

    const before = screen.keys.length;
    a.handleKey(named('down'));
    // The screen underneath is no longer being typed at.
    expect(screen.keys.length).toBe(before);
  });

  test('esc pops it, and the reader keeps esc for itself', () => {
    const { app: a, screen } = app();
    // Only `s` opens: a stub that answered every key with `open` would push a
    // second screen on the escape that is supposed to land on the bottom one.
    screen.answer = (key) =>
      key.char === 's' ? { kind: 'open', screen: new Pushed('pushed') } : { kind: 'none' };
    a.handleKey(char('s'));

    a.handleKey(named('escape'));
    expect(a.screens()).toEqual(['stub']);

    // Nothing underneath: escape falls through and the app stays put rather
    // than closing the only screen there is.
    a.handleKey(named('escape'));
    expect(a.screens()).toEqual(['stub']);
  });

  test('a screen that claims esc keeps it', () => {
    const { app: a, screen } = app();
    screen.answer = () => ({
      kind: 'open',
      screen: new Pushed('modal', { answer: () => ({ kind: 'redraw' }) }),
    });
    a.handleKey(char('s'));
    a.handleKey(named('escape'));
    expect(a.screens()).toEqual(['stub', 'modal']);
  });

  test('closeTo pops and navigates in one keystroke', () => {
    const { app: a, screen } = app();
    const destination = { ...DEFAULT_TAB, bookNumber: 43, chapter: 3, cursorVerse: 43003016 };
    screen.answer = () => ({
      kind: 'open',
      screen: new Pushed('results', { answer: () => ({ kind: 'closeTo', tab: destination }) }),
    });

    // One key to push, one to close, and both ordinary letters: `/` and `:` never
    // reach a screen, so neither can be used to drive a stub.
    a.handleKey(char('s'));
    a.handleKey(char('x'));

    expect(a.screens()).toEqual(['stub']);
    a.frame();
    expect(screen.lastContext!.tab.cursorVerse).toBe(43003016);
  });

  test('a screen omitting its body keeps the one underneath', () => {
    const { app: a, screen } = app();
    screen.answer = () => ({
      kind: 'open',
      screen: new Pushed('palette', {
        overlay: { title: 'COMMANDS', rows: [[{ text: ':q  quit' }]] },
      }),
    });

    // A letter, not `:`. The colon opens the input line and is never offered to
    // a screen, so it cannot be what pushes the stub palette here.
    a.handleKey(char('p'));
    const frame = a.frame().lines.map(stripAnsi).join('\n');
    // The stub's body is still there, with the palette drawn over the bottom.
    expect(frame).toContain('body');
    expect(frame).toContain('COMMANDS');
    expect(frame).toContain(':q  quit');
  });

  test('a title replaces the tab strip, and only for the screen that sets one', () => {
    const { app: a, screen } = app();
    screen.answer = () => ({
      kind: 'open',
      screen: new Pushed('results', { title: 'search everlasting life', body: [] }),
    });

    a.handleKey(char('x'));
    expect(stripAnsi(a.frame().lines[0]!)).toContain('search everlasting life');
    expect(stripAnsi(a.frame().lines[0]!)).not.toContain('Genesis 1');

    a.handleKey(named('escape'));
    expect(stripAnsi(a.frame().lines[0]!)).toContain('Genesis 1');
  });
});

describe('display settings are a table, not a code path per setting', () => {
  test('every one of them survives a relaunch', () => {
    // The point of the table in `App.ts` is that a setting cannot be half-added:
    // the load and the save walk the same list. So this asserts on all of them at
    // once rather than on the one that was most recently written.
    const dir = home();
    const changed: DisplaySettings = {
      redLetter: false,
      showSupplied: false,
      verseNumbers: 'inline',
      breakOnVerse: true,
      scroll: 'stepped',
      colour: 'ansi16',
    };

    const first = app({ screen: new StubScreen(), dir });
    first.screen.answer = () => ({ kind: 'display', display: changed });
    first.app.handleKey(named('down'));
    first.app.frame();
    first.store.close();

    const again = app({ screen: new StubScreen(), dir });
    again.app.frame();
    expect(again.screen.lastContext?.display).toEqual(changed);
  });

  test('a stored value this build does not know leaves that one setting alone', () => {
    // A `state.db` written by a newer version, or edited by hand. One unusable
    // value must not take the other five with it.
    const dir = home();
    const store = openStore(dir);
    store.setValue('display.verseNumbers', 'sideways');
    store.setValue('display.redLetter', '0');
    store.close();

    const { app: restarted, screen } = app({ screen: new StubScreen(), dir });
    restarted.frame();
    expect(screen.lastContext?.display.verseNumbers).toBe(DEFAULT_DISPLAY.verseNumbers);
    expect(screen.lastContext?.display.redLetter).toBe(false);
  });

  test('changing the colour setting changes the theme the screens are handed', () => {
    const { app: shell, screen } = app({ screen: new StubScreen() });
    shell.frame();
    const before = screen.lastContext?.theme.depth;

    screen.answer = () => ({
      kind: 'display',
      display: { ...DEFAULT_DISPLAY, colour: 'ansi256' },
    });
    shell.handleKey(named('down'));
    shell.frame();

    // These tests inject a colourless theme, so the interesting direction is
    // upwards: an explicit depth replaces whatever the app was built with.
    expect(before).toBe('none');
    expect(screen.lastContext?.theme.depth).toBe('ansi256');
  });
});

describe('the largest window this terminal has managed', () => {
  test('it is remembered across sessions, and grows on each axis', () => {
    // Fullscreen is not detectable, so what the window *has* been is the only
    // honest way to tell somebody their page will fit if they make it bigger.
    const dir = home();
    const store = openStore(dir);
    store.setValue('display.largestSize', '200x60');
    store.close();

    const { app: shell, screen } = app({ screen: new StubScreen(), dir });
    shell.frame();
    expect(screen.lastContext?.largestSize).toEqual({ columns: 200, rows: 60 });
  });

  test('an unreadable value falls back to the window rather than to nonsense', () => {
    const dir = home();
    const store = openStore(dir);
    store.setValue('display.largestSize', 'enormous');
    store.close();

    const { app: shell, screen } = app({ screen: new StubScreen(), dir });
    shell.frame();
    // The current size: never larger than the window has been, which is the one
    // thing the caller needs to be able to rely on.
    expect(screen.lastContext?.largestSize.columns).toBeGreaterThan(0);
  });
});

describe('stepped scrolling', () => {
  /** A tab differing from the default only in how far down the page it is. */
  const scrolledTo = (offset: number): TabState => ({ ...DEFAULT_TAB, scrollOffset: offset });

  test('a long scroll is drawn in steps rather than in one jump', () => {
    const { app: shell, screen } = app({ screen: new StubScreen() });
    screen.answer = () => ({
      kind: 'display',
      display: { ...DEFAULT_DISPLAY, scroll: 'stepped' },
    });
    shell.handleKey(named('down'));

    screen.answer = () => ({ kind: 'tab', tab: scrolledTo(40) });
    shell.handleKey(named('pagedown'));
    shell.frame();

    // Part-way there, and still going.
    expect(shell.isScrolling()).toBe(true);
    const offset = screen.lastContext?.tab.scrollOffset ?? 0;
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThan(40);
  });

  test('the next keystroke lands on the destination instead of queueing', () => {
    // Without this a held arrow key stacks animations behind each other: the
    // keys are all arriving and the screen is a long way behind them.
    const { app: shell, screen } = app({ screen: new StubScreen() });
    screen.answer = () => ({
      kind: 'display',
      display: { ...DEFAULT_DISPLAY, scroll: 'stepped' },
    });
    shell.handleKey(named('down'));

    screen.answer = () => ({ kind: 'tab', tab: scrolledTo(40) });
    shell.handleKey(named('pagedown'));
    expect(shell.isScrolling()).toBe(true);

    screen.answer = () => ({ kind: 'none' });
    shell.handleKey(named('down'));
    shell.frame();

    expect(shell.isScrolling()).toBe(false);
    expect(screen.lastContext?.tab.scrollOffset).toBe(40);
  });

  test('the default is instant, so nothing is animated unasked', () => {
    const { app: shell, screen } = app({ screen: new StubScreen() });
    screen.answer = () => ({ kind: 'tab', tab: scrolledTo(40) });
    shell.handleKey(named('pagedown'));
    shell.frame();

    expect(shell.isScrolling()).toBe(false);
    expect(screen.lastContext?.tab.scrollOffset).toBe(40);
  });

  test('a one-row nudge is not motion, and is not animated', () => {
    const { app: shell, screen } = app({ screen: new StubScreen() });
    screen.answer = () => ({
      kind: 'display',
      display: { ...DEFAULT_DISPLAY, scroll: 'stepped' },
    });
    shell.handleKey(named('down'));

    screen.answer = () => ({ kind: 'tab', tab: scrolledTo(1) });
    shell.handleKey(named('down'));
    expect(shell.isScrolling()).toBe(false);
  });

  test('a change of chapter is applied whole, not interpolated', () => {
    // Row offsets on either side of the animation would be counting rows in two
    // different layouts, and interpolating between them draws a page that never
    // existed.
    const { app: shell, screen } = app({ screen: new StubScreen() });
    screen.answer = () => ({
      kind: 'display',
      display: { ...DEFAULT_DISPLAY, scroll: 'stepped' },
    });
    shell.handleKey(named('down'));

    screen.answer = () => ({
      kind: 'tab',
      tab: { ...DEFAULT_TAB, chapter: 9, scrollOffset: 40 },
    });
    shell.handleKey(named('right'));
    shell.frame();

    expect(shell.isScrolling()).toBe(false);
    expect(screen.lastContext?.tab.scrollOffset).toBe(40);
  });
});
