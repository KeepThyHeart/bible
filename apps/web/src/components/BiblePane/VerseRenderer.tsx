import { settingsStore } from '../../stores/settingsStore';
import { useStore } from '../../hooks/useStore';
import { searchStore } from '../../stores/searchStore';
import { commentaryStore } from '../../stores/commentaryStore';
import { applyRedLetterSetting, tuckTrailingPunctuation } from '../../utils/verseHtml';
import { sanitizeHtml } from '../../utils/sanitize';
import { buildVerseInterlinearCells } from '../../utils/interlinearRows';
import { StackedInterlinear, InlineInterlinear } from './InterlinearLayouts';
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
          <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(textHtml) }} />
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
    }<span dangerouslySetInnerHTML={{ __html: sanitizeHtml(textHtml) }} /></span>{' '}
    </>
  );
}
