import React, { useRef, useState, useEffect } from 'react';
import { bibleAPI } from '../../services/electronAPI';
import { StudyModeOptions } from '../../stores/useBibleStore';
import { useBiblePanel } from '../../stores/hooks/useBiblePanel';
import StudyControls from './StudyControls';
import FootnoteDisplay from './FootnoteDisplay';
import CrossReferenceDisplay from './CrossReferenceDisplay';
import InterlinearDisplay, { InterlinearWord } from './InterlinearDisplay';
import VerseLinksDisplay from './VerseLinksDisplay';
import { useChapterStudyData } from './useChapterStudyData';
import { FormattingData } from '@bible/core';
import { HighlightedVerse } from '../highlights/HighlightRenderer';
import { isPrefaceVerse, getSectionHeading, SectionHeadingBlock, PREFACE_TEXT_CLASSNAME } from '../bible/SectionHeading';
import PaneLoadingSkeleton from '../onboarding/PaneLoadingSkeleton';
import { useDeferredLoading } from '../../hooks/useDeferredLoading';
import { isTextSelectionActive } from '../../utils/selectionUtils';
import { isInSelectedRange } from '../../stores/bible/internals/verseRange';
import { findVerseElement, restartArrivalFlash } from '../../hooks/verseScrollTarget';

interface BibleVerse {
  verse_id: number;
  book_number: number;
  chapter: number;
  verse: number;
  text: string;
  text_html?: string;
  is_paragraph_start?: boolean;
  words_of_christ?: boolean;
  formatting?: FormattingData;
  metadata?: any;
}

interface StudyModeViewProps {
  verses: BibleVerse[];
  /**
   * The dockview panel this view belongs to.
   *
   * Study options are per-panel *and* per-tab. Omitting this defaulted the hook
   * to `DEFAULT_PANEL_ID`, a panel that only exists in detached windows, so
   * `getStudyOptions` never found the entry the toolbar's Interlinear/Notes
   * toggles had just written and always handed back the defaults - the toggles
   * lit up and changed nothing.
   */
  panelId: string;
  tabId: string;
  currentBookNumber: number;
  currentBookName: string;
  currentChapter: number;
  selectedVerseId: number | null;
  /**
   * Far end of a shift-click passage selection, or null. The anchor stays in
   * `selectedVerseId`; see `stores/bible/internals/verseRange.ts`.
   */
  selectionEndVerseId?: number | null;
  /**
   * A verse followed to from a link rather than chosen - marked, but not
   * selected, and nothing follows it. See
   * `stores/bible/slices/previewSlice.ts`.
   */
  previewVerseId?: number | null;
  /** Far end of a previewed passage. */
  previewVerseEndId?: number | null;
  /** `extend` is the shift key: widen the passage instead of re-anchoring. */
  onVerseClick: (verseId: number, extend?: boolean) => void;
  /**
   * Right-click on a verse row, forwarded to the same handler Standard/Reading
   * use so the verse context menu (highlight, note, copy) behaves identically
   * in Study mode.
   */
  onVerseContextMenu?: (event: React.MouseEvent, verse: BibleVerse) => void;
  onStrongsClick?: (strongsNumber: string) => void;
  showRedLetter?: boolean;
  /**
   * Owning module, needed by HighlightedVerse to look up this module's
   * highlights.
   */
  moduleId: number;
  /**
   * Owned by BiblePane and forwarded through BibleVerseList - the same ref
   * useBibleScrolling's `if (selectedVerseRef.current)` guard checks. A local
   * `useRef` here instead - one nothing outside this component ever saw -
   * would leave that guard always false in Study mode, so scroll-to-verse
   * would silently do nothing.
   */
  selectedVerseRef: React.RefObject<HTMLDivElement | null>;
  /** Panel's scroll trigger/mode (see useBibleScrolling) - used below to
   *  re-fire the scroll once interlinear data finishes loading. */
  scrollTrigger: number;
  scrollMode: 'center' | 'nearest';
}

/**
 * Study Mode view for Bible text
 * Displays Bible text with all study features: footnotes, cross-references, interlinear
 */
const StudyModeView: React.FC<StudyModeViewProps> = ({
  verses,
  panelId,
  tabId,
  currentBookNumber,
  currentBookName,
  currentChapter,
  selectedVerseId,
  selectionEndVerseId,
  previewVerseId,
  previewVerseEndId,
  onVerseClick,
  onVerseContextMenu,
  onStrongsClick,
  showRedLetter = true,
  moduleId,
  selectedVerseRef,
  scrollTrigger,
  scrollMode,
}) => {
  const { getStudyOptions, setStudyOptions, openTabs, activeTabIndex, interlinearByModule, studyOptionsByTab, navigateToVerse } = useBiblePanel(panelId);
  // Read through the panel's options map (a subscribed value) rather than only
  // calling getStudyOptions, so a toolbar toggle re-renders this view instead of
  // leaving the previous options on screen until something else changes.
  const studyOptions = studyOptionsByTab.get(tabId) ?? getStudyOptions(tabId);

  // State for interlinear and cross-reference data
  const [interlinearDataByVerse, setInterlinearDataByVerse] = useState<Map<number, InterlinearWord[]>>(new Map());
  /**
   * A fetch for the current chapter is in flight. Kept separate from
   * `interlinearResolved` because "nothing loaded yet" and "loaded, and this
   * chapter genuinely has no interlinear rows" are different states that the
   * old `interlinearWords.length > 0` render test could not tell apart - which
   * is exactly why turning Interlinear on painted the whole chapter as short
   * plain text and then re-rendered every verse as a much taller stack.
   */
  const [interlinearLoading, setInterlinearLoading] = useState(false);
  /** A fetch has completed for the current chapter, so an empty result is meaningful. */
  const [interlinearResolved, setInterlinearResolved] = useState(false);
  /**
   * Cross-references, verse links and reverse references for the whole chapter,
   * loaded ONCE, above the subtree the interlinear gate unmounts.
   *
   * Three independent sources instead - a per-verse-per-module cross-reference
   * effect here, and two more effects inside a `VerseLinksDisplay` mounted on
   * every row - would each resolve at its own moment and change the height of
   * its verse. See `useChapterStudyData` for why the fetch has to sit above
   * the gate.
   */
  const studyData = useChapterStudyData(
    verses.map(v => v.verse_id),
    currentBookNumber,
    currentChapter,
    studyOptions.showCrossReferences,
  );

  // Get current abbreviation from active tab. With no tab there is no chapter
  // on screen and nothing to look interlinear data up for; an empty key finds
  // none, where naming a Bible here only guessed at one.
  const activeTab = openTabs[activeTabIndex];
  const currentAbbreviation = activeTab?.abbreviation ?? '';

  // Interlinear availability is populated by useBibleStore when chapters load -
  // no separate IPC call needed (avoids multi-second IPC queue delay)
  const hasInterlinearData = interlinearByModule.get(currentAbbreviation) ?? false;
  const interlinearCheckComplete = interlinearByModule.has(currentAbbreviation);

  /**
   * Interlinear data for this chapter has been asked for but has not arrived.
   */
  const interlinearPending =
    studyOptions.showInterlinear && hasInterlinearData && (interlinearLoading || !interlinearResolved);

  /**
   * ANY of this chapter's study data is still in flight. While this holds, the
   * verses are not rendered at all (see below).
   *
   * Covering interlinear alone would be perverse: verses would be withheld
   * for the interlinear fetch, then painted bare and grow adornments as ~121
   * other round trips land one by one. Worse, the gate would unmount every
   * `VerseLinksDisplay`, so toggling Interlinear would re-run all of their
   * fetches. Both halves wait together so the pane paints once, fully
   * adorned.
   */
  const studyDataPending = interlinearPending || !studyData.resolved;
  // ...but a fetch that resolves quickly (warm cache, fast query) must not
  // flash a skeleton on its way past, so the placeholder itself only appears
  // once the wait exceeds useDeferredLoading's threshold.
  const showInterlinearSkeleton = useDeferredLoading(studyDataPending);

  // Fetch interlinear data when enabled (batch for entire chapter)
  useEffect(() => {
    if (!studyOptions.showInterlinear || !hasInterlinearData) {
      setInterlinearDataByVerse(new Map());
      setInterlinearLoading(false);
      setInterlinearResolved(false);
      return;
    }

    setInterlinearLoading(true);
    setInterlinearResolved(false);

    const fetchInterlinearData = async () => {
      try {
        // Use batch fetch for the whole chapter (single IPC call instead of N calls)
        const result = await bibleAPI.getInterlinearWordsForChapter(
          currentAbbreviation,
          currentBookNumber,
          currentChapter
        );

        // Convert plain object back to Map
        const dataMap = new Map<number, InterlinearWord[]>();
        for (const [verseIdStr, words] of Object.entries(result)) {
          const verseId = parseInt(verseIdStr);
          if (words && (words as InterlinearWord[]).length > 0) {
            dataMap.set(verseId, words as InterlinearWord[]);
          }
        }

        setInterlinearDataByVerse(dataMap);
      } catch (error) {
        console.error('[StudyModeView] Error fetching interlinear data for chapter:', error);
        setInterlinearDataByVerse(new Map());
      } finally {
        // Resolved either way: a failed fetch must still let the verses paint
        // (as plain text) rather than leaving the chapter blank forever.
        setInterlinearLoading(false);
        setInterlinearResolved(true);
      }
    };

    fetchInterlinearData();
  }, [currentBookNumber, currentChapter, studyOptions.showInterlinear, hasInterlinearData, currentAbbreviation]);

  // Scroll the selected verse into view once the verses first paint.
  //
  // The verses are not rendered at all while an interlinear fetch is in flight
  // (see the exclusive render branch below), so useBibleScrolling's own effect
  // - which runs as soon as the verse list renders - finds `selectedVerseRef`
  // still null and does nothing. Nothing re-fires it afterwards, so without
  // this the reader lands at the top of the chapter instead of on the verse
  // they navigated to.
  //
  // (This effect predates the loading gate, where it existed to *correct* a
  // scroll already applied against the short plain-text fallback before the
  // taller interlinear stack reflowed the page. That flash is gone; the effect
  // now supplies the first scroll rather than repairing one.)
  //
  // Gated to scrollMode === 'center': that mode means the verse arrived via an
  // explicit navigation (search result, history, cross-reference, verse link,
  // or opening a new tab straight to a verse). 'nearest' means the user merely
  // clicked an already-rendered verse - scrolling it out from under them after
  // an unrelated data fetch would be a surprising, unrequested jump.
  //
  // Deduped per scrollTrigger via the ref below so this fires at most once per
  // navigation and cannot fight a user who scrolled away on their own.
  /** This view's own subtree, so a verse lookup cannot reach another pane. */
  const rootRef = useRef<HTMLDivElement>(null);
  const reflowedScrollTriggerRef = useRef<number | null>(null);
  useEffect(() => {
    if (scrollMode !== 'center') return;
    // Not gated on `showInterlinear` any more: the verses are now withheld
    // until ALL of the chapter's study data lands, so a Study-mode tab with
    // interlinear off has the same "ref is still null when useBibleScrolling
    // runs" problem the interlinear path had.
    if (studyDataPending) return;
    if (reflowedScrollTriggerRef.current === scrollTrigger) return;
    reflowedScrollTriggerRef.current = scrollTrigger;

    // A previewed verse wins: following a link deliberately leaves the
    // selection where it was, so centring the selection would scroll to the
    // verse the reader came FROM. Found by id because `selectedVerseRef` is
    // attached only to the selected verse.
    const target = previewVerseId
      ? findVerseElement(rootRef.current, previewVerseId)
      : selectedVerseRef.current;
    if (!target) return;

    target.scrollIntoView({ behavior: 'auto', block: 'center' });
    if (previewVerseId) restartArrivalFlash(target);
  }, [studyDataPending, scrollTrigger, scrollMode, selectedVerseRef, previewVerseId]);

  const handleOptionsChange = (newOptions: Partial<StudyModeOptions>) => {
    setStudyOptions(tabId, newOptions);
  };


  /**
   * Click-to-select on the verse text itself, matching the web app. Ignored
   * when the click is what ended a drag-selection - see `isTextSelectionActive`.
   */
  const handleVerseTextClick = (verseId: number, extend: boolean) => {
    // A shift-click never creates a text selection of its own (its mousedown
    // is preventDefault-ed below), so the drag-select guard must not bail on a
    // stale one and swallow the gesture.
    if (!extend && isTextSelectionActive()) return;
    onVerseClick(verseId, extend);
  };

  /**
   * Stop Chromium turning shift+mousedown into "extend the caret selection to
   * here", which would sweep the intervening text - fighting the range wash
   * and leaving Ctrl+C to do a native copy instead of opening the dialog.
   */
  const handleVerseMouseDown = (e: React.MouseEvent) => {
    if (e.shiftKey) e.preventDefault();
  };

  return (
    <div className="px-xl py-lg" ref={rootRef}>
      <div className="max-w-4xl mx-auto">
        {/* Chapter Heading */}
        <h2 className="text-3xl font-bold text-text-heading mb-lg border-b border-border pb-sm">
          {currentBookName} {currentChapter}
        </h2>

        {/* Study Controls */}
        <StudyControls
          options={studyOptions}
          hasInterlinearData={hasInterlinearData}
          interlinearCheckComplete={interlinearCheckComplete}
          onOptionsChange={handleOptionsChange}
        />

        {/* Verses.
            While interlinear data is in flight the verses are replaced, not
            merely preceded, by the placeholder: painting the plain text first
            and then swapping in the much taller interlinear stacks reflowed
            the whole chapter under the reader. Mirrors the web app's
            `interlinearPending` branch in BibleContent.tsx. */}
        {studyDataPending ? (
          showInterlinearSkeleton ? <PaneLoadingSkeleton testId="interlinear-loading-skeleton" /> : null
        ) : (
        /*
          No `space-y-*` here: every verse row below carries its own `py-3`
          unconditionally (see the row's className), supplying the same 24px
          between two verses that `space-y-6` would. The padding must be
          unconditional - arriving only with `verse-selected` would grow a
          clicked verse's box by 24px and shove every verse after it down the
          page.
        */
        <div className={showRedLetter === false ? 'no-red-letter' : undefined}>
          {verses.map((verse) => {
            const isSelected = verse.verse_id === selectedVerseId;
            // Swept in by a shift-click, but not the anchor: washed-out fill.
            const isInRange = isInSelectedRange(verse.verse_id, selectedVerseId, selectionEndVerseId);
            const isPreview = previewVerseId !== null && previewVerseId !== undefined
              && verse.verse_id !== selectedVerseId
              && verse.verse_id >= previewVerseId
              && verse.verse_id <= (previewVerseEndId ?? previewVerseId);
            const isParagraphStart = verse.is_paragraph_start && verses.indexOf(verse) > 0;
            // verse.verse === 0: a chapter preface/superscription stored as a literal
            // verse 0 (legacy v1-style data) - no verse-number affordance.
            const isPreface = isPrefaceVerse(verse);
            // Module Format v2 attaches Psalm superscriptions and section headings to
            // the verse that follows them via formatting.sectionHeading rather than
            // storing them as a separate verse.
            const sectionHeading = getSectionHeading(verse);

            // Get interlinear data for this verse if enabled
            const interlinearWords = interlinearDataByVerse.get(verse.verse_id) || [];

            // Cross-references sourced from the installed cross-reference modules.
            const crossRefs = studyData.crossRefsByVerse.get(verse.verse_id) ?? [];
            const verseLinks = studyData.linksByVerse.get(verse.verse_id) ?? null;

            return (
              <div
                key={verse.verse_id}
                ref={isSelected ? selectedVerseRef as React.RefObject<HTMLDivElement> : null}
                data-testid={`verse-${verse.verse}`}
                data-verse-id={verse.verse_id}
                onContextMenu={onVerseContextMenu ? (e) => onVerseContextMenu(e, verse) : undefined}
                className={`
                  -mx-4 px-4 py-3
                  ${isParagraphStart ? 'mt-10' : ''}
                  ${isSelected ? 'verse-selected' : ''}
                  ${isInRange ? 'verse-in-range' : ''}
                  ${isPreview ? 'verse-preview' : ''}
                `}
              >
                {sectionHeading && (
                  <SectionHeadingBlock text={sectionHeading} className="pb-2" />
                )}
                {/* Verse number and text. `items-start` keeps the number on the
                    verse's first line; the flex default `stretch` would centre it
                    against the full height of a multi-line verse. */}
                <div className="flex items-start gap-4">
                  {!isPreface && (
                    <span
                      /* No hover fill: the verse text beside it is the click
                         target, and a second highlighted affordance on the
                         number implied it did something different. The handler
                         and the pointer cursor stay - it is still a way in. */
                      className="flex-shrink-0 w-10 text-end pe-2 cursor-pointer rounded text-lg font-bold text-text-secondary bidi-isolate"
                      onMouseDown={handleVerseMouseDown}
                      onClick={(e) => onVerseClick(verse.verse_id, e.shiftKey)}
                    >
                      {verse.verse}
                    </span>
                  )}

                  <div className={`flex-1 space-y-4 ${isPreface ? PREFACE_TEXT_CLASSNAME : ''}`}>
                    {/* Verse text (with or without interlinear).
                        The click target is this wrapper, NOT the whole verse
                        block: footnotes, cross-reference links and verse links
                        live below it and must keep their own click behaviour. */}
                    {/* `verse-row` is the hover affordance, not a layout box:
                        it tints on hover and turns the cursor into a pointer so
                        the click target announces itself. Its padding is
                        cancelled by an equal negative margin, so nothing moves. */}
                    <div
                      className="verse-row"
                      onMouseDown={handleVerseMouseDown}
                      onClick={(e) => handleVerseTextClick(verse.verse_id, e.shiftKey)}
                    >
                    {studyOptions.showInterlinear && interlinearWords.length > 0 ? (
                      // Both branches emit the same `.word[data-word-index]`
                      // spans over the same English word sequence, so
                      // highlighting, underlining and find-in-page behave
                      // identically with interlinear on or off. `text_html` (not
                      // `text`) is passed so the token sequence is byte-for-byte
                      // the one Standard/Reading index highlights against; see
                      // interlinearCells.ts for why interlinear positions live in
                      // that same index space.
                      <InterlinearDisplay
                        interlinearWords={interlinearWords}
                        englishText={verse.text_html || verse.text}
                        layout={studyOptions.interlinearLayout}
                        onStrongsClick={onStrongsClick}
                        verseId={verse.verse_id}
                        moduleId={moduleId}
                      />
                    ) : (
                      // HighlightedVerse (not raw dangerouslySetInnerHTML) so the
                      // per-word `.word[data-word-index]` spans exist here too -
                      // they are what drag-select maps a DOM Selection onto, and
                      // what existing highlights are painted into.
                      // `study-verse-text` (globals.css), not a Tailwind size:
                      // the verse has to stay larger than the study aids under
                      // it at every setting of the Fonts preferences and the
                      // Global Font Scale slider, which a flat `text-lg` (18px,
                      // below the pane's own 20px default) could not do.
                      <p className="study-verse-text">
                        <HighlightedVerse
                          verseId={verse.verse_id}
                          verseHTML={verse.text_html || verse.text}
                          moduleId={moduleId}
                        />
                      </p>
                    )}
                    </div>

                    {/* Footnotes for this verse */}
                    {studyOptions.showFootnotes && (
                      <FootnoteDisplay footnotes={getVerseFootnotes(verse)} />
                    )}

                    {/* Cross-references for this verse */}
                    {studyOptions.showCrossReferences && (
                      <CrossReferenceDisplay
                        moduleRefs={crossRefs}
                        // Navigates THIS panel to the referenced verse (which
                        // may be in another book), rather than merely selecting
                        // a verse in the chapter already on screen.
                        onNavigateToVerse={navigateToVerse}
                        showUserRefs={studyOptions.showUserCrossRefs}
                        userRefCount={verseLinks?.userRefCount ?? 0}
                      />
                    )}

                    {/* Verse Links (Study Mode Feature) */}
                    {/* Verse links are handed down, never fetched here: this
                        component is mounted once per verse, and its own fetches
                        were ~90 IPC calls per chapter that re-ran every time the
                        interlinear gate unmounted the list. */}
                    <VerseLinksDisplay
                      verseId={verse.verse_id}
                      links={verseLinks}
                      showCommentaryLinks={studyOptions.showCommentaryLinks}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>
    </div>
  );
};

/**
 * Get footnotes for a specific verse
 */
function getVerseFootnotes(verse: BibleVerse): Array<{ position: number; marker: string; text: string }> {
  if (!verse.formatting?.footnotes) {
    return [];
  }

  return verse.formatting.footnotes;
}

export default StudyModeView;
