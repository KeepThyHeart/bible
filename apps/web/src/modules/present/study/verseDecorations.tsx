/**
 * The Presenter's marks in the Study reader, moved out of `VerseRenderer`
 * (task 0123) and delivered through the host's `verseDecorators` slot:
 * the send rail, the presenter's tappable words on the active verse, and a
 * follower's highlighted words. Rendering is unchanged.
 */
import { useRef } from 'preact/hooks';
import { useStore } from '../../../hooks/useStore';
import { settingsStore } from '../../../stores/settingsStore';
import { tokenizeVerse } from '../lib/tokenize';
import { highlightSpansForVerse, spanContaining, sweepStep } from '../lib/highlight';
import type { HighlightRange } from '../lib/protocol';
import type { HighlightDraft } from '../lib/wordHighlight';

/** Present mode's left-rail button: send this verse to the screen. `sent`: the wall shows it. */
export interface SendRailProps {
  sent: boolean;
  onSend: () => void;
  label: string;
}

/** Present mode's word highlight on the active verse. */
export interface WordHighlightProps {
  draft: HighlightDraft | null;
  /** The draft is what the screen is showing right now. */
  sent: boolean;
  onHold: (index: number) => void;
  onTap: (index: number) => void;
}

/** How long a word must be held to start a highlight, in ms. */
export const HIGHLIGHT_HOLD_MS = 450;
/** How far a held pointer may drift before it is a scroll or drag, not a hold. */
const HOLD_SLOP_PX = 10;

/**
 * The active verse's words, tokenized (like `FollowHighlightedText`) so the
 * presenter can address them by index, with the "tap the ends" gesture:
 *
 *  - A **press-and-hold** on a word starts a one-word highlight. The hold is
 *    what tells this apart from an ordinary tap on the verse, which keeps
 *    doing what it always did.
 *  - With a highlight in place, a plain **tap** on another word stretches (or
 *    trims) it, and a tap on the highlighted words clears it.
 *
 * The click that ends a hold, and any tap while a highlight exists, is
 * swallowed in the capture phase so it cannot also reach the verse's own click
 * handler, which would deselect the very verse being highlighted.
 */
export function PresenterWords(props: {
  html: string;
  verseId: number;
  wordHighlight: WordHighlightProps;
}) {
  const wordsOfChristInRed = useStore(settingsStore, () => settingsStore.wordsOfChristInRed);
  const tokens = tokenizeVerse(props.html);
  const { draft, sent, onHold, onTap } = props.wordHighlight;
  const mine = draft && draft.verseId === props.verseId ? draft : null;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const swallowClick = useRef(false);
  const lastHoldAt = useRef(0);

  const wordIndex = (target: EventTarget | null): number | null => {
    const el = (target as HTMLElement | null)?.closest?.('[data-w]');
    if (!el) return null;
    const n = Number(el.getAttribute('data-w'));
    return Number.isInteger(n) ? n : null;
  };
  const stopTimer = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !e.isPrimary) return;
    const index = wordIndex(e.target);
    if (index === null) return;
    stopTimer();
    origin.current = { x: e.clientX, y: e.clientY };
    timer.current = setTimeout(() => {
      timer.current = null;
      origin.current = null;
      swallowClick.current = true;
      lastHoldAt.current = Date.now();
      // The hold would otherwise leave a native text selection (or, on a
      // phone, the selection handles) sitting under the highlight.
      window.getSelection()?.removeAllRanges();
      onHold(index);
    }, HIGHLIGHT_HOLD_MS);
  };
  const onPointerMove = (e: PointerEvent): void => {
    const start = origin.current;
    if (!start) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > HOLD_SLOP_PX) stopTimer();
  };
  const onClickCapture = (e: MouseEvent): void => {
    if (swallowClick.current) {
      swallowClick.current = false;
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    if (!mine) return;
    const index = wordIndex(e.target);
    if (index === null) return;
    e.stopPropagation();
    e.preventDefault();
    onTap(index);
  };
  const onContextMenu = (e: MouseEvent): void => {
    if (timer.current || Date.now() - lastHoldAt.current < 800) e.preventDefault();
  };

  return (
    <span
      class="verse__pwords"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopTimer}
      onPointerCancel={stopTimer}
      onPointerLeave={stopTimer}
      onClickCapture={onClickCapture}
      onContextMenu={onContextMenu}
    >
      {tokens.map((token, index) => {
        const classes = ['verse__follow-word', 'verse__pword'];
        if (token.isChristWords && wordsOfChristInRed) classes.push('verse__follow-word--christ');
        if (token.isDivineName) classes.push('verse__follow-word--divine');
        if (token.isItalic) classes.push('verse__follow-word--supplied');
        if (mine && index >= mine.start && index <= mine.end) {
          classes.push(sent ? 'verse__pword--sent' : 'verse__pword--draft');
        }
        return (
          <span key={index} class={classes.join(' ')} data-w={index}>
            {token.displayText}
            {token.hasTrailingSpace ? ' ' : ''}
          </span>
        );
      })}
    </span>
  );
}

/** The monitor glyph the wireframe drew, so the rail matches what was approved. */
export function SendRailButton(props: { rail: SendRailProps }) {
  const { sent, onSend, label } = props.rail;
  return (
    <button
      type="button"
      class={`verse__send${sent ? ' verse__send--sent' : ''}`}
      aria-label={label}
      title={label}
      aria-pressed={sent}
      // The rail lives inside the clickable verse; pressing it must not also
      // select (or, on the selected verse, deselect) the verse.
      onMouseDown={e => e.stopPropagation()}
      onClick={e => {
        e.stopPropagation();
        if (!sent) onSend();
      }}
    >
      {sent ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12l5 5L20 6" /></svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="5" width="19" height="12.5" rx="2" /><path d="M8.5 21h7" /><path d="M12 17.5v3.5" /></svg>
      )}
    </button>
  );
}

/**
 * `verse.text_html`, tokenized and re-rendered word by word so a highlight
 * can address individual words by index -- the same rendering `ViewerApp`'s
 * `VerseText` produces for the screen, so a follower sees exactly the phrase
 * the presenter lit, not an approximation of it.
 *
 * Deliberately tokenizes the *raw* `verse.text_html`, not `textHtml` below
 * (which has red-letter and punctuation-tucking applied): the presenter's
 * word indices were computed from the same raw text this reader also has, and
 * running them through this reader's own local transforms first risks a
 * subtly different token count or order -- the one thing that would light up
 * the wrong words.
 */
export function FollowHighlightedText(props: { html: string; verseId: number; highlights: HighlightRange[] }) {
  const wordsOfChristInRed = useStore(settingsStore, () => settingsStore.wordsOfChristInRed);
  const tokens = tokenizeVerse(props.html);
  const spans = highlightSpansForVerse(props.verseId, tokens.length, props.highlights);

  return (
    <>
      {tokens.map((token, index) => {
        const step = sweepStep(index, spanContaining(index, spans));
        const classes = ['verse__follow-word'];
        if (token.isChristWords && wordsOfChristInRed) classes.push('verse__follow-word--christ');
        if (token.isDivineName) classes.push('verse__follow-word--divine');
        if (token.isItalic) classes.push('verse__follow-word--supplied');
        if (step >= 0) classes.push('verse__follow-word--hl');

        return (
          <span
            key={index}
            class={classes.join(' ')}
            style={step >= 0 ? { '--follow-sweep': String(step) } as unknown as preact.JSX.CSSProperties : undefined}
          >
            {token.displayText}
            {token.hasTrailingSpace ? ' ' : ''}
          </span>
        );
      })}
    </>
  );
}
