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
        {showVerseNumbers && !isPreface && <span class="verse__number-left">{verse.verse}</span>}
        <div class="verse__body">
          {followHighlight
            ? <FollowHighlightedText html={verse.text_html} verseId={verse.verse_id} highlight={followHighlight} />
            : <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(textHtml) }} />}
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
    }{followHighlight
        ? <FollowHighlightedText html={verse.text_html} verseId={verse.verse_id} highlight={followHighlight} />
        : <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(textHtml) }} />}</span>{' '}
    </>
  );
}
