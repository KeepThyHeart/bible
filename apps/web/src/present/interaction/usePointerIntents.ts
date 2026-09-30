/**
 * The interactive viewer's pointer layer: gestures on the passage in, intents
 * out to an `IntentSink`. See the gesture table in the design doc:
 *
 * | Gesture              | Mouse                          | Touch                          | Intent           |
 * |----------------------|--------------------------------|--------------------------------|------------------|
 * | Highlight a word     | double-click                   | double-tap                     | addHighlight     |
 * | Highlight a phrase   | double-click-drag, or drag     | long-press a word, tap the last| addHighlight     |
 * | Remove a highlight   | click it                       | tap it                         | removeHighlight  |
 * | Remove all           | X                              | (command bar)                  | clearHighlights  |
 * | Go to a verse        | click a dimmed verse           | tap a dimmed verse             | goTo             |
 *
 * The decisions are in `words.ts` and `selection.ts`; this hook only wires
 * them to events. It never changes the screen itself: whatever it sends comes
 * back as new state, the same way a button press in the presenter does, so a
 * preview and the wall cannot disagree about what a gesture did.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { HighlightRange } from '../protocol';
import type { IntentSink } from '../intentSink';
import { selectionToHighlight } from './selection';
import { rangeBetween, readTapTarget, singleWordRange, tapIntent, type WordAddress } from './words';

/** How long a word must be held to start a phrase. Same as the Study pane's `HIGHLIGHT_HOLD_MS`. */
export const HOLD_MS = 450;
/** How far a held finger may drift before it is a scroll, not a hold. */
const HOLD_SLOP_PX = 10;
/**
 * How long a single click waits to find out it was not the first half of a
 * double-click. Without the wait, double-clicking a word in a dimmed verse
 * would first move to that verse, and double-clicking a lit word would first
 * remove it.
 */
const SINGLE_CLICK_DELAY_MS = 260;
/** Two taps on the same word within this are a double-tap, whatever `detail` says. */
const DOUBLE_TAP_MS = 350;
/** After a selection is sent, the click (and double-click) that ended it are not also taps. */
const AFTER_SELECTION_MS = 400;

export interface PointerHandlers {
  onPointerDown(e: PointerEvent): void;
  onPointerMove(e: PointerEvent): void;
  onPointerUp(e: PointerEvent): void;
  onPointerCancel(): void;
  onClick(e: MouseEvent): void;
  onContextMenu(e: MouseEvent): void;
}

export interface PointerIntents {
  /** Spread onto the passage's scroll container. Null when not interactive. */
  handlers: PointerHandlers | null;
  /** The touch phrase's first word, between the long-press and the second tap. */
  draft: WordAddress | null;
}

export function usePointerIntents(
  rootRef: { current: HTMLElement | null },
  sink: IntentSink | undefined,
  highlights: HighlightRange[],
  anchor: number,
): PointerIntents {
  const [draft, setDraft] = useState<WordAddress | null>(null);

  // Read inside delayed callbacks, so a click resolved 260 ms later judges
  // against the wall as it is then, not as it was on pointer-down.
  const live = useRef({ highlights, anchor, draft, sink });
  live.current = { highlights, anchor, draft, sink };

  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdOrigin = useRef<{ x: number; y: number } | null>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swallowClick = useRef(false);
  const lastHoldAt = useRef(0);
  const ignoreClicksUntil = useRef(0);
  const lastTap = useRef<{ word: WordAddress; at: number } | null>(null);

  const stopHold = useCallback((): void => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    holdOrigin.current = null;
  }, []);
  const cancelClick = useCallback((): void => {
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = null;
  }, []);

  // A new verse or passage makes a half-made phrase meaningless.
  useEffect(() => setDraft(null), [anchor]);
  useEffect(() => () => { stopHold(); cancelClick(); }, [stopHold, cancelClick]);

  // X clears every highlight; Esc drops a half-made phrase. Only while
  // interactive -- a wall's keyboard belongs to whoever set the screen up.
  useEffect(() => {
    if (!sink) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'x' || event.key === 'X') {
        live.current.sink?.({ type: 'clearHighlights' });
        event.preventDefault();
      } else if (event.key === 'Escape' && live.current.draft) {
        setDraft(null);
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sink]);

  if (!sink) return { handlers: null, draft: null };

  const send: IntentSink = intent => live.current.sink?.(intent);

  const handlers: PointerHandlers = {
    onPointerDown(e) {
      if (!e.isPrimary || e.button !== 0) return;
      stopHold();
      // Mouse phrases come from the browser's own selection; only touch and
      // pen need the long-press.
      if (e.pointerType === 'mouse') return;
      const { word } = readTapTarget(e.target);
      if (!word) return;
      holdOrigin.current = { x: e.clientX, y: e.clientY };
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null;
        holdOrigin.current = null;
        swallowClick.current = true;
        lastHoldAt.current = Date.now();
        cancelClick();
        // Otherwise the hold leaves the native selection handles under it.
        window.getSelection()?.removeAllRanges();
        setDraft(word);
      }, HOLD_MS);
    },

    onPointerMove(e) {
      const start = holdOrigin.current;
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > HOLD_SLOP_PX) stopHold();
    },

    onPointerUp(e) {
      stopHold();
      if (e.pointerType !== 'mouse') return;
      const selection = window.getSelection();
      const root = rootRef.current;
      if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !root) return;
      // A drag-select, or the second press of a double-click (the browser has
      // already selected the word under it by now). Either way it is a
      // highlight, and the selection itself must not linger over the wall.
      const highlight = selectionToHighlight(selection.getRangeAt(0), root);
      selection.removeAllRanges();
      if (!highlight) return;
      cancelClick();
      ignoreClicksUntil.current = Date.now() + AFTER_SELECTION_MS;
      send({ type: 'addHighlight', highlight });
    },

    onPointerCancel() {
      stopHold();
    },

    onClick(e) {
      if (swallowClick.current) {
        swallowClick.current = false;
        return;
      }
      if (Date.now() < ignoreClicksUntil.current) return;
      const target = readTapTarget(e.target);

      // The second tap of the touch phrase gesture.
      const first = live.current.draft;
      if (first) {
        setDraft(null);
        if (target.word) send({ type: 'addHighlight', highlight: rangeBetween(first, target.word) });
        return;
      }

      // A double-click or double-tap on a word. `detail` covers the mouse and
      // most touch browsers; the same-word timing covers the rest.
      const previous = lastTap.current;
      const now = Date.now();
      const isDouble = target.word !== null && (
        e.detail >= 2
        || (previous !== null && now - previous.at < DOUBLE_TAP_MS
          && previous.word.verseId === target.word.verseId && previous.word.index === target.word.index)
      );
      if (isDouble && target.word) {
        cancelClick();
        lastTap.current = null;
        window.getSelection()?.removeAllRanges();
        send({ type: 'addHighlight', highlight: singleWordRange(target.word) });
        return;
      }
      lastTap.current = target.word ? { word: target.word, at: now } : null;

      cancelClick();
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null;
        const intent = tapIntent(target, live.current.highlights, live.current.anchor);
        if (intent) send(intent);
      }, SINGLE_CLICK_DELAY_MS);
    },

    onContextMenu(e) {
      // The long-press menu on a phone, which would open over the phrase.
      if (holdTimer.current || Date.now() - lastHoldAt.current < 800) e.preventDefault();
    },
  };

  return { handlers, draft };
}
