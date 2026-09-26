import { useEffect, useRef } from 'preact/hooks';
import { sectionTarget } from '../../present/sections';
import { useStore } from '../../hooks/useStore';
import { bibleStore } from '../../stores/bibleStore';
import { presentStore } from '../../stores/presentStore';
import { usePresenter } from './usePresenter';

/**
 * The presenter's global keyboard, active while a session is running no
 * matter which tab or pane is on screen -- the strip, the panel, or (once the
 * controls live in the Study pane) the Present tab itself.
 *
 * Three layers:
 *
 *  - **Always on, always with a modifier.** Alt+Enter sends what is staged,
 *    Alt+Left/Right steps, Ctrl+Enter blanks. A bare key belongs to the
 *    reader underneath, so every one of these carries a modifier without
 *    exception -- the moment a session starts must not quietly repurpose a
 *    key the reader was already using.
 *  - **Bare keys, on by default: the clicker layer.** Off-the-shelf clickers
 *    send plain Page Up/Down, plain arrow keys, and often `b` for a black
 *    screen (the PowerPoint convention, and what the old single-machine
 *    program read directly). A bare Up/Down or Right/Left -- from a clicker or
 *    a keyboard, no difference -- means the same thing everywhere: on a hymn
 *    or a quote it advances the slide, on a passage it advances the verse. A
 *    **long press** on a passage advances by section instead (see
 *    `present/sections.ts`), which is the only gesture that tells the two
 *    apart. The Bible pane follows the wall's verse, so what the presenter
 *    reads and what the room sees stay in step. With nothing on the wall yet
 *    there is nothing to advance, so bare Up/Down move the study verse
 *    instead -- looking ahead to decide what to send first. A presenter can
 *    opt out (`presentStore.acceptClickerKeys`), which leaves bare Up/Down
 *    as study-verse-only, as they were before.
 *
 * Typing anywhere (a search box, a note, a paste-references textarea) is
 * exempt from every layer.
 */

/** Keys held down mid-service must not reach the reader underneath. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export type ShortcutAction =
  | { type: 'send' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'toggleBlank' }
  | { type: 'stepStudy'; direction: 'next' | 'previous' };

/**
 * Pure key-to-action mapping, so the whole decision -- modifiers, the
 * clicker gate, which key means what -- is exercised directly rather than
 * only through a rendered component and a fake keyboard event.
 *
 * Returns `null` for a key this hook has no opinion about, which the caller
 * takes as "let the event through unchanged".
 */
export function resolveShortcutAction(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey' | 'repeat'>,
  context: { hasStaged: boolean; acceptClickerKeys: boolean; hasLive?: boolean },
): ShortcutAction | null {
  if (event.repeat) return null;

  if (event.ctrlKey && !event.altKey && !event.metaKey && event.key === 'Enter') {
    return { type: 'toggleBlank' };
  }

  if (event.altKey && !event.ctrlKey && !event.metaKey) {
    if (event.key === 'Enter') return context.hasStaged ? { type: 'send' } : null;
    if (event.key === 'ArrowRight') return { type: 'next' };
    if (event.key === 'ArrowLeft') return { type: 'previous' };
    return null;
  }

  // A bare up/down arrow moves the study verse instead of the wall when the
  // wall has nothing to move (`hasLive` false) or the clicker layer is opted
  // out of -- see the module doc. Checked before the clicker layer below so
  // the two can never both claim the same key.
  if (!event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey
    && (!context.acceptClickerKeys || context.hasLive === false)) {
    if (event.key === 'ArrowUp') return { type: 'stepStudy', direction: 'previous' };
    if (event.key === 'ArrowDown') return { type: 'stepStudy', direction: 'next' };
  }

  // Everything past here is a bare key, so it only ever fires once a
  // presenter has explicitly said a clicker is in play.
  if (!context.acceptClickerKeys) return null;
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return null;

  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
    case 'PageDown':
      return { type: 'next' };
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
      return { type: 'previous' };
    case 'b':
    case 'B':
    case '.':
      return { type: 'toggleBlank' };
    default:
      return null;
  }
}

/** How long a bare key is held before it counts as a long press, in ms. */
export const LONG_PRESS_MS = 500;

/**
 * After the wall moved within a passage, bring the Bible pane along: the
 * verse the presenter reads is the verse the room sees. Only when the pane is
 * on that same chapter -- a presenter who wandered off to look at something
 * else is not yanked back by a clicker press.
 */
export function followWallInPane(): void {
  const wall = presentStore.wall;
  const live = wall?.live;
  const tab = bibleStore.getActiveTab();
  if (!wall || !tab || live?.kind !== 'passage') return;
  if (tab.book !== live.book || tab.chapter !== live.chapter) return;
  bibleStore.focusVerseNumber(wall.position.index);
}

/** Step the wall one place, and take the Bible pane with it. */
export function stepWall(direction: 'next' | 'previous'): void {
  // `step` predicts synchronously before its first await, so the pane can
  // move at once; it moves again on the authoritative answer in case they
  // differed.
  const done = presentStore.step(direction);
  followWallInPane();
  void done.then(followWallInPane);
}

/**
 * A long press: on a passage, jump to the next/previous section rather than
 * the next verse. Falls back to a single verse step when the Bible pane is
 * not on the passage on the wall, because sections are read from the pane's
 * loaded chapter and there is nothing to read them from otherwise.
 */
export function stepWallBySection(direction: 'next' | 'previous'): void {
  const wall = presentStore.wall;
  const live = wall?.live;
  if (!wall || live?.kind !== 'passage') return;
  const tab = bibleStore.getActiveTab();
  if (!tab || tab.book !== live.book || tab.chapter !== live.chapter || tab.verses.length === 0) {
    stepWall(direction);
    return;
  }
  const target = sectionTarget(tab.verses, wall.position.index, direction);
  const done = presentStore.goTo(target);
  followWallInPane();
  void done.then(followWallInPane);
}

export function usePresenterShortcuts(): void {
  const view = usePresenter();
  const acceptClickerKeys = useStore(presentStore, () => presentStore.acceptClickerKeys);
  const { staged } = view;

  // A bare next/previous key held on a passage: undecided until it is
  // released (a plain press: one verse) or held long enough (a long press:
  // one section, once, however long it is then held). A ref rather than a
  // local of the effect below, because that effect re-subscribes whenever the
  // staged verse changes -- which a long press itself causes, by moving the
  // pane -- and must not forget a key that is still down.
  const pendingRef = useRef<{
    key: string; direction: 'next' | 'previous'; timer: ReturnType<typeof setTimeout>; fired: boolean;
  } | null>(null);
  const cancelPending = (): void => {
    if (pendingRef.current) clearTimeout(pendingRef.current.timer);
    pendingRef.current = null;
  };
  useEffect(() => {
    if (!view.presenting) cancelPending();
  }, [view.presenting]);
  useEffect(() => cancelPending, []);

  useEffect(() => {
    if (!view.presenting) return;

    const onKey = (event: KeyboardEvent): void => {
      if (isTyping(event.target)) return;
      // This listener is on `window`, the last stop a bubbling keydown makes,
      // so a more specific handler closer to the focused element -- a
      // dropdown's own arrow-key navigation, a dialog's -- has already run.
      // Its `preventDefault()` is this hook's cue to stand down rather than
      // also acting on the same press (moving the study verse while someone
      // is arrowing through, say, the translation picker).
      if (event.defaultPrevented) return;
      // Auto-repeat of a key that is mid long-press: neither scroll the page
      // with it nor start over.
      if (event.repeat && pendingRef.current?.key === event.key) {
        event.preventDefault();
        return;
      }
      const wall = presentStore.wall;
      const action = resolveShortcutAction(event, {
        hasStaged: staged !== null,
        acceptClickerKeys,
        hasLive: Boolean(wall?.live),
      });
      if (!action) return;

      event.preventDefault();

      const bare = !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
      if (bare && (action.type === 'next' || action.type === 'previous') && wall?.live?.kind === 'passage') {
        cancelPending();
        const direction = action.type;
        const press = {
          key: event.key,
          direction,
          fired: false,
          timer: setTimeout(() => {
            press.fired = true;
            stepWallBySection(direction);
          }, LONG_PRESS_MS),
        };
        pendingRef.current = press;
        return;
      }

      switch (action.type) {
        case 'send':
          if (staged) void presentStore.show(staged.item, staged.index);
          break;
        case 'next':
          stepWall('next');
          break;
        case 'previous':
          stepWall('previous');
          break;
        case 'toggleBlank':
          void presentStore.toggleBlank();
          break;
        case 'stepStudy':
          bibleStore.stepStudyVerse(action.direction);
          break;
      }
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      const pending = pendingRef.current;
      if (!pending || pending.key !== event.key) return;
      const { fired, direction } = pending;
      cancelPending();
      if (!fired) stepWall(direction);
    };

    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    // Focus lost mid-press means the release will never arrive here.
    window.addEventListener('blur', cancelPending);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', cancelPending);
    };
  }, [view.presenting, acceptClickerKeys, staged?.item.book, staged?.item.chapter, staged?.index]);
}
