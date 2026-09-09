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
import {
  cellStrongsNumbers,
  type InterlinearCell,
} from '../../utils/interlinearCells';
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
function CellEnglish({ cell }: { cell: InterlinearCell }) {
  return (
    <>
      {cell.englishWords.map((word, offset) => {
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

/** One Strong's number, opening the dictionary definition on click. */
function StrongsChip({ strongsNumber, title, onStrongsClick, onStrongsHover, onStrongsLeave }: {
  strongsNumber: string;
  title?: string;
} & StrongsHandlers) {
  return (
    <sup
      class="verse__strongs-link"
      title={title || strongsNumber}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        onStrongsClick?.(strongsNumber);
      }}
      onMouseEnter={(e: MouseEvent) => {
        const rect = (e.target as HTMLElement).getBoundingClientRect();
        onStrongsHover?.(strongsNumber, rect);
      }}
      onMouseLeave={() => onStrongsLeave?.()}
    >
      {strongsNumber}
    </sup>
  );
}

/**
 * Original-language word and transliteration, wired to the same dictionary
 * lookup as the Strong's chip. Left inert, the Hebrew or Greek word — the one
 * thing a reader is most likely to click in an interlinear — does nothing at
 * all.
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
  const handlers = clickable ? {
    onClick: (e: MouseEvent) => {
      e.stopPropagation();
      onStrongsClick?.(strongsNumber!);
    },
    onMouseEnter: (e: MouseEvent) => {
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      onStrongsHover?.(strongsNumber!, rect);
    },
    onMouseLeave: () => onStrongsLeave?.(),
  } : {};

  return (
    <>
      {source.originalWord && (
        <span
          class={`${classPrefix}-original${clickable ? ` ${classPrefix}-original--clickable` : ''}`}
          {...handlers}
        >{source.originalWord}</span>
      )}
      {source.transliteration && (
        <span
          class={`${classPrefix}-translit${clickable ? ` ${classPrefix}-translit--clickable` : ''}`}
          {...handlers}
        >{source.transliteration}</span>
      )}
    </>
  );
}

export interface LayoutProps extends StrongsHandlers {
  cells: InterlinearCell[];
  strongsEntries?: Record<string, StrongsEntryData>;
}

/** Tooltip for a Strong's chip: the dictionary's brief meaning where we have it. */
function strongsTitle(strongsNumber: string, entries: Record<string, StrongsEntryData> | undefined): string {
  return entries?.[strongsNumber]?.briefMeaning || strongsNumber;
}

/** One column per cell: English on top, then original language and Strong's. */
export function StackedInterlinear({ cells, strongsEntries, onStrongsClick, onStrongsHover, onStrongsLeave }: LayoutProps) {
  return (
    <div class="verse__body verse__body--interlinear">
      {cells.map(cell => {
        const strongs = cellStrongsNumbers(cell);
        const primary = strongs[0];
        return (
          <span key={cell.wordStart} class="verse__interlinear-word">
            <span
              class={`verse__interlinear-gloss${primary ? ' verse__interlinear-gloss--clickable' : ''}`}
              onClick={primary ? (e: MouseEvent) => {
                e.stopPropagation();
                searchStore.performSearch(primary);
                commentaryStore.setRightPaneMode('search');
              } : undefined}
              title={primary ? `Search ${primary}` : undefined}
            ><CellEnglish cell={cell} /></span>
            <CellOriginal
              cell={cell}
              strongsNumber={primary}
              classPrefix="verse__interlinear"
              onStrongsClick={onStrongsClick}
              onStrongsHover={onStrongsHover}
              onStrongsLeave={onStrongsLeave}
            />
            {strongs.map((number, i) => (
              <StrongsChip
                key={`${number}-${i}`}
                strongsNumber={number}
                title={strongsTitle(number, strongsEntries)}
                onStrongsClick={onStrongsClick}
                onStrongsHover={onStrongsHover}
                onStrongsLeave={onStrongsLeave}
              />
            ))}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Prose, with each word's original-language form in a small parenthetical.
 * The default: it keeps the passage readable while the study data is on.
 */
export function InlineInterlinear({ cells, strongsEntries, onStrongsClick, onStrongsHover, onStrongsLeave }: LayoutProps) {
  return (
    <div class="verse__body verse__body--interlinear-inline">
      {cells.map((cell, index) => {
        const strongs = cellStrongsNumbers(cell);
        const hasAnnotation = strongs.length > 0 || Boolean(cell.source?.originalWord);
        return (
          <span key={cell.wordStart} class="verse__interlinear-inline-word">
            {index > 0 ? ' ' : ''}
            <CellEnglish cell={cell} />
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
                  <StrongsChip
                    key={`${number}-${i}`}
                    strongsNumber={number}
                    title={strongsTitle(number, strongsEntries)}
                    onStrongsClick={onStrongsClick}
                    onStrongsHover={onStrongsHover}
                    onStrongsLeave={onStrongsLeave}
                  />
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
