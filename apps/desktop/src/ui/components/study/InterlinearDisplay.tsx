import React, { useState, useEffect, useMemo } from 'react';
import { stripOsisTags, truncateAtWordBoundary, UserTextMarkup } from '@bible/core';
import { dictionaryAPI } from '../../services/electronAPI';
import { useI18n } from '../../contexts/useI18n';
import { usePopupPosition } from '../../hooks/usePopupPosition';
import { useHoverIntent } from '../../hooks/useHoverIntent';
import { useHighlightStore } from '../../stores/useHighlightStore';
import { useSearchStore } from '../../stores/useSearchStore';
import { extractWordsWithFormatting, type WordInfo } from '../../utils/wordIndexing';
import { highlightAttrsForWord, HighlightedVerse } from '../highlights/HighlightRenderer';
import {
  buildInterlinearCells,
  cellsPartitionWordSpace,
  type InterlinearCell,
  type InterlinearWord,
} from './interlinearCells';

export type { InterlinearWord };

/** Hover state shared by both layouts' Strong's preview tooltip. */
interface HoveredStrongs {
  strongsNumber: string;
  position: { x: number; y: number };
}

/** Fixed popup width, matching the previous hand-rolled positioning. */
const STRONGS_TOOLTIP_WIDTH = 280;
/**
 * First-paint height estimate for synchronous placement (see
 * `usePopupPosition`) - header + part-of-speech + glosses + a short
 * description, plus the "search all occurrences" action row. Refined
 * post-mount if the real content differs materially.
 */
const STRONGS_ESTIMATED_HEIGHT = 200;

interface InterlinearDisplayProps {
  interlinearWords: InterlinearWord[];
  /**
   * The verse's display HTML - pass `verse.text_html` where it exists, so the
   * word sequence derived from it is byte-for-byte the one Standard/Reading
   * mode index highlights against. Raw `verse.text` with OSIS tags still works;
   * it is normalised the same way `formatVerseText()` normalises it.
   */
  englishText: string;
  layout: 'stacked' | 'inline';
  onStrongsClick?: (strongsNumber: string) => void;
  /** Verse being rendered. Required: highlights are stored per verse. */
  verseId: number;
  /** Owning module. Required: highlights are stored per module. */
  moduleId: number;
}

/** Stable empty array so the store selector below doesn't churn renders. */
const EMPTY_HIGHLIGHTS: UserTextMarkup[] = [];

/**
 * Verses already reported as violating the cell partition postcondition, so a
 * malformed module logs once instead of once per render.
 */
const partitionFailuresLogged = new Set<number>();

/** Fields the tooltip needs from a Strong's dictionary entry. */
interface StrongsPreviewEntry {
  word?: string;
  definition: string;
  transliteration?: string;
  pronunciation?: string;
  part_of_speech?: string;
}

/**
 * Cached Strong's definitions to avoid redundant IPC calls
 */
const strongsDefinitionCache = new Map<string, StrongsPreviewEntry | null>();

/**
 * Parse a Strong's definition field, which typically packs everything into one
 * blob: `"1722 ἐν ejn en {en} \n a primary preposition... "in," at, by:--about, after..."`.
 *
 * Ported from `apps/web/src/components/Dialogs/StrongsTooltip.tsx` so both
 * clients extract the same structured description/gloss fields instead of
 * hard-truncating the raw blob - header boilerplate included - at 200 chars.
 */
function parseStrongsDefinition(raw: string): { glosses: string; description: string } {
  const plain = raw.replace(/<[^>]*>/g, '');

  // The ":--" separator typically divides the description from the gloss list.
  const glossSep = plain.indexOf(':--');
  if (glossSep >= 0) {
    const descPart = plain.substring(0, glossSep).trim();
    const glossPart = plain.substring(glossSep + 3).trim();

    // Strip the leading "NUMBER WORD translit {pron}" prefix, which duplicates
    // info already shown in the tooltip header.
    const cleanDesc = descPart
      .replace(/^\d+\s+\S+\s+\S+\s+\S+\s*\{[^}]*\}\s*\n?\s*/i, '')
      .replace(/^\s*\n\s*/, '')
      .trim();

    // Remove trailing "see GREEK for..." cross-references and extra whitespace.
    const cleanGloss = glossPart
      .replace(/\s*see (?:GREEK|HEBREW) for \d+\s*/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\.\s*$/, '');

    return { glosses: cleanGloss, description: cleanDesc };
  }

  // No ":--" separator - just return the cleaned definition.
  const cleaned = plain
    .replace(/^\d+\s+\S+\s+\S+\s+\S+\s*\{[^}]*\}\s*\n?\s*/i, '')
    .replace(/\s*see (?:GREEK|HEBREW) for \d+\s*/gi, '')
    .trim();
  return { glosses: '', description: cleaned };
}

/** How much of the parsed gloss list the hover tooltip shows. */
const GLOSS_PREVIEW_LENGTH = 120;

/** How much of the parsed description the hover tooltip shows. */
const DESCRIPTION_PREVIEW_LENGTH = 200;

/**
 * Lightweight tooltip that shows a Strong's definition preview on hover
 */
const StrongsPreviewTooltip: React.FC<{
  strongsNumber: string;
  position: { x: number; y: number };
  onClose: () => void;
  onMouseEnter?: () => void;
}> = ({ strongsNumber, position, onClose, onMouseEnter }) => {
  const { t } = useI18n();
  // Subscribed rather than read via getState(): this is render-time wiring for
  // an action the tooltip owns, and the selector keeps the reference stable.
  const searchStrongsNumber = useSearchStore((state) => state.searchStrongsNumber);
  const [loading, setLoading] = useState(true);
  const [definition, setDefinition] = useState<StrongsPreviewEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { ref: tooltipRef, style: popupStyle } = usePopupPosition(position, {
    width: STRONGS_TOOLTIP_WIDTH,
    estimatedHeight: STRONGS_ESTIMATED_HEIGHT,
  });

  useEffect(() => {
    let cancelled = false;

    const fetchDefinition = async () => {
      // Check cache first
      if (strongsDefinitionCache.has(strongsNumber)) {
        const cached = strongsDefinitionCache.get(strongsNumber)!;
        if (!cancelled) {
          setDefinition(cached);
          setLoading(false);
        }
        return;
      }

      try {
        setLoading(true);
        const isGreek = strongsNumber.startsWith('G');
        const targetAbbr = isGreek ? 'StrongsGreek' : 'StrongsHebrew';

        // Convert Strong's number to entry key format: "G281" -> "00281"
        const numericPart = strongsNumber.slice(1);
        const entryKey = numericPart.padStart(5, '0');

        const entry = await dictionaryAPI.getEntryByKey(targetAbbr, entryKey);

        if (!cancelled) {
          if (entry) {
            const result: StrongsPreviewEntry = {
              word: entry.word,
              definition: entry.definition,
              transliteration: entry.transliteration,
              pronunciation: entry.pronunciation,
              part_of_speech: entry.part_of_speech
            };
            strongsDefinitionCache.set(strongsNumber, result);
            setDefinition(result);
          } else {
            strongsDefinitionCache.set(strongsNumber, null);
            setDefinition(null);
          }
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError('Dictionary not available');
          setLoading(false);
        }
      }
    };

    fetchDefinition();

    return () => {
      cancelled = true;
    };
  }, [strongsNumber]);

  // Structured fields for the definition body. Only computed once an entry is
  // present; the budgets below apply to the description and the gloss list
  // separately, not to the raw blob (header boilerplate + description + glosses
  // all mixed together), so each goes toward real content.
  //
  // The gloss list needs a budget of its own: it is a handful of words for most
  // entries but runs to 564 characters for `G1722` (ἐν) and 765 at worst, and a
  // hover tooltip that tall covers the verse the reader is hovering over.
  let glosses = '';
  let shortDescription = '';
  let transliteration: string | undefined;
  let pronunciation = '';
  let partOfSpeech: string | undefined;

  if (definition) {
    const parsed = parseStrongsDefinition(definition.definition);
    glosses = truncateAtWordBoundary(parsed.glosses, GLOSS_PREVIEW_LENGTH).text;
    shortDescription = truncateAtWordBoundary(parsed.description, DESCRIPTION_PREVIEW_LENGTH).text;

    transliteration = definition.transliteration;
    pronunciation = definition.pronunciation ?? '';
    if (!transliteration) {
      // Fall back to extracting "NUMBER GREEK translit {pron}" from the raw
      // definition when the dictionary repository didn't populate the field.
      const match = definition.definition.match(/^\d+\s+\S+\s+(\S+)\s+(\S+)\s*\{([^}]*)\}/);
      if (match) {
        transliteration = match[1];
        if (!pronunciation) pronunciation = match[3];
      }
    }

    partOfSpeech = definition.part_of_speech;
    if (!partOfSpeech && parsed.description) {
      // Common patterns: "a primary preposition", "a prolonged form of a primary verb"
      const posMatch = parsed.description.match(/^(?:a |an )?(?:primary |prolonged |middle )?\w+(?:\s+\w+)?\b/i);
      if (posMatch && posMatch[0].length < 50) {
        partOfSpeech = posMatch[0];
      }
    }
  }

  return (
    <div
      ref={tooltipRef}
      className="z-50 bg-surface-elevated border border-border-secondary rounded-lg shadow-xl p-3"
      style={popupStyle}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onClose}
    >
      {loading ? (
        <div className="text-text-secondary text-sm">{t('ui.common.loading')}</div>
      ) : error ? (
        <div className="text-text-secondary text-sm">{error}</div>
      ) : !definition ? (
        <div className="text-text-secondary text-sm">
          No Strong&apos;s entry found for {strongsNumber}
        </div>
      ) : (
        <div className="text-sm" data-testid="strongs-tooltip-content">
          <div className="font-semibold text-text-primary mb-1">
            {strongsNumber}
            {definition.word && (
              <span className="ms-2 text-text-secondary font-normal">{definition.word}</span>
            )}
            {transliteration && (
              <span className="ms-2 text-text-secondary font-normal italic" data-testid="strongs-tooltip-translit">
                {transliteration}
              </span>
            )}
            {pronunciation && pronunciation !== transliteration && (
              <span className="ms-1 text-text-tertiary font-normal">[{pronunciation}]</span>
            )}
          </div>
          {partOfSpeech && (
            <div className="text-text-secondary text-xs italic mb-1" data-testid="strongs-tooltip-pos">
              {partOfSpeech}
            </div>
          )}
          {glosses && (
            <div className="text-text-primary text-xs mb-1" data-testid="strongs-tooltip-glosses">
              {glosses}
            </div>
          )}
          {shortDescription && (
            <div className="text-text-secondary text-xs leading-relaxed" data-testid="strongs-tooltip-def">
              {shortDescription}
            </div>
          )}
        </div>
      )}
      {/* "Search all occurrences" - the one gesture that gets a reader from a
          word to every place it is used. Rendered as soon as the lookup
          settles, entry or not: a Strong's search runs against the interlinear
          index and does not need the dictionary that just came up empty.
          Mirrors the web app's StrongsPopup action. */}
      {!loading && (
        <button
          type="button"
          onClick={() => {
            void searchStrongsNumber(strongsNumber);
            onClose();
          }}
          className="mt-2 w-full flex items-center justify-center gap-1 px-2 py-1 rounded border border-border text-xs text-accent-strong hover:bg-accent-light hover:border-accent cursor-pointer transition-colors"
          data-testid="strongs-search-occurrences"
        >
          <svg className="w-3 h-3 rtl-mirror" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {t('ui.interlinear.searchOccurrences')}
        </button>
      )}
    </div>
  );
};

/** Matches `<divineName>...</divineName>` (Tetragrammaton, "LORD"/"GOD"), capturing its content. */
const DIVINE_NAME_RENDER_PATTERN = /<divineName(?:\s[^>]*)?>([\s\S]*?)<\/divineName>/g;

/**
 * Normalise whatever verse text we were handed into the same HTML shape
 * `formatVerseText()` produces: `<divineName>` becomes a
 * `<span class="divine-name">` (small-caps CSS treatment), every other
 * OSIS/SWORD tag is stripped.
 *
 * Running `verse.text_html` - which has already been through
 * `formatVerseText()` - through this is a no-op, and that is the point: the
 * token sequence must not depend on whether the caller passed `text_html` or
 * raw `text`, because those tokens are the index space highlights address.
 *
 * The result is never handed to `dangerouslySetInnerHTML`. It is parsed by
 * `extractWordsWithFormatting()` purely to derive tokens and their formatting
 * flags, and every token is then rendered as a JSX text node - so no module
 * text is ever interpreted as markup by the renderer.
 *
 * Exported for direct unit testing without mounting the component.
 */
export function toDisplayHtml(text: string): string {
  if (!text) return '';
  return stripOsisTags(
    text.replace(DIVINE_NAME_RENDER_PATTERN, '<span class="divine-name">$1</span>')
  );
}

/**
 * Clean XML/OSIS markup from text and extract useful data.
 * Handles cases where original_word may be empty (e.g., KJV interlinear
 * where only Strong's numbers and glosses were imported).
 * Also normalizes Strong's numbers (strips "strong:" prefix from lemma field).
 */
function cleanInterlinearWord(word: InterlinearWord): InterlinearWord {
  let cleanedOriginal = word.originalWord || '';
  let extractedLemma = '';

  // Try to extract the actual Greek/Hebrew from lemma.TR: or lemma: in the text
  const lemmaMatch = cleanedOriginal.match(/lemma(?:\.TR)?:([^\s"<>]+)/);
  if (lemmaMatch) {
    extractedLemma = lemmaMatch[1];
  }

  // Remove XML tags like <w savlm="..." src="..."> and </w>
  cleanedOriginal = cleanedOriginal.replace(/<[^>]+>/g, '');
  // Remove any leftover attribute-like content
  cleanedOriginal = cleanedOriginal.replace(/\s*savlm="[^"]*"/g, '');
  cleanedOriginal = cleanedOriginal.replace(/\s*src="[^"]*"/g, '');
  // Clean up whitespace
  cleanedOriginal = cleanedOriginal.trim();

  // If we extracted a lemma and the cleaned original is just English, use the lemma
  // Otherwise use what we have
  let finalOriginal = extractedLemma || cleanedOriginal;

  // Fallback: if original_word is still empty, try to extract from lemma field
  // Some imports store "strong:H01234" in the lemma field
  if (!finalOriginal && word.lemma) {
    const lemmaClean = word.lemma.replace(/^strong:/i, '').trim();
    // Only use lemma as display if it's not just a Strong's number
    if (lemmaClean && !/^[HG]\d+$/i.test(lemmaClean)) {
      finalOriginal = lemmaClean;
    }
  }

  // Use gloss if available, otherwise use cleaned original as gloss if it looks like English.
  //
  // The gloss is no longer *rendered*: the English tokens shown come from the
  // verse text itself (see interlinearCells.ts), which is what makes them
  // addressable by word index. The gloss is only used to decide which English
  // indices a row claims, so any residual OSIS markup in it is harmless here -
  // it never reaches the DOM.
  const isEnglish = /^[a-zA-Z\s]+$/.test(cleanedOriginal);
  const finalGloss = word.gloss || (isEnglish ? cleanedOriginal : '');

  // Normalize Strong's number: strip "strong:" prefix if present
  let finalStrongsNumber = word.strongsNumber || '';
  if (finalStrongsNumber.toLowerCase().startsWith('strong:')) {
    finalStrongsNumber = finalStrongsNumber.substring(7);
  }

  return {
    ...word,
    originalWord: finalOriginal,
    gloss: finalGloss,
    strongsNumber: finalStrongsNumber || word.strongsNumber,
  };
}

/**
 * Displays interlinear data (Greek/Hebrew with English) for Study Mode.
 * Supports both stacked (above/below) and inline (parenthetical) layouts.
 *
 * Every English word is emitted as its own
 * `<span class="word" data-word-index=N>`, in the same 0-based index space
 * highlights, underlines and find-in-page use - see `interlinearCells.ts` for
 * why that is sound. Original-language, transliteration and Strong's lines
 * deliberately carry no `data-word-index`, so dragging across Greek text can
 * never be mapped onto English indices.
 */
const InterlinearDisplay: React.FC<InterlinearDisplayProps> = ({
  interlinearWords,
  englishText,
  layout,
  onStrongsClick,
  verseId,
  moduleId,
}) => {
  // Clean up any XML/OSIS markup in the interlinear data
  const cleanedWords = useMemo(
    () => interlinearWords.map(cleanInterlinearWord),
    [interlinearWords]
  );

  const displayHtml = useMemo(() => toDisplayHtml(englishText), [englishText]);
  const englishWords = useMemo(() => extractWordsWithFormatting(displayHtml), [displayHtml]);

  const cells = useMemo(
    () => buildInterlinearCells(englishWords, cleanedWords),
    [englishWords, cleanedWords]
  );

  // Same subscription shape as HighlightedVerse: one stable array per module
  // out of the store, then a memoised per-verse filter.
  const moduleHighlights = useHighlightStore(state =>
    state.highlightsByModule.get(moduleId) || EMPTY_HIGHLIGHTS
  );
  const highlights = useMemo(
    () => moduleHighlights.filter(h => h.coversVerse(verseId)),
    [moduleHighlights, verseId]
  );

  // Fail soft. A module whose interlinear positions contradict its own text
  // would otherwise render a verse with words missing or duplicated; showing
  // the plain highlighted verse is strictly better than showing garbage.
  if (!cellsPartitionWordSpace(cells, englishWords.length)) {
    if (!partitionFailuresLogged.has(verseId)) {
      partitionFailuresLogged.add(verseId);
      console.warn(
        `[InterlinearDisplay] Interlinear positions do not partition the English ` +
        `word space for verse ${verseId}; falling back to plain text.`
      );
    }
    return (
      // Same emphasis as Study mode's ordinary verse text: this fallback is
      // the verse, not a degraded copy of it.
      <p className="study-verse-text">
        <HighlightedVerse verseId={verseId} verseHTML={displayHtml} moduleId={moduleId} />
      </p>
    );
  }

  if (layout === 'inline') {
    return (
      <InlineLayout
        cells={cells}
        verseId={verseId}
        highlights={highlights}
        onStrongsClick={onStrongsClick}
      />
    );
  }

  return (
    <StackedLayout
      cells={cells}
      verseId={verseId}
      highlights={highlights}
      onStrongsClick={onStrongsClick}
    />
  );
};

/**
 * The English tokens of one cell, each individually addressable.
 *
 * A wash may run continuously between two tokens of the *same* cell, because
 * they are adjacent in the flow. It deliberately does not bridge cells: in the
 * stacked layout the next token lives in a different column, so there is no
 * space between them to paint.
 */
const CellEnglish: React.FC<{
  cell: InterlinearCell;
  verseId: number;
  highlights: UserTextMarkup[];
}> = ({ cell, verseId, highlights }) => (
  <>
    {cell.englishWords.map((word: WordInfo, offset: number) => {
      const wordIndex = cell.wordStart + offset;
      const isLastInCell = offset === cell.englishWords.length - 1;
      const attrs = highlightAttrsForWord(verseId, wordIndex, highlights, {
        isChristWords: word.isChristWords,
        isDivineName: word.isDivineName,
        hasTrailingSpace: word.hasTrailingSpace,
        nextWordIndex: isLastInCell ? null : wordIndex + 1,
      });

      return (
        <React.Fragment key={wordIndex}>
          <span
            className={attrs.className}
            data-word-index={wordIndex}
            data-markup-id={attrs.markupIds}
            style={attrs.style}
          >
            {word.displayText}
            {attrs.spaceInsideSpan ? ' ' : ''}
          </span>
          {!isLastInCell && !attrs.spaceInsideSpan ? ' ' : null}
        </React.Fragment>
      );
    })}
  </>
);

/** The Strong's number of one interlinear row, as a clickable chip. */
const StrongsChip: React.FC<{
  strongsNumber: string;
  onStrongsClick?: (strongsNumber: string) => void;
  /**
   * Hovering *this* chip previews *this* number.
   *
   * The cell keeps a hover handler of its own for the no-chip case, but it can
   * only ever name one number. A cell often carries several - Genesis 1:1's
   * "created" is H01254 plus the accusative marker H0853 - and React
   * synthesises `mouseenter` up its own tree, so pointing at the second chip
   * would fire the cell's handler and preview the first number instead. Click
   * is always right, because each chip closes over its own.
   */
  onHover?: (strongsNumber: string, e: React.MouseEvent) => void;
  onLeave?: () => void;
}> = ({ strongsNumber, onStrongsClick, onHover, onLeave }) => {
  const { t } = useI18n();
  return (
    <button
      onClick={() => onStrongsClick?.(strongsNumber)}
      onMouseEnter={e => onHover?.(strongsNumber, e)}
      onMouseLeave={onLeave}
      className="text-accent-strong hover:text-accent-strong hover:underline font-mono bidi-isolate"
      title={t('ui.interlinear.clickForDictionary')}
      data-testid="strongs-number"
    >
      {strongsNumber}
    </button>
  );
};

/** Every Strong's number attached to a cell: its own row first, then extras. */
function cellStrongsNumbers(cell: InterlinearCell): string[] {
  const numbers: string[] = [];
  if (cell.source?.strongsNumber) numbers.push(cell.source.strongsNumber);
  for (const extra of cell.extraSources) {
    if (extra.strongsNumber) numbers.push(extra.strongsNumber);
  }
  return numbers;
}

interface LayoutProps {
  cells: InterlinearCell[];
  verseId: number;
  highlights: UserTextMarkup[];
  onStrongsClick?: (strongsNumber: string) => void;
}

/**
 * Stacked layout - one `inline-block` column per cell: English on top, then
 * original language, transliteration and Strong's numbers.
 */
const StackedLayout: React.FC<LayoutProps> = ({ cells, verseId, highlights, onStrongsClick }) => {
  // Hover tooltip state. Show/hide timing (300ms show delay, 200ms hide
  // delay so the pointer can reach the tooltip) is shared with InlineLayout
  // via useHoverIntent rather than each layout keeping its own timeout refs.
  const [hoveredStrongs, setHoveredStrongs] = useState<HoveredStrongs | null>(null);
  const { scheduleShow, scheduleHide, cancelHide } = useHoverIntent<HoveredStrongs>({
    onShow: setHoveredStrongs,
    onHide: () => setHoveredStrongs(null),
  });

  const handleMouseEnterOriginalWord = (e: React.MouseEvent, strongsNumber?: string) => {
    if (!strongsNumber) return;
    scheduleShow({ strongsNumber, position: { x: e.clientX, y: e.clientY } });
  };
  const handleChipHover = (strongsNumber: string, e: React.MouseEvent) =>
    handleMouseEnterOriginalWord(e, strongsNumber);

  return (
    // A real flex row, not `space-y-1` over inline-blocks. `space-y-*` is a
    // block-stack utility: it put `margin-top: 4px` on every cell *except the
    // first*, and because `vertical-align: top` aligns margin boxes, that
    // dropped every word after the first 4px below it - the English line
    // visibly stepping down across the row. Flex also removes the reliance on
    // `vertical-align` entirely, so a column with no original word or
    // transliteration can no longer align against a taller neighbour's last
    // baseline. `items-start` is the flex equivalent of the `align-top` this
    // replaces.
    <div
      className="flex flex-wrap items-start gap-x-4 gap-y-4 interlinear-stacked"
      data-testid="interlinear-container"
    >
      {cells.map((cell) => {
        const strongs = cellStrongsNumbers(cell);
        return (
          <div
            key={cell.wordStart}
            className="flex flex-col items-center"
            data-testid="interlinear-word"
            // Hover handlers live on the whole word block, not just the original-word
            // line: every shipped KJV-family module has original_word = NULL, so a
            // handler placed only on that (conditionally-rendered) line was
            // unreachable whenever there was nothing to show there. The chips
            // below override it with their own number.
            onMouseEnter={(e) => handleMouseEnterOriginalWord(e, strongs[0])}
            onMouseLeave={scheduleHide}
          >
            {/* English (top) - the highlightable, selectable, findable layer */}
            <div
              className="text-center text-sm text-text-primary font-semibold mb-1 interlinear-english"
              data-testid="interlinear-gloss"
            >
              <CellEnglish cell={cell} verseId={verseId} highlights={highlights} />
            </div>

            {/* Original language word (middle) */}
            {cell.source?.originalWord ? (
              <div
                className="text-center text-base font-greek text-text-primary cursor-default"
                data-testid="interlinear-original"
              >
                {cell.source.originalWord}
              </div>
            ) : null}

            {/* Transliteration */}
            {cell.source?.transliteration && (
              <div className="text-center text-xs italic text-text-secondary" data-testid="interlinear-transliteration">
                {cell.source.transliteration}
              </div>
            )}

            {/* Strong's numbers (clickable, bottom). More than one appears when
                extra original-language words are pinned to the same English
                position - John 3:16's two spare Greek articles at index 0. */}
            {strongs.length > 0 && (
              <div className="text-center text-xs flex flex-wrap justify-center gap-x-1">
                {strongs.map((number, i) => (
                  <StrongsChip
                    key={`${number}-${i}`}
                    strongsNumber={number}
                    onStrongsClick={onStrongsClick}
                    onHover={handleChipHover}
                    onLeave={scheduleHide}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Hover tooltip for Strong's definition preview */}
      {hoveredStrongs && (
        <StrongsPreviewTooltip
          strongsNumber={hoveredStrongs.strongsNumber}
          position={hoveredStrongs.position}
          onClose={() => setHoveredStrongs(null)}
          onMouseEnter={cancelHide}
        />
      )}
    </div>
  );
};

/**
 * Inline layout - English text reads as prose, with each cell's original
 * language, transliteration and Strong's numbers in a small parenthetical.
 */
const InlineLayout: React.FC<LayoutProps> = ({ cells, verseId, highlights, onStrongsClick }) => {
  // Hover tooltip state
  const [hoveredStrongs, setHoveredStrongs] = useState<HoveredStrongs | null>(null);
  const { scheduleShow, scheduleHide, cancelHide } = useHoverIntent<HoveredStrongs>({
    onShow: setHoveredStrongs,
    onHide: () => setHoveredStrongs(null),
  });

  const handleMouseEnterOriginalWord = (e: React.MouseEvent, strongsNumber?: string) => {
    if (!strongsNumber) return;
    scheduleShow({ strongsNumber, position: { x: e.clientX, y: e.clientY } });
  };
  const handleChipHover = (strongsNumber: string, e: React.MouseEvent) =>
    handleMouseEnterOriginalWord(e, strongsNumber);

  return (
    // `study-verse-text` so the English reads at the same weight as Study
    // mode's plain verse text - turning the interlinear on must not shrink the
    // scripture. The parenthetical annotations stay `text-xs`, which is what
    // keeps the two layers apart.
    <p className="study-verse-text leading-loose interlinear-inline" data-testid="interlinear-container">
      {cells.map((cell, index) => {
        const strongs = cellStrongsNumbers(cell);
        const hasAnnotation = strongs.length > 0 || Boolean(cell.source?.originalWord);

        return (
          <React.Fragment key={cell.wordStart}>
            {index > 0 && ' '}
            {/* A plain inline span, not `inline-flex`. An inline-flex box does
                not sit on the paragraph's baseline directly - the browser
                synthesises one for it from its flex items, and that synthesised
                baseline moves with the annotation's own metrics (`text-xs`
                resets line-height; `.font-greek` is 1.1em). Cells with and
                without an annotation therefore landed at slightly different
                heights, which is the English text drifting up and down along
                the line. As ordinary inline content, every word shares the
                paragraph's own baseline and cannot drift. */}
            <span className="whitespace-nowrap" data-testid="interlinear-word">
              {/* English words */}
              <span className="text-text-primary interlinear-english" data-testid="interlinear-gloss">
                <CellEnglish cell={cell} verseId={verseId} highlights={highlights} />
              </span>

              {/* Original language in parentheses - with hover for definition preview */}
              {hasAnnotation && (
                <span
                  className="text-xs text-text-secondary whitespace-nowrap"
                  onMouseEnter={(e) => handleMouseEnterOriginalWord(e, strongs[0])}
                  onMouseLeave={scheduleHide}
                >
                  (
                  {cell.source?.originalWord && (
                    <span className="font-greek" data-testid="interlinear-original">{cell.source.originalWord}</span>
                  )}
                  {cell.source?.transliteration && (
                    <>
                      {' '}
                      <span className="italic" data-testid="interlinear-transliteration">{cell.source.transliteration}</span>
                    </>
                  )}
                  {strongs.map((number, i) => (
                    <React.Fragment key={`${number}-${i}`}>
                      {' '}
                      <StrongsChip
                        strongsNumber={number}
                        onStrongsClick={onStrongsClick}
                        onHover={handleChipHover}
                        onLeave={scheduleHide}
                      />
                    </React.Fragment>
                  ))}
                  )
                </span>
              )}
            </span>
          </React.Fragment>
        );
      })}

      {/* Hover tooltip for Strong's definition preview */}
      {hoveredStrongs && (
        <StrongsPreviewTooltip
          strongsNumber={hoveredStrongs.strongsNumber}
          position={hoveredStrongs.position}
          onClose={() => setHoveredStrongs(null)}
          onMouseEnter={cancelHide}
        />
      )}
    </p>
  );
};

export default InterlinearDisplay;
