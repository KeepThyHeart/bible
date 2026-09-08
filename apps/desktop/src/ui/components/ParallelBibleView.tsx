import React, { useRef, useEffect, useState } from 'react';
import { useI18n } from '../contexts/useI18n';
import { useBiblePanel } from '../stores/hooks/useBiblePanel';
import { useCommentaryStore } from '../stores/useCommentaryStore';
import { useNotesStore } from '../stores/useNotesStore';
import { bibleAPI } from '../services/electronAPI';
import { sanitizeHtml } from '../utils/sanitize';
import { isTextSelectionActive } from '../utils/selectionUtils';
import { getBookName } from '../utils/verseFormatting';
import { isPrefaceVerse, getSectionHeading, SectionHeadingBlock, PREFACE_TEXT_CLASSNAME } from './bible/SectionHeading';
import { isInSelectedRange } from '../stores/bible/internals/verseRange';

interface BibleVerse {
  verse_id: number;
  book_number: number;
  chapter: number;
  verse: number;
  text: string;
  text_html?: string;
  is_paragraph_start?: boolean;
  words_of_christ?: boolean;
  formatting?: any;
  metadata?: any;
}

interface ParallelBibleViewProps {
  panelId?: string;
}

const ParallelBibleView: React.FC<ParallelBibleViewProps> = ({ panelId }) => {
  const { t } = useI18n();
  const {
    parallelVersions,
    availableBibles,
    currentBook,
    currentChapter,
    selectedVerseId,
    selectionEndVerseId,
    scrollMode,
    scrollTrigger,
    setSelectedVerse,
    extendSelectionTo
  } = useBiblePanel(panelId);

  const { syncAllPanelsWithVerse } = useCommentaryStore();
  const { syncAllPanelsWithVerse: syncAllNotesPanelsWithVerse } = useNotesStore();

  // Self-managed verse data per version
  const [versesByVersion, setVersesByVersion] = useState<Map<string, BibleVerse[]>>(new Map());
  const [loadingByVersion, setLoadingByVersion] = useState<Map<string, boolean>>(new Map());
  const [errorByVersion, setErrorByVersion] = useState<Map<string, string | null>>(new Map());

  // Column widths state (percentage of total width)
  const [columnWidths, setColumnWidths] = useState<number[]>([]);

  // Resizing state
  const [resizingIndex, setResizingIndex] = useState<number | null>(null);
  const [startX, setStartX] = useState<number>(0);
  const [startWidths, setStartWidths] = useState<number[]>([]);

  const tableRef = useRef<HTMLTableElement>(null);
  const selectedVerseRef = useRef<HTMLTableRowElement>(null);

  // Load verse data for all parallel versions
  useEffect(() => {
    if (parallelVersions.length === 0) return;

    parallelVersions.forEach(async (abbr) => {
      setLoadingByVersion(prev => new Map(prev).set(abbr, true));
      setErrorByVersion(prev => new Map(prev).set(abbr, null));

      try {
        const chapterResult = await bibleAPI.getChapter(abbr, currentBook, currentChapter);
        const verses = Array.isArray(chapterResult) ? chapterResult : chapterResult.verses;
        setVersesByVersion(prev => new Map(prev).set(abbr, verses));
        setLoadingByVersion(prev => new Map(prev).set(abbr, false));
      } catch (error) {
        setErrorByVersion(prev => new Map(prev).set(abbr, error instanceof Error ? error.message : 'Failed to load'));
        setLoadingByVersion(prev => new Map(prev).set(abbr, false));
      }
    });
  }, [parallelVersions, currentBook, currentChapter]);

  // Initialize column widths equally when versions change
  useEffect(() => {
    if (parallelVersions.length > 0) {
      const equalWidth = 100 / parallelVersions.length;
      setColumnWidths(parallelVersions.map(() => equalWidth));
    }
  }, [parallelVersions.length]);

  // Scroll to the selected verse - but only when the selection came from a
  // navigation ('center'), not from a click.
  //
  // Without the guard this re-centered on every selectedVerseId change, so
  // clicking a verse after scrolling up yanked the table back down to it. A
  // click sets scrollMode 'nearest' precisely to say "the reader can already
  // see this one"; the single-column view has honoured that all along.
  useEffect(() => {
    if (scrollMode !== 'center') return;
    selectedVerseRef.current?.scrollIntoView({
      behavior: 'auto',
      block: 'center'
    });
  }, [selectedVerseId, scrollTrigger, scrollMode]);

  /**
   * Handle verse click. `extend` is the shift key: it widens the passage out
   * to this verse without moving the anchor, which is why it returns before
   * the cross-pane syncs - the verse the study panes follow has not changed.
   */
  const handleVerseClick = (verseId: number, extend: boolean = false) => {
    if (extend) {
      extendSelectionTo(verseId);
      return;
    }
    setSelectedVerse(verseId);
    syncAllPanelsWithVerse(verseId);
    syncAllNotesPanelsWithVerse(verseId);
  };

  /**
   * Click-to-select that yields to a text drag - the same rule the
   * single-column modes apply (`handleVerseBodyClick` in `BibleVerseList`).
   * A click that merely *ends* a non-collapsed selection is a copy gesture,
   * not a verse selection, so it is ignored.
   */
  const handleVerseRowClick = (verseId: number, extend: boolean) => {
    // A shift-click leaves no text selection of its own (its mousedown is
    // preventDefault-ed below), so the drag guard must not swallow it.
    if (!extend && isTextSelectionActive()) return;
    handleVerseClick(verseId, extend);
  };

  /**
   * Stop Chromium turning shift+mousedown into a caret-extending text
   * selection across the intervening rows. See the same handler in
   * `BibleVerseList`.
   */
  const handleVerseMouseDown = (e: React.MouseEvent) => {
    if (e.shiftKey) e.preventDefault();
  };

  // Get all unique verse numbers across all versions
  const getAllVerseNumbers = (): number[] => {
    const verseNumbers = new Set<number>();
    parallelVersions.forEach(abbr => {
      const verses = versesByVersion.get(abbr) || [];
      verses.forEach(verse => {
        verseNumbers.add(verse.verse);
      });
    });
    return Array.from(verseNumbers).sort((a, b) => a - b);
  };

  // Start resizing column
  const handleResizeStart = (index: number, e: React.MouseEvent) => {
    e.preventDefault();
    setResizingIndex(index);
    setStartX(e.clientX);
    setStartWidths([...columnWidths]);
  };

  // Handle mouse move during resize
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (resizingIndex === null || !tableRef.current) return;

      const deltaX = e.clientX - startX;
      const tableWidth = tableRef.current.offsetWidth;
      const deltaPercent = (deltaX / tableWidth) * 100;

      const newWidths = [...startWidths];

      const newCurrentWidth = Math.max(10, startWidths[resizingIndex] + deltaPercent);
      const newNextWidth = Math.max(10, startWidths[resizingIndex + 1] - deltaPercent);

      if (newCurrentWidth >= 10 && newNextWidth >= 10) {
        newWidths[resizingIndex] = newCurrentWidth;
        newWidths[resizingIndex + 1] = newNextWidth;
        setColumnWidths(newWidths);
      }
    };

    const handleMouseUp = () => {
      setResizingIndex(null);
    };

    if (resizingIndex === null) return;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingIndex, startX, startWidths]);

  const verseNumbers = getAllVerseNumbers();

  // If no versions selected
  if (parallelVersions.length < 2) {
    return (
      <div className="flex items-center justify-center h-full text-text-secondary">
        <p>{t('parallelBibleView.selectAtLeastTwo')}</p>
      </div>
    );
  }

  // Resolve version names from available bibles
  const versionNames = new Map<string, string>();
  availableBibles.forEach(b => versionNames.set(b.abbreviation, b.name));

  // Create verse maps for each version
  const verseMaps = parallelVersions.map(abbr => {
    const verses = versesByVersion.get(abbr) || [];
    const map = new Map<number, BibleVerse>();
    verses.forEach(verse => {
      map.set(verse.verse, verse);
    });
    return map;
  });

  return (
    <div className="h-full overflow-auto">
      <table
        ref={tableRef}
        className="w-full border-collapse"
        style={{ tableLayout: 'fixed' }}
      >
        {/* Header Row - Sticky */}
        <thead className="sticky top-0 z-10 bg-background-warm">
          <tr>
            {parallelVersions.map((abbr, index) => {
              const isLoading = loadingByVersion.get(abbr) || false;
              const error = errorByVersion.get(abbr) || null;

              return (
                <th
                  key={abbr}
                  className="border-b-2 border-accent px-md py-sm text-center relative"
                  style={{ width: `${columnWidths[index]}%` }}
                >
                  <div>
                    <div className="font-bold text-text-heading">
                      {abbr}
                    </div>
                    <div className="text-xs text-text-secondary truncate">
                      {versionNames.get(abbr) || abbr}
                    </div>
                    {isLoading && (
                      <div className="text-xs text-text-secondary italic mt-1">
                        {t('parallelBibleView.loading')}
                      </div>
                    )}
                    {error && (
                      <div className="text-xs text-danger mt-1">
                        {error}
                      </div>
                    )}
                  </div>

                  {/* Resize handle */}
                  {index < parallelVersions.length - 1 && (
                    <div
                      className="absolute top-0 end-0 w-1 h-full cursor-col-resize hover:bg-accent-soft bg-border"
                      onMouseDown={(e) => handleResizeStart(index, e)}
                    />
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        {/* Verse Rows */}
        <tbody>
          {verseNumbers.map(verseNum => {
            const hasSelectedVerse = verseMaps.some(map => {
              const verse = map.get(verseNum);
              return verse && verse.verse_id === selectedVerseId;
            });

            // Selection in this view has always been verse-level, not
            // translation-level: verse_id is derived from book/chapter/verse,
            // so every column's cell in a row carries the SAME verse_id and
            // `hasSelectedVerse` was already computed per row. The row is
            // therefore the unit that hovers and selects - one horizontal band
            // across all columns - rather than each <td> lighting up on its
            // own, which would suggest you could select "John 3:16 in the ESV
            // column" as distinct from "John 3:16 in the KJV column". You
            // cannot; there is one selected verse per panel.
            const rowVerseId = verseMaps
              .map(map => map.get(verseNum))
              .find((v): v is BibleVerse => v !== undefined)?.verse_id;

            // Swept in by a shift-click, but not the anchor. Only the
            // background fill is involved, and a `<tr>` does paint one (unlike
            // the box-shadow the anchor's accent bar needs - see themes.css),
            // so the whole band washes in one piece like the other modes.
            const isInRange = rowVerseId !== undefined
              && isInSelectedRange(rowVerseId, selectedVerseId, selectionEndVerseId);

            return (
              /*
                `verse-row` supplies cursor: pointer and the themed hover wash
                (`--theme-verse-hover-fill`) for the whole band; `verse-selected`
                supplies colour and nothing else. Both are the shared classes from
                themes.css, so all ten themes stay correct and this view can no
                longer drift from Standard/Reading/Study.

                No geometry moves on selection: the row's padding lives on the
                <td>s (`px-md py-sm`), unconditionally. `.verse-row`'s own
                padding/margin/radius are inert on a `display: table-row` box,
                which is exactly what we want here - the class contributes only
                the cursor, the transition and the hover colour.

                A plain <tr onClick>, with no role/tabIndex: it must not become an
                interactive element wrapping the verse-number <button>s. The
                buttons are the keyboard path (see below).
              */
              <tr
                key={verseNum}
                ref={hasSelectedVerse ? selectedVerseRef : null}
                className={`verse-row border-b border-border align-top ${hasSelectedVerse ? 'verse-selected' : ''} ${isInRange ? 'verse-in-range' : ''}`}
                data-testid={`parallel-verse-${verseNum}`}
                aria-current={hasSelectedVerse ? 'true' : undefined}
                onMouseDown={handleVerseMouseDown}
                onClick={rowVerseId !== undefined ? (e) => handleVerseRowClick(rowVerseId, e.shiftKey) : undefined}
              >
                {parallelVersions.map((abbr, colIndex) => {
                  const verse = verseMaps[colIndex].get(verseNum);

                  if (!verse) {
                    return (
                      <td
                        key={abbr}
                        className="px-md py-sm text-text-secondary text-sm italic"
                      >
                        <span className="font-bold">{verseNum}</span> —
                      </td>
                    );
                  }

                  const isParagraphStart = verse.is_paragraph_start;
                  // verse.verse === 0: a chapter preface/superscription stored as a
                  // literal verse 0 (legacy v1-style data) - no verse-number
                  // affordance, styled as secondary/italic like a heading rather
                  // than body text. See BibleVerseList/StudyModeView for the same
                  // handling in the other display modes.
                  const isPreface = isPrefaceVerse(verse);
                  // Module Format v2 attaches Psalm superscriptions and section
                  // headings to the verse that follows them via
                  // formatting.sectionHeading. Rendered *inside* this column's
                  // cell (not as its own table row) so a heading present in one
                  // translation but not another cannot shift row alignment
                  // between columns - every column still has exactly one <td>
                  // per verse number.
                  const sectionHeading = getSectionHeading(verse);

                  return (
                    // The cell's padding is unconditional - selection adds no
                    // geometry here, only the row's colour (see the <tr> above).
                    <td
                      key={abbr}
                      className={`px-md py-sm ${isParagraphStart ? 'pt-lg' : ''}`}
                    >
                      {sectionHeading && (
                        <SectionHeadingBlock text={sectionHeading} className="mb-1" />
                      )}
                      <div className={`flex ${isPreface ? PREFACE_TEXT_CLASSNAME : ''}`}>
                        {!isPreface && (
                          /*
                            The whole row selects the verse, so the number is no
                            longer a click target in its own right: no onClick, no
                            cursor-pointer, no hover fill. A second affordance on
                            the number told the reader it did something the rest of
                            the row did not. It stays a real <button> purely as the
                            KEYBOARD target - Tab reaches it and Enter/Space fires a
                            native click that bubbles to the <tr>'s handler - with a
                            focus-visible ring so that path stays visible.

                            `w-9` + `pe-2` (and the flex `gap-2` dropped): a 36px
                            gutter, narrower than Standard's `w-11` and Study's
                            `w-10`, because parallel columns are the narrowest
                            surface in the app and every pixel spent on the gutter
                            comes out of the translation text. 28px still clears a
                            bold three-digit numeral (Psalm 119:176).
                          */
                          <button
                            type="button"
                            className="flex-shrink-0 w-9 text-end pe-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            aria-label={t(
                              'biblePane.selectVerse',
                              { book: getBookName(verse.book_number), chapter: verse.chapter, verse: verse.verse, },
                            )}
                          >
                            {/* <bdi> rather than a bare <span>: a bare numeral is
                                weak-directional and would otherwise be reordered
                                out of its column in RTL scripture. */}
                            <bdi aria-hidden="true" className="font-bold text-accent">
                              {verse.verse}
                            </bdi>
                          </button>
                        )}
                        <span
                          className="flex-1"
                          dangerouslySetInnerHTML={{
                            __html: sanitizeHtml(verse.text_html || verse.text)
                          }}
                        />
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default ParallelBibleView;
