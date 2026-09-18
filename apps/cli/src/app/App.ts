/**
 * The application shell.
 *
 * Owns everything a screen deliberately does not: the terminal, the input line,
 * the session, and persistence. A screen is handed a context, returns a view and
 * an action, and never touches any of the above — see `screens/types.ts` for why.
 *
 * ## Key routing, and the one mode this app has
 *
 * The input line is **opened**, not always live. `/` opens it, empty; until
 * that is pressed, every key belongs to the screen and a letter is a command.
 *
 * ```
 *   ctrl+c                        → quit, always
 *   line CLOSED
 *     /                           → open the line, empty
 *     any other key               → the screen's, and only the screen's
 *   line OPEN
 *     enter                       → classify the line, hand the screen an Intent
 *     escape                      → clear and close
 *     backspace on an empty line  → close
 *     printable                   → text, always
 *     backspace / delete / ←→     → edit the line
 *     anything else (↑↓, ^O)      → the screen's, or a global shortcut
 * ```
 *
 * ### Why a mode, when the design started without one
 *
 * The first version had one always-live line and no mode: what you typed was
 * parsed as a reference, and as a search if that failed. It is a good rule and it
 * survives untouched — see `input.ts`, which still does exactly that. What could
 * not survive was letters *also* being commands, because then `s` is either "open
 * the study pane" or the first letter of `still small voice`, and no amount of
 * cleverness makes it both.
 *
 * Unbinding every letter was tried first and is the worse trade. Book names are
 * localised, so a reserved letter is a letter some language needs — but that cuts
 * the other way too: with the line opened deliberately, book names are typed
 * *after* `/`, so no letter is reserved from any language and every letter is free
 * to be a command. It also frees the digits, which matters more than it looks:
 * `1 Corinthians` and `2 Kings` begin with one.
 *
 * The cost is one keystroke on the commonest action — `/john 3:16` rather than
 * `john 3:16` — and a mode the user has to be able to see, which is why the
 * prompt renders differently in each state rather than always showing a caret.
 *
 * ### The invariant every screen relies on
 *
 * **A screen is never offered a printable key while the line is open.** With the
 * line open those keys are text and never arrive, so a screen never needs to
 * test `ctx.input` before binding a letter or a digit.
 *
 * `/` is the one character no screen may bind, because it never reaches one.
 * (The 2026 redesign, task 0001-bible-cli, dropped the old `:` command line
 * along with the screen it only ever existed to open — see `screens/Main.ts`'s
 * docblock for the build order. `key.name === 'f1'` and the command-palette
 * `ctrl+t`/`alt+1`-`9` tab switch went with it for the same reason: tabs and
 * a command palette are both on that redesign's "remove" list. `^O`, the
 * module library, is the one global shortcut question 11 asked to keep.)
 *
 * ## The screen stack
 *
 * Screens form a stack with `MainScreen` at the bottom. Only the top one
 * receives keys and submissions. `esc` on an empty line is offered to it
 * like any other key, and **if it does not claim it the shell pops the
 * stack** — `MainScreen` is the only screen the 2026 redesign ever pushes
 * something onto (`screens/Modules.ts`, via `^O`), so in practice this is
 * "esc closes the module library".
 *
 * `view()` is called on every screen in the stack, bottom first, because a
 * screen may omit its body to keep the one underneath.
 */
import type { Bookmark } from './bookmarks';
import { classifyInput, type Intent } from './input';
import { bodyMetrics, renderFrame, type FrameMessage, type FrameTab } from './frame';
import type { Library } from './library';
import {
  cursorVerseNumber,
  DEFAULT_TAB,
  type SessionState,
  type StateStore,
  type TabState,
} from './state';
import { scrollSteps } from '../term/animate';
import { stringWidth } from '../term/layout';
import type { Key } from '../term/keys';
import { TerminalInput, type TerminalSize } from '../term/raw';
import { Screen as Renderer } from '../term/screen';
import { createTheme, type ColorDepth, type StyledLine, type Theme } from '../term/style';
import { modulesShortcut } from '../screens/Modules';
import type { Screen, ScreenAction, ScreenContext, ScreenResult } from '../screens/types';
import { DEFAULT_DISPLAY, type DisplaySettings, type VerseNumberStyle } from '../screens/types';

/** How long to wait before writing session changes back to `state.db`. */
const SAVE_DEBOUNCE_MS = 400;

/**
 * The whole stepped-scroll animation, however far it travels.
 *
 * Long enough to read as movement, short enough that a held arrow key does not
 * fall behind — and it is a ceiling, not a per-row cost. See `term/animate.ts`.
 */
const SCROLL_BUDGET_MS = 110;

/**
 * A scroll shorter than this is drawn in one go.
 *
 * A single row is not motion, it is a jump, and animating it spends two writes
 * and a timer on something the eye cannot follow anyway.
 */
const MIN_ANIMATED_ROWS = 2;

/** Where the largest window this terminal has managed is remembered. */
const LARGEST_SIZE_KEY = 'display.largestSize';

/** Where `m`'s last-opened commentary is remembered (phase 4, task thread message 05). */
const LAST_COMMENTARY_KEY = 'lastCommentary';

/**
 * How one display setting is stored, and read back.
 *
 * There used to be one `const` per setting and two hand-written lines in
 * `loadDisplay`/`apply` for each. That is a code path per setting, and with six
 * of them the ones nobody had updated were invisible — a setting could be
 * changed, redrawn correctly, and silently not survive a restart. A row in a
 * table cannot be half-added: {@link loadDisplay} and {@link saveDisplay} walk
 * the same list, so a new setting either persists both ways or neither.
 *
 * `parse` returns nothing for a value it does not recognise, so a hand-edited or
 * downgraded `state.db` falls back to the default for that one setting instead of
 * putting a nonsense value into the app.
 */
interface DisplaySetting {
  readonly key: string;
  readonly parse: (raw: string) => DisplayPatch | undefined;
  readonly format: (display: DisplaySettings) => string;
}

type DisplayPatch = Partial<{ -readonly [K in keyof DisplaySettings]: DisplaySettings[K] }>;

/** Boolean settings are stored as `1`/`0` — the shape the first two shipped in. */
function flag(key: string, field: 'redLetter' | 'showSupplied' | 'breakOnVerse'): DisplaySetting {
  return {
    key,
    parse: (raw) => (raw === '1' || raw === '0' ? { [field]: raw === '1' } : undefined),
    format: (display) => (display[field] ? '1' : '0'),
  };
}

/** A setting whose value is one of a fixed set of names, stored as that name. */
function choice<K extends keyof DisplaySettings>(
  key: string,
  field: K,
  allowed: readonly DisplaySettings[K][],
): DisplaySetting {
  return {
    key,
    parse: (raw) =>
      allowed.includes(raw as DisplaySettings[K]) ? ({ [field]: raw } as DisplayPatch) : undefined,
    format: (display) => String(display[field]),
  };
}

const VERSE_NUMBER_STYLES: readonly VerseNumberStyle[] = [
  'superscript',
  'margin',
  'inline',
  'hidden',
];

const COLOUR_CHOICES: readonly (ColorDepth | 'auto')[] = ['auto', 'ansi256', 'ansi16', 'none'];

/** Every persisted display setting. A new one is a row here and nothing else. */
const DISPLAY_SETTINGS: readonly DisplaySetting[] = [
  flag('display.redLetter', 'redLetter'),
  flag('display.showSupplied', 'showSupplied'),
  flag('display.breakOnVerse', 'breakOnVerse'),
  choice('display.verseNumbers', 'verseNumbers', VERSE_NUMBER_STYLES),
  choice('display.scroll', 'scroll', ['stepped', 'instant']),
  choice('display.colour', 'colour', COLOUR_CHOICES),
];

export interface AppOptions {
  readonly library: Library;
  readonly store: StateStore;
  readonly theme: Theme;
  readonly screen: Screen;
  /** Injected in tests. Defaults to real terminal I/O. */
  readonly renderer?: Renderer;
  readonly input?: TerminalInput;
  /** Shown on the footer until the first keystroke. */
  readonly startupMessage?: string | undefined;
  /**
   * A reference from the command line — `bible "i cor 9"`.
   *
   * Submitted at the start of {@link run}, through the same path as text typed
   * and entered, so it inherits the reader's whole `goToReference`: ranges
   * arrive selected, an unreadable passage reports itself, and the landing
   * scroll is computed against a terminal that has already been measured.
   * Doing it in the constructor instead would classify against a size nobody
   * has asked the terminal for yet.
   */
  readonly openAt?: string | undefined;
}

export class App {
  private readonly library: Library;
  private readonly store: StateStore;
  /**
   * The theme in force, which the colour setting can replace.
   *
   * Not `readonly`, because `:read`'s Colour row changes it. The one the app was
   * constructed with is kept beside it as {@link detectedTheme}, so `auto` means
   * "back to whatever the terminal reported" rather than "re-detect, and in a
   * test detect nothing".
   */
  private theme: Theme;
  /** What the terminal reported at startup, or what a test injected. */
  private readonly detectedTheme: Theme;
  /** Bottom first; only the last one gets keys. Never empty. */
  private readonly stack: Screen[];
  private readonly renderer: Renderer;
  private readonly input: TerminalInput;

  private session: SessionState;
  private display: DisplaySettings;
  /** The bookmark list (`b`, phase 4) — loaded once, changed only via the `bookmarks` action. */
  private bookmarks: readonly Bookmark[];
  /** `m`'s last-opened commentary, across the whole session — see `LAST_COMMENTARY_KEY`. */
  private lastCommentary: string | undefined;
  private line = '';
  private caret = 0;
  /**
   * Whether the input line has been opened, by `/` or by `:`.
   *
   * The app's only mode, and the reason every letter can be a command again. It
   * is held here rather than inferred from `line !== ''`, because an *open and
   * empty* line is a real state and a distinct one: it is what `/` alone leaves
   * behind, and while it lasts a keystroke is text rather than a command.
   */
  private lineOpen = false;
  private message: FrameMessage | undefined;
  private size: TerminalSize = { columns: 80, rows: 24 };
  /**
   * The largest window this terminal has ever had, restored from `state.db`.
   *
   * Grown on each axis independently, because that is the question being asked:
   * "has this terminal ever been wide enough, and has it ever been tall enough".
   * A window that was once wide and short and later narrow and tall really has
   * managed both numbers, and telling the user so is what makes the fit notice
   * actionable rather than a shrug.
   */
  private largestSize: TerminalSize;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * A stepped scroll part-way through being drawn.
   *
   * Held so the *next* keystroke can abandon it and jump to the destination.
   * Without that, a held arrow key queues animations behind each other and the
   * app feels broken — the keys are all arriving, but the screen is minutes
   * behind them.
   */
  private scrollAnimation: ScrollAnimation | undefined;
  private running = false;
  private resolveExit: (() => void) | undefined;
  private pending: Promise<void> = Promise.resolve();
  private busy = false;
  /**
   * Rows the top screen last pinned above the input line.
   *
   * `renderFrame` subtracts these from the body, so a screen told the
   * unadjusted height would lay out one row more than it is given and lose its
   * last one — silently, and only when a selection happens to be active. Held
   * here so the context handed to `key()` matches the one `view()` was drawn
   * with, rather than each screen having to subtract its own notice.
   */
  private noticeRows = 0;

  /** A command-line reference, applied once at the start of `run()`. */
  private readonly openAt: string | undefined;

  constructor(options: AppOptions) {
    this.library = options.library;
    this.store = options.store;
    this.detectedTheme = options.theme;
    this.stack = [options.screen];

    this.session = this.store.load();
    this.display = this.loadDisplay();
    this.bookmarks = this.store.loadBookmarks();
    this.lastCommentary = this.store.getValue(LAST_COMMENTARY_KEY);
    this.theme = this.themeFor(this.display.colour);
    this.largestSize = this.loadLargestSize();
    this.message =
      options.startupMessage === undefined
        ? undefined
        : { text: options.startupMessage, tone: 'info' };

    this.openAt = options.openAt;
    this.renderer = options.renderer ?? new Renderer();
    this.input =
      options.input ??
      new TerminalInput({
        onKey: (key) => this.handleKey(key),
        onResize: (size) => this.handleResize(size),
      });
  }

  /** Runs until the user quits. Resolves once the terminal has been restored. */
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;

    this.size = this.input.size();
    this.growLargestSize();
    this.renderer.start();
    this.input.start();
    if (this.openAt !== undefined) this.submitText(this.openAt);
    this.render();

    await new Promise<void>((resolve) => {
      this.resolveExit = resolve;
    });
  }

  /** Exposed for tests, which drive keys directly rather than through a TTY. */
  handleKey(key: Key): void {
    if (key.ctrl && key.name === 'char' && key.char === 'c') {
      this.quit();
      return;
    }

    // Any key abandons a scroll in progress and lands on its destination, before
    // it is routed anywhere. Held arrows therefore stay responsive: each one
    // finishes the last scroll instantly and starts its own.
    this.finishScroll();

    // Any keystroke dismisses a message; it described the result of the
    // previous one and would otherwise sit there looking current.
    this.message = undefined;

    // The one character that opens the line. Checked before anything else is
    // offered the key, and deliberately not bindable by any screen: it is the
    // only way to reach the input line, so a screen that claimed it would make
    // the app unusable from inside itself.
    if (!this.lineOpen && isTypable(key) && key.char === '/') {
      this.lineOpen = true;
      this.line = '';
      this.caret = this.line.length;
      this.render();
      return;
    }

    // `↵` submits whatever is open, including an open but empty line — that is
    // the `↵ read it` of every list screen, which answers the empty intent.
    //
    // `alt+↵` is "open in a new tab" (§4.5) and is a screen's business in either
    // state, which is why it is excluded here rather than tested by name alone.
    if (this.lineOpen && key.name === 'enter' && !key.alt) {
      this.submit();
      return;
    }

    if (this.lineOpen && this.editLine(key)) {
      this.render();
      return;
    }

    // With the line open, a printable is text and the screen never sees it. This
    // is the invariant documented at the top of this file, and it is enforced
    // here so that no screen has to enforce it itself.
    if (this.lineOpen && isTypable(key)) {
      this.insert(key.char ?? '');
      this.render();
      return;
    }

    this.resolve(this.top().key(key, this.context()), (action) => {
      // A plain `↵` with the line closed that the screen did not claim does
      // nothing. There is no line to submit, and inventing one would make `↵`
      // mean two different things depending on a state the user cannot see.

      // `esc` the screen did not want means "go back". The bottom screen has
      // nowhere to go, so it falls through and does nothing, which is what
      // pressing escape in the reader should do.
      if (action.kind === 'none' && key.name === 'escape' && this.stack.length > 1) {
        this.apply({ kind: 'close' });
        return;
      }

      // Application-wide keys, offered only after the top screen has refused.
      // `^O`, the module library, is the one the 2026 redesign kept —
      // question 11's answer, over the architecture proposal's own
      // suggestion to remove it (`screens/Main.ts`'s docblock).
      if (action.kind === 'none') {
        const global = modulesShortcut(key);
        if (global !== undefined) {
          this.apply(global);
          return;
        }
      }

      this.apply(action);
    });
  }

  /**
   * Apply a screen's answer, awaiting it only if it is a promise.
   *
   * A synchronous answer is handled synchronously — see {@link ScreenResult} for
   * why that matters. An asynchronous one is chained onto whatever is already in
   * flight, so two keys pressed while a search is running are applied in the
   * order they were pressed rather than the order the promises happen to settle.
   * A screen that throws reports it on the footer instead of taking the process
   * down: there is no caller above this to catch it.
   */
  private resolve(result: ScreenResult, then: (action: ScreenAction) => void): void {
    if (!(result instanceof Promise)) {
      then(result);
      return;
    }

    this.pending = this.pending
      .then(() => result)
      .then(then)
      .catch((error: unknown) => {
        this.message = { text: describeError(error), tone: 'error' };
        this.render();
      });
    // Waiting on a screen must never be the reason the process stays alive.
    this.busy = true;
    void this.pending.finally(() => {
      this.busy = false;
    });
  }

  /** Test hook: resolves once every in-flight screen answer has been applied. */
  async settled(): Promise<void> {
    await this.pending;
  }

  /** Whether an asynchronous answer is still being waited on. */
  isBusy(): boolean {
    return this.busy;
  }

  private handleResize(size: TerminalSize): void {
    this.size = size;
    this.growLargestSize();
    // The terminal reflows its own contents on a resize, so the previous frame
    // no longer describes what is on screen and a diff against it leaves debris.
    this.renderer.invalidate();
    this.render();
  }

  /**
   * Line editing. Returns true when the key was consumed.
   *
   * Every branch here is guarded on the line being non-empty, which is what
   * leaves `escape`, `←`, `→`, `home` and `end` available to the screen in the
   * state the user spends almost all their time in.
   */
  private editLine(key: Key): boolean {
    // `esc` abandons the line and closes it, which is the way out that does not
    // require deleting what you typed first.
    if (key.name === 'escape') {
      this.closeLine();
      return true;
    }

    switch (key.name) {
      case 'backspace':
        // Backspacing past the start closes the line rather than sitting there
        // doing nothing. It is how `/` is undone by somebody who opened it by
        // accident, and it means the line can always be dismissed by the key
        // that got them there.
        if (this.caret === 0) {
          this.closeLine();
          return true;
        }
        this.line = this.line.slice(0, this.caret - 1) + this.line.slice(this.caret);
        this.caret -= 1;
        return true;
      case 'delete':
        this.line = this.line.slice(0, this.caret) + this.line.slice(this.caret + 1);
        return true;
      case 'left':
        this.caret = Math.max(0, this.caret - 1);
        return true;
      case 'right':
        this.caret = Math.min(this.line.length, this.caret + 1);
        return true;
      case 'home':
        this.caret = 0;
        return true;
      case 'end':
        this.caret = this.line.length;
        return true;
      // `space` is a name of its own, not a `char` (keys.ts decodes it that way
      // so a screen can bind it — the copy dialog toggles a control with it).
      // It still carries its character, and to the input line it is ordinary
      // text: gating on the name alone dropped every space, so `john 3` could
      // not be typed at all.
      case 'space':
      case 'char':
        if (!isTypable(key)) return false;
        this.insert(key.char ?? '');
        return true;
      default:
        return false;
    }
  }

  private insert(char: string): void {
    this.line = this.line.slice(0, this.caret) + char + this.line.slice(this.caret);
    this.caret += char.length;
  }

  private submit(): void {
    const text = this.line;
    this.closeLine();
    this.submitText(text);
  }

  /** Empty the line and hand the keyboard back to the screen. */
  private closeLine(): void {
    this.lineOpen = false;
    this.line = '';
    this.caret = 0;
  }

  /** Exposed for tests: whether the input line is currently open. */
  isLineOpen(): boolean {
    return this.lineOpen;
  }

  /** The body of `submit`, so the command line can enter text it never typed. */
  private submitText(text: string): void {
    const tab = this.activeTab();
    const intent: Intent = classifyInput(text, {
      book: tab.bookNumber,
      chapter: tab.chapter,
    });

    this.resolve(this.top().submit(intent, this.context()), (action) => {
      this.apply(action);
    });
  }

  private apply(action: ScreenAction): void {
    switch (action.kind) {
      case 'quit':
        this.quit();
        return;
      case 'tab':
        this.replaceTab(this.beginScroll(action.tab));
        break;
      case 'session':
        this.replaceSession(action.session);
        break;
      case 'open':
        this.stack.push(action.screen);
        break;
      case 'close':
        // Guarded rather than asserted: a screen returning `close` is stating
        // that it is finished, and the bottom screen saying so is a bug in that
        // screen, not a reason to leave the user with no screen at all.
        if (this.stack.length > 1) this.stack.pop();
        if (action.message !== undefined) {
          this.message = { text: action.message, tone: action.tone ?? 'info' };
        }
        break;
      case 'closeTo':
        if (this.stack.length > 1) this.stack.pop();
        this.replaceTab(action.tab);
        break;
      case 'display': {
        const recolour = action.display.colour !== this.display.colour;
        this.display = action.display;
        this.saveDisplay(action.display);
        // Only on a change, and only then: rebuilding the theme invalidates
        // every style object the screens are holding, so the frame has to be
        // drawn from scratch rather than diffed against one in the old palette.
        if (recolour) {
          this.theme = this.themeFor(action.display.colour);
          this.renderer.invalidate();
        }
        break;
      }
      case 'message':
        this.message = { text: action.text, tone: action.tone ?? 'info' };
        break;
      case 'bookmarks':
        // Written straight through, like `growLargestSize`: bookmark edits are
        // rare, deliberate keystrokes rather than something held down, so there
        // is no per-frame cost a debounce would be protecting against.
        this.bookmarks = action.bookmarks;
        if (this.store.isOpen()) this.store.saveBookmarks(this.bookmarks);
        break;
      case 'lastCommentary':
        this.lastCommentary = action.abbreviation;
        if (this.store.isOpen()) this.store.setValue(LAST_COMMENTARY_KEY, action.abbreviation);
        break;
      case 'none':
      case 'redraw':
        break;
    }
    this.render();
  }

  /**
   * Replace the tab list, keeping the invariant the rest of the shell relies on:
   * there is always at least one tab and `activeTab` always points at one.
   * Enforced here rather than trusted from the screen, because every other
   * method reads `tabs[activeTab]` and a bad index there is a blank frame.
   */
  private replaceSession(session: SessionState): void {
    const tabs = session.tabs.length > 0 ? session.tabs : [DEFAULT_TAB];
    const activeTab = Math.min(Math.max(session.activeTab, 0), tabs.length - 1);
    this.session = { tabs, activeTab };
    this.scheduleSave();
  }

  private replaceTab(tab: TabState): void {
    const tabs = [...this.session.tabs];
    tabs[this.session.activeTab] = tab;
    this.session = { ...this.session, tabs };
    this.scheduleSave();
  }

  /**
   * Debounced rather than immediate: holding `↓` writes to `state.db` once per
   * pause rather than once per verse. The save on quit is what makes the debounce
   * safe — nothing depends on the timer having fired.
   */
  private scheduleSave(): void {
    if (this.saveTimer !== undefined) clearTimeout(this.saveTimer);
    const timer = setTimeout(() => {
      this.saveTimer = undefined;
      // The store can be closed while a save is still pending — `quit` clears
      // the timer, but nothing stops a caller closing the store directly. A
      // write to a closed connection throws from inside a timer callback, where
      // there is no caller to catch it.
      if (this.store.isOpen()) this.store.save(this.session);
    }, SAVE_DEBOUNCE_MS);
    // A pending save must never be the reason the process is still running.
    timer.unref?.();
    this.saveTimer = timer;
  }

  private flushSave(): void {
    if (this.saveTimer !== undefined) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    if (this.store.isOpen()) this.store.save(this.session);
  }

  // --- stepped scrolling -------------------------------------------------

  /**
   * Take a tab a screen has returned and, if it is a long scroll, start drawing
   * it in steps — returning the tab to apply *now* rather than the destination.
   *
   * The screens know nothing about this, which is deliberate. A screen's answer
   * to `pagedown` is "the page is now at row 40", and how that arrives on screen
   * is presentation: it belongs to the shell for the same reason the frame does.
   * The alternative — a screen returning a list of frames — would put a clock in
   * every screen that scrolls, and there are four of them.
   *
   * Anything but a pure scroll is applied whole. A tab that changed chapter or
   * reading mode is not scrolling, it is a different page, and interpolating row
   * offsets between two different layouts would draw rows from neither.
   */
  private beginScroll(next: TabState): TabState {
    const current = this.activeTab();
    if (this.display.scroll !== 'stepped') return next;
    if (!isPureScroll(current, next)) return next;
    if (Math.abs(next.scrollOffset - current.scrollOffset) < MIN_ANIMATED_ROWS) return next;

    const steps = scrollSteps(current.scrollOffset, next.scrollOffset, SCROLL_BUDGET_MS);
    // The last step *is* the destination, so it is applied by the walk rather
    // than scheduled: a list of one leaves nothing to animate.
    if (steps.length < 2) return next;

    this.scrollAnimation = { final: next, steps, index: 0, timer: undefined };
    this.scheduleScrollStep();
    return { ...next, scrollOffset: steps[0]!.offset };
  }

  private scheduleScrollStep(): void {
    const animation = this.scrollAnimation;
    if (animation === undefined) return;

    const next = animation.steps[animation.index + 1];
    if (next === undefined) {
      this.scrollAnimation = undefined;
      return;
    }

    const timer = setTimeout(() => {
      animation.index += 1;
      animation.timer = undefined;
      // Checked rather than assumed: a key that arrived in the meantime has
      // already finished this animation and replaced it, and drawing a stale
      // frame on top of that would scroll the page backwards.
      if (this.scrollAnimation !== animation) return;
      this.replaceTab({ ...animation.final, scrollOffset: next.offset });
      this.render();
      this.scheduleScrollStep();
    }, next.delayMs);
    // A half-drawn scroll must never be the reason the process stays alive.
    timer.unref?.();
    animation.timer = timer;
  }

  /** Land on the destination now, and forget the rest of the frames. */
  private finishScroll(): void {
    const animation = this.scrollAnimation;
    if (animation === undefined) return;
    if (animation.timer !== undefined) clearTimeout(animation.timer);
    this.scrollAnimation = undefined;
    this.replaceTab(animation.final);
  }

  /** Test hook: whether a stepped scroll is still being drawn. */
  isScrolling(): boolean {
    return this.scrollAnimation !== undefined;
  }

  private quit(): void {
    this.running = false;
    // Before the save, so the destination of a half-drawn scroll is what gets
    // written rather than whichever frame it had reached.
    this.finishScroll();
    this.flushSave();
    this.input.stop();
    this.renderer.stop();
    this.library.close();
    this.store.close();
    this.resolveExit?.();
    this.resolveExit = undefined;
  }

  private activeTab(): TabState {
    return this.session.tabs[this.session.activeTab] ?? this.session.tabs[0]!;
  }

  private context(noticeRows = this.noticeRows): ScreenContext {
    const { width, height } = bodyMetrics(this.size, noticeRows);
    return {
      size: this.size,
      bodyWidth: width,
      bodyHeight: height,
      theme: this.theme,
      library: this.library,
      session: this.session,
      tab: this.activeTab(),
      display: this.display,
      largestSize: this.largestSize,
      input: this.line,
      bookmarks: this.bookmarks,
      lastCommentary: this.lastCommentary,
    };
  }

  /** The screen that has the keyboard. */
  private top(): Screen {
    return this.stack[this.stack.length - 1]!;
  }

  /** Exposed for tests: the names of the open screens, bottom first. */
  screens(): string[] {
    return this.stack.map((screen) => screen.name);
  }

  /** Exposed for tests: the frame as it would be written, without a terminal. */
  frame(): { lines: string[]; cursor: { row: number; column: number } } {
    // Two passes, because the body's height depends on how many rows the screen
    // pins above the input line and that is only known once it has been asked.
    // The count is then remembered, so the second pass is skipped on every
    // frame where it has not changed — which is almost all of them.
    const probe = this.top().view(this.context());
    const rows = probe.notice?.length ?? 0;
    if (rows !== this.noticeRows) this.noticeRows = rows;

    const ctx = this.context();

    // Bottom first, so a screen that omits its body inherits the one below it.
    // Everything else comes from the top screen: it owns the header, the hints
    // and the notice, because it is the one the keyboard is talking to.
    let body: readonly StyledLine[] = [];
    for (const screen of this.stack) {
      const rendered = screen.view(ctx);
      if (rendered.body !== undefined) body = rendered.body;
    }
    const view = this.top().view(ctx);

    return renderFrame({
      size: this.size,
      theme: this.theme,
      tabs: this.tabStrip(),
      title: view.title,
      status: view.status,
      body,
      notice: view.notice,
      overlay: view.overlay,
      input: this.line,
      inputOpen: this.lineOpen,
      hints: view.hints,
      message: this.message,
    });
  }

  private render(): void {
    if (!this.renderer.isStarted()) return;
    const { lines, cursor } = this.frame();
    // The caret can sit mid-line, so the drawn cursor is placed by the *text
    // before it* rather than by the whole line's width.
    this.renderer.draw(lines, {
      row: cursor.row,
      column: this.lineOpen ? 2 + stringWidth(this.line.slice(0, this.caret)) : cursor.column,
    });
  }

  /** Tabs are named by their passage — there is nothing to name yourself (§4.5). */
  private tabStrip(): FrameTab[] {
    return this.session.tabs.map((tab, index) => ({
      label: `${this.library.bookName(tab.bookNumber)} ${tab.chapter}`,
      active: index === this.session.activeTab,
    }));
  }

  private loadDisplay(): DisplaySettings {
    let display = DEFAULT_DISPLAY;
    for (const setting of DISPLAY_SETTINGS) {
      const raw = this.store.getValue(setting.key);
      if (raw === undefined) continue;
      const patch = setting.parse(raw);
      // An unrecognised value leaves that one setting at its default. A stored
      // string is not a promise about anything: it may have been written by a
      // newer version, or by hand.
      if (patch !== undefined) display = { ...display, ...patch };
    }
    return display;
  }

  private saveDisplay(display: DisplaySettings): void {
    for (const setting of DISPLAY_SETTINGS) {
      this.store.setValue(setting.key, setting.format(display));
    }
  }

  /**
   * `auto` keeps the theme the app was built with — the detected one, or the one
   * a test injected. Any other value is an explicit request for that depth.
   */
  private themeFor(colour: DisplaySettings['colour']): Theme {
    return colour === 'auto' ? this.detectedTheme : createTheme(colour);
  }

  private loadLargestSize(): TerminalSize {
    const raw = this.store.getValue(LARGEST_SIZE_KEY) ?? '';
    const match = /^(\d+)x(\d+)$/.exec(raw.trim());
    if (match === null) return this.size;
    return { columns: Number(match[1]), rows: Number(match[2]) };
  }

  /**
   * Record the window if it is the biggest yet, on either axis.
   *
   * Written straight through rather than debounced: it changes at most once per
   * resize, and a crash between the resize and the next save is exactly the case
   * where the number is worth having.
   */
  private growLargestSize(): void {
    const columns = Math.max(this.largestSize.columns, this.size.columns);
    const rows = Math.max(this.largestSize.rows, this.size.rows);
    if (columns === this.largestSize.columns && rows === this.largestSize.rows) return;
    this.largestSize = { columns, rows };
    if (this.store.isOpen()) this.store.setValue(LARGEST_SIZE_KEY, `${columns}x${rows}`);
  }
}

/** A stepped scroll in flight. Mutable: the walk advances through it. */
interface ScrollAnimation {
  /** The tab to land on, and the one a keystroke jumps straight to. */
  readonly final: TabState;
  readonly steps: readonly { readonly offset: number; readonly delayMs: number }[];
  index: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * Whether two tab states differ only in how far down the same page they are.
 *
 * The cursor verse is allowed to move, because scrolling drags it along (see
 * `Reader.scroll`). Everything that would change the *layout* is not: a new
 * chapter, translation or reading mode means the row offsets on either side of
 * the animation count rows in different lists, and interpolating between them
 * would draw a page that never existed.
 */
function isPureScroll(current: TabState, next: TabState): boolean {
  return (
    current.bookNumber === next.bookNumber &&
    current.chapter === next.chapter &&
    current.translation === next.translation &&
    current.displayMode === next.displayMode &&
    current.preset === next.preset &&
    current.selectionAnchor === next.selectionAnchor &&
    current.scrollOffset !== next.scrollOffset
  );
}

/**
 * Whether a key is text rather than a command.
 *
 * `alt`-modified characters are commands (`alt+n`, `alt+w`), and a control
 * character is never text — typing one into the line would put a byte there
 * that no reference parser and no search index can do anything with.
 *
 * This is the whole test, and callers must not add a name check on top of it.
 * Only `char` and `space` ever carry a character (keys.ts), so this is already
 * true of exactly the unmodified printable keys; requiring `name === 'char'`
 * as well is what silently excluded the space bar.
 */
function isTypable(key: Key): boolean {
  const char = key.char;
  if (char === undefined || char === '') return false;
  if (key.ctrl || key.alt) return false;
  return char.codePointAt(0)! >= 0x20 && char !== '\x7f';
}

/** The verse the cursor is on, for callers that only have a session. */
export function activeCursorVerse(session: SessionState): number {
  const tab = session.tabs[session.activeTab] ?? session.tabs[0];
  return tab === undefined ? 1 : cursorVerseNumber(tab);
}

/**
 * A screen's failure, as a footer line.
 *
 * Screens reach real databases and a real clipboard, so "the module is gone" and
 * "the clipboard command is not installed" arrive here as exceptions. The
 * message is worth more than the class name, and the stack is worth nothing to
 * somebody reading one line above a prompt.
 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
