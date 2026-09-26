import { useRef } from 'preact/hooks';
import { settingsStore } from '../../stores/settingsStore';
import { useStore } from '../../hooks/useStore';
import { searchStore } from '../../stores/searchStore';
import { commentaryStore } from '../../stores/commentaryStore';
import { applyRedLetterSetting, tuckTrailingPunctuation } from '../../utils/verseHtml';
import { sanitizeHtml } from '../../utils/sanitize';
import { buildVerseInterlinearCells } from '../../utils/interlinearRows';
import { StackedInterlinear, InlineInterlinear } from './InterlinearLayouts';
import { tokenizeVerse } from '../../present/tokenize';
import { highlightSpanForVerse, sweepStep } from '../../present/highlight';
import type { HighlightRange } from '../../present/protocol';
import type { HighlightDraft } from '../../present/wordHighlight';
import type { VerseData, InterlinearWordData, StrongsEntryData, VerseFootnote } from '../../types';

interface VerseRendererProps {
  verse: VerseData;
  isHighlighted: boolean;
  isSelected?: boolean;
  /** Inside a shift-click passage selection, but not the anchor verse. */
  isInRange?: boolean;
  showVerseNumbers: boolean;
  displayMode: 'standard' | 'reading' | 'study';
  interlinearWords?: InterlinearWordData[];
  strongsEntries?: Record<string, StrongsEntryData>;
  showNotes?: boolean;
  onVerseClick: (verseId: number, extend: boolean) => void;
  onStrongsClick?: (strongsNumber: string) => void;
  onStrongsHover?: (strongsNumber: string, rect: DOMRect) => void;
  onStrongsLeave?: () => void;
  /**
   * This is the verse a follow-along session (`/present/f/<code>`) is
   * currently on -- marked the same way the projector marks its own current
   * verse, so a follower can tell at a glance where the presenter is.
   */
  isFollowLive?: boolean;
  /**
   * The presenter's own word highlight, when `isFollowLive` and they have
   * set one. Reuses the exact highlight data and word-indexing the screen
   * renders (`tokenizeVerse`/`highlightSpanForVerse`/`sweepStep`, the same
   * functions `ViewerApp.tsx`'s `VerseText` calls) rather than a second copy
   * of that logic -- see `followStore.liveVerse`.
   */
  followHighlight?: HighlightRange | null;
  /**
   * Present mode's left-rail button: send this verse to the screen. Absent
   * outside a session. `sent` is "this verse is what the wall is showing" --
   * the button then reads as a filled green check and the row turns green,
   * which wins over the study/selected tint.
   */
  sendRail?: { sent: boolean; onSend: () => void; label: string };
  /**
   * Present mode's word highlight, passed to the active verse only. Words in
   * every other verse behave exactly as they always have.
   */
  wordHighlight?: {
    draft: HighlightDraft | null;
    /** The draft is what the screen is showing right now. */
    sent: boolean;
    onHold: (index: number) => void;
    onTap: (index: number) => void;
  };
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
function PresenterWords(props: {
  html: string;
  verseId: number;
  wordHighlight: NonNullable<VerseRendererProps['wordHighlight']>;
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
function SendRailButton(props: { rail: NonNullable<VerseRendererProps['sendRail']> }) {
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
function FollowHighlightedText(props: { html: string; verseId: number; highlight: HighlightRange | null }) {
  const wordsOfChristInRed = useStore(settingsStore, () => settingsStore.wordsOfChristInRed);
  const tokens = tokenizeVerse(props.html);
  const span = highlightSpanForVerse(props.verseId, tokens.length, props.highlight);

  return (
    <>
      {tokens.map((token, index) => {
        const step = sweepStep(index, span);
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

export function VerseRenderer({
  verse,
  isHighlighted,
  isSelected,
  isInRange,
  showVerseNumbers,
  displayMode,
  interlinearWords,
  strongsEntries,
  onVerseClick,
  showNotes,
  onStrongsClick,
  onStrongsHover,
  onStrongsLeave,
  isFollowLive,
  followHighlight,
  sendRail,
  wordHighlight,
}: VerseRendererProps) {
  const wordsOfChristInRed = useStore(settingsStore, () => settingsStore.wordsOfChristInRed);
  const interlinearLayout = useStore(settingsStore, () => settingsStore.interlinearLayout);
  const isBlock = displayMode === 'standard' || displayMode === 'study';
  const isPreface = verse.verse === 0;
  const sectionHeading = verse.section_heading;

  const classList = [
    'verse',
    isHighlighted ? 'verse--study' : '',
    isSelected && !isHighlighted ? 'verse--preview' : '',
    isInRange && !isHighlighted ? 'verse--in-range' : '',
    isBlock ? 'verse--block' : '',
    isPreface ? 'verse--preface' : '',
    isFollowLive ? 'verse--follow-live' : '',
    sendRail?.sent ? 'verse--sent' : '',
  ].filter(Boolean).join(' ');

  /**
   * Click plumbing for verse selection.
   *
   * Shift-click has to suppress its own default on *mousedown*, because the
   * browser would otherwise extend the native text selection across the
   * verses — which both fights the range highlight visually and, worse,
   * leaves `window.getSelection()` non-empty, so Ctrl+C would perform a native
   * text copy instead of opening the copy dialog.
   *
   * A plain click is left completely alone, so dragging out a phrase and
   * copying just that still works exactly as before.
   */
  const handleMouseDown = (e: MouseEvent) => {
    if (e.shiftKey) e.preventDefault();
  };
  const handleClick = (e: MouseEvent) => onVerseClick(verse.verse_id, e.shiftKey);

  // Get the HTML, optionally stripping christ-words styling, and pull trailing
  // punctuation inside closing tags so it cannot wrap to a line of its own
  // (e.g. "</span>:"). Shared with the verse hover preview, which has to make
  // exactly the same two decisions about the same markup.
  let textHtml = tuckTrailingPunctuation(applyRedLetterSetting(verse.text_html, wordsOfChristInRed));

  // Strip trailing whitespace so it doesn't pick up selection border/background in reading mode
  if (!isBlock) {
    textHtml = textHtml.replace(/[\s\u00a0]+$/, '');
  }

  // Tokenised below into the word-index space the interlinear rows address —
  // taken before footnote markers are appended, so those markers cannot be
  // mistaken for words of the verse.
  const interlinearSourceHtml = textHtml;

  // Insert footnote markers into verse text for study mode
  const footnotes = verse.footnotes;
  const showFootnotes = displayMode === 'study' && showNotes && footnotes && footnotes.length > 0;
  if (showFootnotes) {
    // Assign sequential letter markers (a, b, c, ...) and insert as superscripts
    const markerLetters = footnotes.map((_f: VerseFootnote, i: number) => String.fromCharCode(97 + i));
    // Build markers to append at end of verse text (position-based insertion is fragile with HTML)
    const markerHtml = markerLetters
      .map((letter: string) => `<sup class="verse__footnote-marker">${letter}</sup>`)
      .join('');
    textHtml = textHtml.trimEnd() + markerHtml;
  }

  // Footnotes block for study mode
  const footnotesBlock = showFootnotes ? (
    <div class="verse__footnotes">
      {footnotes.map((fn: VerseFootnote, i: number) => (
        <div key={i} class="verse__footnote">
          <sup class="verse__footnote-letter">{String.fromCharCode(97 + i)}</sup>
          {' '}{fn.text}
        </div>
      ))}
    </div>
  ) : null;

  // The verse's words: the presenter's tappable words on the active verse of
  // a session, a follower's highlighted words on a follow-along tab, or plain
  // markup for everything else.
  const textBody = wordHighlight && isHighlighted
    ? <PresenterWords html={verse.text_html} verseId={verse.verse_id} wordHighlight={wordHighlight} />
    : followHighlight
      ? <FollowHighlightedText html={verse.text_html} verseId={verse.verse_id} highlight={followHighlight} />
      : <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(textHtml) }} />;

  const railEl = sendRail ? <SendRailButton rail={sendRail} /> : null;

  const headingEl = sectionHeading ? (
    <div class="verse__section-heading">{sectionHeading}</div>
  ) : null;

  if (displayMode === 'study' && interlinearWords && interlinearWords.length > 0) {
    // Fail soft (and warn) when the rows cannot be trusted against this verse's
    // own words: showing the plain verse below beats showing it with words
    // missing, duplicated, or under the wrong original-language word.
    const cells = buildVerseInterlinearCells(
      'VerseRenderer', verse.verse_id, interlinearSourceHtml, interlinearWords,
    );
    if (cells) {
      const layoutProps = { cells, strongsEntries, onStrongsClick, onStrongsHover, onStrongsLeave };
      return (
        <>
        {headingEl}
        <div class={classList} data-verse-id={verse.verse_id} onMouseDown={handleMouseDown} onClick={handleClick}>
          {railEl}
          {showVerseNumbers && !isPreface && <span class="verse__number-left">{verse.verse}</span>}
          {interlinearLayout === 'stacked'
            ? <StackedInterlinear {...layoutProps} />
            : <InlineInterlinear {...layoutProps} />}
          {footnotesBlock}
        </div>
        </>
      );
    }
  }

  if (isBlock) {
    return (
      <>
      {headingEl}
      <div class={classList} data-verse-id={verse.verse_id} onMouseDown={handleMouseDown} onClick={handleClick}>
        {railEl}
        {showVerseNumbers && !isPreface && <span class="verse__number-left">{verse.verse}</span>}
        <div class="verse__body">
          {textBody}
        </div>
        {footnotesBlock}
      </div>
      </>
    );
  }

  // Reading mode: inline
  const isParagraphStart = verse.is_paragraph_start && !isBlock;
  return (
    <>
    {headingEl}
    {isParagraphStart && <span class="verse__paragraph-break" />}
    <span class={classList} data-verse-id={verse.verse_id} onMouseDown={handleMouseDown} onClick={handleClick}>{
      showVerseNumbers && !isPreface && <sup class="verse__number">{verse.verse}</sup>
    }{textBody}</span>{' '}
    </>
  );
}
