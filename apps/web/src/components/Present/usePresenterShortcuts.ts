import { useEffect } from 'preact/hooks';
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
 *  - **Bare up/down, off a clicker.** Plain ArrowUp/ArrowDown move the study
 *    verse shown in the Bible pane -- what stepping through a passage to
 *    decide what to send next already looks like without a session running --
 *    never the wall itself. This is safe to leave on by default (unlike the
 *    clicker layer below) because nothing the room sees moves until Send is
 *    pressed.
 *  - **Opt-in: a presentation remote/clicker.** Off-the-shelf clickers send
 *    plain Page Up/Down, plain arrow keys, and often `b` for a black screen
 *    (the PowerPoint convention, and what the old single-machine program read
 *    directly). Once accepted, those same bare arrow keys drive the wall
 *    directly instead of the study verse -- exactly one meaning for a bare
 *    arrow is active at a time -- which is why this layer is gated behind
 *    `presentStore.acceptClickerKeys` rather than always on: turning it on is
 *    a presenter saying "I have a clicker plugged in, and I accept that a
 *    stray press now moves what the room sees, not just what I'm staging."
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
  context: { hasStaged: boolean; acceptClickerKeys: boolean },
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

  // A bare up/down arrow, with no clicker accepted, moves the study verse
  // instead -- see the module doc's "bare up/down" layer. Checked before the
  // clicker layer below so the two can never both claim the same key.
  if (!context.acceptClickerKeys && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
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

export function usePresenterShortcuts(): void {
  const view = usePresenter();
  const acceptClickerKeys = useStore(presentStore, () => presentStore.acceptClickerKeys);
  const { staged } = view;

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
      const action = resolveShortcutAction(event, { hasStaged: staged !== null, acceptClickerKeys });
      if (!action) return;

      event.preventDefault();
      switch (action.type) {
        case 'send':
          if (staged) void presentStore.show(staged.item, staged.index);
          break;
        case 'next':
          void presentStore.step('next');
          break;
        case 'previous':
          void presentStore.step('previous');
          break;
        case 'toggleBlank':
          void presentStore.toggleBlank();
          break;
        case 'stepStudy':
          bibleStore.stepStudyVerse(action.direction);
          break;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view.presenting, acceptClickerKeys, staged?.item.book, staged?.item.chapter, staged?.index]);
}
