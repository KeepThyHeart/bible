/**
 * The two interlinear layouts, and the pieces both are built from.
 *
 * Lives apart from VerseRenderer because the Study pane's Interlinear section
 * renders the same thing for a single verse. That section used to iterate the
 * raw `interlinear_word` rows instead, which prints the English in *row* order
 * rather than translation order and drops every English word no row claims —
 * the exact failure the cell model was introduced to fix, still on screen a
 * pane away.
 */

import { searchStore } from '../../stores/searchStore';
import { commentaryStore } from '../../stores/commentaryStore';
import { openPane } from '../../host/paneRequests';
import { usePaneAvailable } from '../../modules/host/usePaneModes';
import {
  cellStrongsNumbers,
  wordRenderAttrs,
  type InterlinearCell,
  type ResolvedVerse,
} from '@bible/core/browser';
import { Fragment } from 'preact';
import type { JSX } from 'preact';
import type { StrongsEntryData } from '../../types';

export interface StrongsHandlers {
  onStrongsClick?: (strongsNumber: string) => void;
  onStrongsHover?: (strongsNumber: string, rect: DOMRect) => void;
  onStrongsLeave?: () => void;
}

/**
 * The English tokens of one cell, in the order the translation puts them and
 * carrying the formatting the verse HTML gave them. Rendering these — rather
 * than the interlinear rows' glosses — is what keeps every English word on
 * screen and in reading order.
 */
function CellEnglish({ cell, resolved }: { cell: InterlinearCell; resolved?: ResolvedVerse | null }) {
  return (
    <>
      {cell.englishWords.map((word, offset) => {
        const paint = resolved?.words.get(cell.wordStart + offset);
        if (paint) {
          // Painted word: the shared word painter decides class and style, as
          // it does for the plain verse (a wash cannot bridge stacked cells,
          // so no next word is passed).
          const attrs = wordRenderAttrs(0, cell.wordStart + offset, [], {
            isChristWords: word.isChristWords, isDivineName: word.isDivineName,
            hasTrailingSpace: false, nextWordIndex: null,
          }, paint);
          const isLastPainted = offset === cell.englishWords.length - 1;
          return (
            <span key={cell.wordStart + offset}>
              <span
                class={attrs.className}
                data-word-index={cell.wordStart + offset}
                style={attrs.style as JSX.CSSProperties | undefined}
              >{word.displayText}</span>{isLastPainted ? '' : ' '}
            </span>
          );
        }
        const classes = [
          word.isChristWords ? 'christ-words' : '',
          word.isDivineName ? 'divine-name' : '',
        ].filter(Boolean).join(' ');
        const isLast = offset === cell.englishWords.length - 1;
        return (
          <span key={cell.wordStart + offset}>
            <span class={classes || undefined}>{word.displayText}</span>{isLast ? '' : ' '}
          </span>
        );
      })}
    </>
  );
}

/** One Strong's number, a real button opening the dictionary definition. */
function StrongsChip({ strongsNumber, title, onStrongsClick, onStrongsHover, onStrongsLeave }: {
  strongsNumber: string;
  title?: string;
} & StrongsHandlers) {
  const number = plainStrongs(strongsNumber);
  return (
    <button
      type="button"
      class="verse__strongs-link"
      title={title || number}
      aria-label={`Strong's ${number}`}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        onStrongsClick?.(strongsNumber);
      }}
      onMouseEnter={(e: MouseEvent) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        onStrongsHover?.(strongsNumber, rect);
      }}
      onMouseLeave={() => onStrongsLeave?.()}
    >
      {number}
    </button>
  );
}

/**
 * Original-language word and transliteration. The word is a real button wired to the same
 * dictionary lookup as the Strong's chip (left inert, the one thing a reader is most likely to
 * click in an interlinear would do nothing); the transliteration is plain text beside it, since a
 * second button for the same lookup would only add a Tab stop.
 */
function CellOriginal({ cell, strongsNumber, classPrefix, onStrongsClick, onStrongsHover, onStrongsLeave }: {
  cell: InterlinearCell;
  strongsNumber: string | undefined;
  /** BEM block prefix; `-original` / `-translit` are appended. */
  classPrefix: string;
} & StrongsHandlers) {
  const source = cell.source;
  if (!source) return null;

  const clickable = Boolean(strongsNumber);
  return (
    <>
      {source.originalWord && clickable && (
        <button
          type="button"
          class={`${classPrefix}-original ${classPrefix}-original--clickable`}
          aria-label={`${source.originalWord}, ${plainStrongs(strongsNumber!)}`}
          onClick={(e: MouseEvent) => {
            e.stopPropagation();
            onStrongsClick?.(strongsNumber!);
          }}
          onMouseEnter={(e: MouseEvent) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            onStrongsHover?.(strongsNumber!, rect);
          }}
          onMouseLeave={() => onStrongsLeave?.()}
        >{source.originalWord}</button>
      )}
      {source.originalWord && !clickable && (
        <span class={`${classPrefix}-original`}>{source.originalWord}</span>
      )}
      {source.transliteration && (
        <>
          {source.originalWord ? ' ' : ''}
          <span class={`${classPrefix}-translit`}>{source.transliteration}</span>
        </>
      )}
    </>
  );
}

export interface LayoutProps extends StrongsHandlers {
  cells: InterlinearCell[];
  /** Resolved keyword-mark paint for the verse, when it has any. */
  resolved?: ResolvedVerse | null;
  strongsEntries?: Record<string, StrongsEntryData>;
}

/** Tooltip for a Strong's chip: the dictionary's brief meaning where we have it. */
function strongsTitle(strongsNumber: string, entries: Record<string, StrongsEntryData> | undefined): string {
  return entries?.[strongsNumber]?.briefMeaning || strongsNumber;
}

/** A cell's Strong's numbers with padded duplicates ("H05175" beside "H5175") collapsed. */
function uniqueStrongs(cell: InterlinearCell): string[] {
  const seen = new Set<string>();
  return cellStrongsNumbers(cell).filter((n) => {
    const key = plainStrongs(n).toUpperCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** `H07225` -> `H7225`: the number as a reader types it (the data pads to five digits). */
function plainStrongs(strongsNumber: string): string {
  return strongsNumber.replace(/^([GH])0+(?=\d)/i, '$1');
}

/**
 * The English of a cell. With a Strong's number it is a button (keyboard reachable) named after the
 * word and its number: it opens Word study when that pane exists, else searches the number.
 */
function CellGloss({ cell, primary, resolved, className = 'verse__interlinear-gloss' }: {
  cell: InterlinearCell;
  primary: string | undefined;
  resolved?: ResolvedVerse | null;
  className?: string;
}) {
  const wordStudyAvailable = usePaneAvailable('wordStudy');
  if (!primary) {
    return <span class={className}><CellEnglish cell={cell} resolved={resolved} /></span>;
  }
  const number = plainStrongs(primary);
  // The gloss can end in the verse's own punctuation ("the world,"): drop it before ", G3588".
  const english = cell.englishWords.map((w) => w.displayText).join(' ').replace(/[\s.,;:!?]+$/, '');
  return (
    <button
      type="button"
      class={`${className} ${className}--clickable`}
      aria-label={english ? `${english}, ${number}` : number}
      title={wordStudyAvailable ? `Word study ${number}` : `Search ${number}`}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        if (wordStudyAvailable) {
          openPane('wordStudy', { strongs: number });
        } else {
          searchStore.performSearch(number);
          commentaryStore.setRightPaneMode('search');
        }
      }}
    ><CellEnglish cell={cell} resolved={resolved} /></button>
  );
}

/** One column per cell: English on top, then original language and Strong's. */
export function StackedInterlinear({ cells, resolved, strongsEntries, onStrongsClick, onStrongsHover, onStrongsLeave }: LayoutProps) {
  return (
    <div class="verse__body verse__body--interlinear">
      {cells.map((cell, index) => {
        const strongs = uniqueStrongs(cell);
        const primary = strongs[0];
        // Whitespace between flex items is not painted, but it keeps the verse's text content
        // and accessible name spaced ("called to be an", not "calledto bean").
        return (
          <Fragment key={cell.wordStart}>
          {index > 0 ? ' ' : ''}
          <span class="verse__interlinear-word">
            <CellGloss cell={cell} primary={primary} resolved={resolved} />
            {cell.source?.originalWord || cell.source?.transliteration ? ' ' : ''}
            <CellOriginal
              cell={cell}
              strongsNumber={primary}
              classPrefix="verse__interlinear"
              onStrongsClick={onStrongsClick}
              onStrongsHover={onStrongsHover}
              onStrongsLeave={onStrongsLeave}
            />
            {strongs.map((number, i) => (
              <Fragment key={`${number}-${i}`}>
                {' '}
                <StrongsChip
                  strongsNumber={number}
                  title={strongsTitle(number, strongsEntries)}
                  onStrongsClick={onStrongsClick}
                  onStrongsHover={onStrongsHover}
                  onStrongsLeave={onStrongsLeave}
                />
              </Fragment>
            ))}
          </span>
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * Prose, with each word's original-language form in a small parenthetical.
 * The default: it keeps the passage readable while the study data is on.
 */
export function InlineInterlinear({ cells, resolved, strongsEntries, onStrongsClick, onStrongsHover, onStrongsLeave }: LayoutProps) {
  return (
    <div class="verse__body verse__body--interlinear-inline">
      {cells.map((cell, index) => {
        const strongs = uniqueStrongs(cell);
        const hasAnnotation = strongs.length > 0 || Boolean(cell.source?.originalWord);
        return (
          <span key={cell.wordStart} class="verse__interlinear-inline-word">
            {index > 0 ? ' ' : ''}
            <CellEnglish cell={cell} resolved={resolved} />
            {hasAnnotation && (
              <span class="verse__interlinear-annotation">
                {'('}
                <CellOriginal
                  cell={cell}
                  strongsNumber={strongs[0]}
                  classPrefix="verse__interlinear"
                  onStrongsClick={onStrongsClick}
                  onStrongsHover={onStrongsHover}
                  onStrongsLeave={onStrongsLeave}
                />
                {strongs.map((number, i) => (
                  <Fragment key={`${number}-${i}`}>
                    {i > 0 || cell.source?.originalWord || cell.source?.transliteration ? ' ' : ''}
                    <StrongsChip
                      strongsNumber={number}
                      title={strongsTitle(number, strongsEntries)}
                      onStrongsClick={onStrongsClick}
                      onStrongsHover={onStrongsHover}
                      onStrongsLeave={onStrongsLeave}
                    />
                  </Fragment>
                ))}
                {')'}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
