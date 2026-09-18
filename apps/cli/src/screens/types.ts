/**
 * The screen contract.
 *
 * Every screen is written to the same shape, and four decisions make it up:
 *
 * 1. **The shell owns the chrome.** Header, tab strip, rules, input line and
 *    footer are identical on every screen, so a screen fills a body and names its
 *    status line and its hints. It never draws a frame, and it cannot get the
 *    frame subtly wrong.
 * 2. **The shell owns the input line.** How a line is entered and what it means
 *    is a property of the application, not of a screen. Typing, editing and
 *    classification all happen once, in the shell, and a screen receives the
 *    finished {@link Intent}. A screen that wants raw keys gets the ones the
 *    input line did not claim.
 * 3. **A screen returns an action, it does not perform one.** No screen writes
 *    to `state.db`, closes a module, or calls `process.exit`. It describes what
 *    should happen and the shell does it, which is what keeps persistence in one
 *    place and makes a screen testable without a terminal.
 * 4. **Screens are a stack, and `esc` pops it.** A screen returns
 *    {@link ScreenAction} `open` to push and `close` to pop, and a screen that
 *    does not claim `esc` gets popped for free. The bottom screen has nothing
 *    underneath, so `esc` does nothing there. A screen therefore never needs to
 *    know what opened it.
 */
import type { Bookmark } from '../app/bookmarks';
import type { Intent } from '../app/input';
import type { Library } from '../app/library';
import type { SessionState, TabState } from '../app/state';
import type { Key } from '../term/keys';
import type { TerminalSize } from '../term/raw';
import type { VerseNumberStyle } from '../term/reading';
import type { ColorDepth, StyledLine, Theme } from '../term/style';

/**
 * Re-exported so screens and the shell reach one name for it.
 *
 * It is *declared* in `term/reading.ts`, beside the layout code that acts on it,
 * because that is the only place that decides what each value draws — and because
 * `term/` may not import from `screens/`. Screens only pass it along.
 */
export type { VerseNumberStyle };

/** Display settings that belong to the app rather than to one tab. */
export interface DisplaySettings {
  /** Colour the words of Christ. A display setting only; copied text is unaffected. */
  readonly redLetter: boolean;
  /** Italicise translator-supplied words, as a printed KJV does. */
  readonly showSupplied: boolean;
  readonly verseNumbers: VerseNumberStyle;
  /**
   * A blank line between every verse, on top of the module's own paragraph
   * breaks.
   *
   * Off by default because vertical space is the scarcest thing in a terminal,
   * and one blank per verse spends half the window on nothing. It is here for
   * the reader who wants to see verse boundaries without leaving prose.
   */
  readonly breakOnVerse: boolean;
  /**
   * Whether a scroll is drawn in steps or jumps straight to its destination.
   *
   * Defaults to `instant`, deliberately: stepping is the only redraw in this app
   * not caused by a keystroke, and over a slow link it turns one keypress into
   * several screenfuls of traffic. A comfort, not a default.
   */
  readonly scroll: 'stepped' | 'instant';
  /**
   * How much colour to use, or `auto` for whatever the terminal reports.
   *
   * There is one palette per depth (`createTheme`) and no light variant, so depth
   * is the setting that exists, and `none` is the one people actually reach for.
   */
  readonly colour: ColorDepth | 'auto';
}

export const DEFAULT_DISPLAY: DisplaySettings = {
  redLetter: true,
  showSupplied: true,
  verseNumbers: 'superscript',
  breakOnVerse: false,
  scroll: 'instant',
  colour: 'auto',
};

export interface ScreenContext {
  readonly size: TerminalSize;
  /** Columns available to the body, after margins. */
  readonly bodyWidth: number;
  /** Rows available to the body. */
  readonly bodyHeight: number;
  readonly theme: Theme;
  readonly library: Library;
  readonly session: SessionState;
  readonly tab: TabState;
  readonly display: DisplaySettings;
  /** What is currently typed on the input line. */
  readonly input: string;
  /** Every bookmark, in the user's own order (`b`). The shell owns
   * the list; a screen changes it with the `bookmarks` action. */
  readonly bookmarks: readonly Bookmark[];
  /**
   * The commentary `m` last opened, across the whole session — `undefined`
   * until one has been. Kept here rather than as a screen's own field so it
   * survives a restart: the shell loads it from `state.db` and a screen
   * updates it with the `lastCommentary` action, the same way `display` and
   * `bookmarks` round-trip.
   */
  readonly lastCommentary: string | undefined;
}

/**
 * A box drawn over the lower part of the body — the Modules screen uses one for
 * the detail of the selected module.
 *
 * An overlay is not a screen of its own. It belongs to the screen that returned
 * it, so the keys that drive it are that screen's keys and closing it is that
 * screen's business. What the shell contributes is the border and the placement.
 */
export interface Overlay {
  /** Rendered into the top border: `┌─ KJV — King James Version ─┐`. */
  readonly title: string;
  readonly rows: readonly StyledLine[];
}

export interface ScreenView {
  /**
   * Replaces the tab strip on the left of the header, for a screen that is not
   * a passage — `modules`, `search everlasting life`. Omit to keep the
   * tabs, which is what a screen showing a passage wants.
   */
  readonly title?: string;
  /** Right-hand side of the header, e.g. `KJV  v16/36  ¶`. */
  readonly status: string;
  /**
   * Body rows. Shorter than `bodyHeight` is fine; longer is truncated.
   *
   * **Omit it to keep the body of the screen underneath.** That lets a screen
   * sit over the one beneath, which stays visible and correct without the top
   * screen knowing anything about how it is laid out.
   */
  readonly body?: readonly StyledLine[];
  /** Footer hints, e.g. `↑↓ verse  < > chapter  s study`. */
  readonly hints: string;
  /** Rows pinned directly above the input line — the selection summary, etc. */
  readonly notice?: readonly StyledLine[];
  readonly overlay?: Overlay;
}

export type ScreenAction =
  /** Nothing happened; the key was not for this screen. */
  | { readonly kind: 'none' }
  /** Something changed that only affects what is drawn. */
  | { readonly kind: 'redraw' }
  | { readonly kind: 'quit' }
  /** Replace the active tab's state. The shell persists it. */
  | { readonly kind: 'tab'; readonly tab: TabState }
  /** Say something on the footer line until the next keystroke. */
  | { readonly kind: 'message'; readonly text: string; readonly tone?: 'info' | 'error' }
  /** Change a global display setting. The shell persists it. */
  | { readonly kind: 'display'; readonly display: DisplaySettings }
  /** Replace the bookmark list — add, rename, re-point, reorder or delete. The
   * shell persists it to `state.db` (`app/bookmarks.ts`). */
  | { readonly kind: 'bookmarks'; readonly bookmarks: readonly Bookmark[] }
  /** `m` opened a different commentary than last time. The shell persists it. */
  | { readonly kind: 'lastCommentary'; readonly abbreviation: string }
  /**
   * Put a screen on top of this one. `esc` takes it off again.
   *
   * A stack rather than a mode flag because that is the shape navigation has: a
   * menu opens a commentary, the commentary goes back to the menu, and the menu
   * goes back to the reader. Anything flatter would make each screen remember
   * where it was opened from.
   */
  | { readonly kind: 'open'; readonly screen: Screen }
  /**
   * Take this screen off the stack. Ignored by the bottom screen.
   *
   * The optional message is said on the footer on the way out, for the case
   * where closing *is* the confirmation but the user still needs a word — a
   * verified copy leaving "Copied John 3:16-17 (2 verses)" behind it.
   */
  | { readonly kind: 'close'; readonly message?: string; readonly tone?: 'info' | 'error' }
  /**
   * Close this screen and hand the one underneath a fresh tab state — how a
   * search result or a cross reference navigates the reader and gets out of the
   * way in a single keystroke.
   */
  | { readonly kind: 'closeTo'; readonly tab: TabState };

/**
 * What a screen returns from a key or a submission.
 *
 * A promise is allowed because some answers cannot be produced synchronously:
 * `BibleSearchService.search()` is `async`, and there is no synchronous entry
 * point. The shell awaits it and
 * applies the result, so a screen still just describes what should happen.
 *
 * **A synchronous return stays synchronous all the way through the shell** —
 * it is not wrapped in a resolved promise. Almost every key is a redraw, and
 * deferring those to a microtask would put a frame's latency behind the event
 * loop for no reason, as well as making every existing test asynchronous.
 */
export type ScreenResult = ScreenAction | Promise<ScreenAction>;

export interface Screen {
  /** Stable identifier, used in messages and by tests. */
  readonly name: string;
  view(ctx: ScreenContext): ScreenView;
  /** A key the input line did not claim. */
  key(key: Key, ctx: ScreenContext): ScreenResult;
  /** The input line was submitted and classified. */
  submit(intent: Intent, ctx: ScreenContext): ScreenResult;
}

/**
 * Narrow a {@link ScreenResult} that is known to be synchronous.
 *
 * Almost every key is answered synchronously; search is the exception. Tests
 * that drive a key and assert on the action need the narrowing, and doing it
 * with a cast would hide the day a screen quietly becomes asynchronous. This
 * throws instead, naming what happened.
 */
export function syncAction(result: ScreenResult): ScreenAction {
  if (result instanceof Promise) {
    throw new Error('expected a synchronous action, got a promise — await it instead');
  }
  return result;
}
