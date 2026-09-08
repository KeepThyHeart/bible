import React from 'react';
import { useI18n } from '../contexts/useI18n';
import { useBiblePaneContext } from './BiblePaneContext';
import { useTextSettingsStore, getFontFamilyCSS } from '../stores/useTextSettingsStore';
import { useSessionStore } from '../stores/useSessionStore';
import { Panel, PanelGroup } from 'react-resizable-panels';
import ParallelBibleView from './ParallelBibleView';
import StudyModeView from './study/StudyModeView';
import { isTextSelectionActive } from '../utils/selectionUtils';
import { HighlightSelector } from './highlights/HighlightSelector';
import { HighlightedVerse } from './highlights/HighlightRenderer';
import BibleHeader from './BibleHeader';
import { directionForLanguage } from '../utils/textDirection';
import { isPrefaceVerse, getSectionHeading, SectionHeadingBlock, PREFACE_TEXT_CLASSNAME } from './bible/SectionHeading';
import PaneLoadingSkeleton from './onboarding/PaneLoadingSkeleton';
import { useDeferredLoading } from '../hooks/useDeferredLoading';
import { isInSelectedRange } from '../stores/bible/internals/verseRange';
import { useBookmarkStore } from '../stores/useBookmarkStore';
import { BookmarkIcon, BOOKMARK_COLOR } from './shared/icons/BookmarkIcon';

/**
 * The main content area of the Bible pane: renders verses in reading/standard/study
 * mode, and delegates to ParallelBibleView when parallel mode is active.
 *
 * Search results are not hosted here. They are a dockview panel in their own
 * right, which is what lets the user drag them into the study pane (and back)
 * and have that stick.
 */
const BibleVerseList: React.FC = () => {
  const { t } = useI18n();
  const ctx = useBiblePaneContext();
  // Marked in the text so a reader can see what they saved without opening
  // anything. A passage is marked at its opening verse - see `markedVerses`.
  const bookmarkedVerses = useBookmarkStore(s => s.bookmarkedVerses);
  const textSettings = useTextSettingsStore(state => state.getSettings('bible'));
  const isSessionLoaded = useSessionStore(state => state.isSessionLoaded);

  const {
    panelId,
    activeTab,
    openTabs,
    isParallelViewMode,
    currentBook,
    currentChapter,
    currentBookName,
    currentVerses,
    isLoading: rawIsLoading,
    error,
    displayMode,
    selectedVerseId,
    selectionEndVerseId,
    previewVerseId,
    previewVerseEndId,
    scrollTrigger,
    scrollMode,
    bibleTextRef,
    selectedVerseRef,
    handleMouseUpWithToolbar,
    setShowSelector,
    handleVerseClick,
    handleStrongsClick,
    handleVerseContextMenu,
    handleNoteIndicatorClick,
    handleNoteIndicatorHover,
    handleNoteIndicatorLeave,
    handleShowHighlightMenu,
    highlightRepository,
    versesWithNotes,
    availableBibles,
  } = ctx;

  // Brief chapter loads (cache hit, fast query) shouldn't flicker a loading
  // UI in at all - only fetches still running past 80ms show it.
  const isLoading = useDeferredLoading(rawIsLoading);

  /**
   * Is this verse part of the passage being previewed?
   *
   * A preview is a verse the reader followed a link to, not one they chose,
   * so it is marked but does not take the selection styling - and a real
   * selection wins if somehow both land on the same verse. See
   * `stores/bible/slices/previewSlice.ts`.
   */
  const isPreviewed = React.useCallback((verseId: number): boolean => {
    if (previewVerseId === null) return false;
    if (verseId === selectedVerseId) return false;
    const end = previewVerseEndId ?? previewVerseId;
    return verseId >= previewVerseId && verseId <= end;
  }, [previewVerseId, previewVerseEndId, selectedVerseId]);

  // Scripture follows the MODULE's writing direction, not the UI's. Someone
  // running an Arabic interface may have the KJV open (and vice versa), so the
  // text container carries its own `dir`/`lang`; everything inside - verse
  // numbers, alignment, the reading-mode indent - then resolves against the
  // content rather than the chrome. `data-content-dir` also gets
  // `unicode-bidi: isolate` from globals.css so a differing content direction
  // cannot reorder the surrounding UI.
  const activeBible = activeTab
    ? availableBibles.find((b) => b.abbreviation === activeTab.abbreviation)
    : undefined;
  const contentLang = activeBible?.language_code;
  const contentDir = directionForLanguage(contentLang);

  /**
   * Click-to-select that yields to a text drag.
   *
   * Dragging across the text in Standard mode must produce an ordinary text
   * selection for highlight/underline instead of being swallowed by verse
   * selection. That is enforced here rather than by omitting the handler: a
   * click that merely *ends* a non-collapsed selection is ignored
   * (`isTextSelectionActive`), while a plain click selects the verse, which is
   * what the web app does and what the user asked for.
   */
  const handleVerseBodyClick = (verseId: number, extend: boolean) => {
    // The drag-select guard must not swallow a shift-click. A shift-click's
    // mousedown is preventDefault-ed (see `handleVerseMouseDown`), so it never
    // creates a selection of its own - but one left over from an earlier drag
    // can still be sitting there, and bailing on it would make shift-click
    // silently do nothing.
    if (!extend && isTextSelectionActive()) return;
    handleVerseClick(verseId, extend);
  };

  /**
   * Shift-click must not also start a native text selection.
   *
   * Chromium treats shift+mousedown as "extend the caret selection to here",
   * which sweeps the intervening text: that fights the range wash visually
   * and, worse, leaves `window.getSelection()` non-empty, so Ctrl+C would
   * perform a plain text copy instead of opening the copy dialog. A plain
   * click is left completely alone, so dragging out a phrase still works.
   */
  const handleVerseMouseDown = (e: React.MouseEvent) => {
    if (e.shiftKey) e.preventDefault();
  };

  // Note indicator element shared between reading and standard modes
  const renderNoteIndicator = (verseId: number, sizeClass: string, mlClass: string) => (
    // A real <button>: this opens the note for the verse, and until now it was
    // a <span onClick> that no keyboard could reach.
    <button
      type="button"
      className="note-indicator inline cursor-pointer text-accent hover:text-accent-strong"
      aria-label={t('biblePane.openVerseNote')}
      onClick={(e) => handleNoteIndicatorClick(e, verseId)}
      onMouseEnter={(e) => handleNoteIndicatorHover(e, verseId)}
      onMouseLeave={handleNoteIndicatorLeave}
      /*
        No focus-triggered preview: the hover handler needs pointer
        coordinates to place the tooltip. Activating the button opens the note
        itself, which is the outcome the preview is a shortcut to.
      */
    >
      <svg className={`inline ${sizeClass} ${mlClass}`} aria-hidden="true" focusable="false" viewBox="0 0 512 512" fill="currentColor">
        <path d="M0 64C0 28.7 28.7 0 64 0H448c35.3 0 64 28.7 64 64V352c0 35.3-28.7 64-64 64H309.3L185.6 508.8c-4.8 3.6-11.3 4.2-16.8 1.5s-8.8-8.2-8.8-14.3V416H64c-35.3 0-64-28.7-64-64V64z" />
      </svg>
    </button>
  );

  /*
    Not a button. The ribbon reports state; every way to *change* that state is
    one gesture away already (the toolbar menu, Ctrl+D, the right-click menu),
    and a third click target in the text - inline with the words, next to the
    note indicator that does open something - would be a coin flip as to what
    it did.
  */
  const renderBookmarkIndicator = (sizeClass: string, mlClass: string) => (
    <span
      role="img"
      aria-label={t('biblePane.verseBookmarked')}
      title={t('biblePane.verseBookmarked')}
      className="bookmark-indicator inline"
      style={{ color: BOOKMARK_COLOR }}
    >
      <BookmarkIcon marked className={`inline ${sizeClass} ${mlClass}`} />
    </span>
  );

  /**
   * The trailing indicators for a verse, or undefined when it has none.
   *
   * `HighlightedVerse` takes a single `suffix`, so note and bookmark markers
   * are composed here rather than each fighting for the slot.
   */
  const renderVerseIndicators = (verseId: number, sizeClass: string, mlClass: string) => {
    const hasNote = versesWithNotes.has(verseId);
    const hasBookmark = bookmarkedVerses.has(verseId);
    if (!hasNote && !hasBookmark) return undefined;
    return (
      <>
        {hasNote && renderNoteIndicator(verseId, sizeClass, mlClass)}
        {hasBookmark && renderBookmarkIndicator(sizeClass, mlClass)}
      </>
    );
  };

  return (
    <div className="flex-1 overflow-hidden">
      <PanelGroup direction="vertical" className="h-full" id={`bible-split-${panelId}`}>
        {/* Bible text panel - the only panel in this group. Search results are
            a dockview panel of their own (see
            useLayoutStore.openSearchResultsPanel), which is what lets the user
            drag them into the study pane and back. */}
        <Panel
          defaultSize={100}
          minSize={100}
          className="flex flex-col"
        >
          {/* Content Area */}
          <div
            ref={bibleTextRef as React.RefObject<HTMLDivElement>}
            dir={contentDir}
            lang={contentLang}
            data-content-dir={contentDir}
            className={`flex-1 overflow-auto pane-content-bible relative ${textSettings.showRedLetter === false ? 'no-red-letter' : ''}`}
            style={{
              '--pane-font-family-bible': getFontFamilyCSS(textSettings.fontFamily),
              '--pane-font-size-bible': `${textSettings.fontSize}px`,
              '--pane-line-height-bible': textSettings.lineHeight
            } as React.CSSProperties}
            onMouseUp={handleMouseUpWithToolbar}
          >
            {isParallelViewMode ? (
              <ParallelBibleView panelId={panelId} />
            ) : openTabs.length === 0 ? (
              // Session restore hasn't resolved yet: we don't yet know whether
              // this panel will end up with a tab, so show a neutral skeleton
              // instead of "no translation open" (which would otherwise flash
              // on every startup, between first paint and session restore).
              !isSessionLoaded ? (
                <PaneLoadingSkeleton testId="bible-loading-skeleton" />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-text-secondary">
                  <p className="mb-md">{t('biblePane.noTranslationOpen')}</p>
                  <button
                    type="button"
                    className="px-lg py-md bg-accent text-text-on-accent rounded hover:bg-accent-hover"
                    onClick={() => setShowSelector(true)}
                  >
                    {t('biblePane.selectTranslation')}
                  </button>
                </div>
              )
            ) : isLoading && currentVerses.length === 0 ? (
              // First-ever load for this tab (session restore, or a brand-new
              // tab whose chapter fetch hasn't resolved yet): loadingByTab is
              // now seeded true at the same moment openTabs is published (see
              // sessionSlice.restorePanelFromSession), so this branch - not
              // the currentVerses.length === 0 empty state below - is what
              // catches that window. Reuses the same skeleton shown above for
              // "session restore hasn't resolved" so the two indistinguishable
              // loading gaps look identical instead of one flashing empty text.
              <PaneLoadingSkeleton testId="bible-loading-skeleton" />
            ) : isLoading ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-text-secondary">{t('biblePane.loadingBibleText')}</div>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-full" role="alert">
                <div className="text-danger mb-md">{error}</div>
                <div className="text-sm text-text-secondary">
                  {t('biblePane.errorHint')}
                </div>
              </div>
            ) : currentVerses.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-text-secondary">{t('biblePane.noVersesLoaded')}</div>
              </div>
            ) : displayMode === 'study' ? (
              // Study mode needs the same HighlightSelector wrapper as
              // Standard/Reading. Without it the drag-select handler never
              // mounts over these verses, so selecting text in Study mode
              // produced no floating toolbar and existing highlights never
              // rendered - highlighting appeared completely broken in this mode
              // while working fine in the other two.
              <HighlightSelector
                moduleId={activeTab!.moduleId ?? 0}
                repository={highlightRepository}
                onShowMenu={handleShowHighlightMenu}
              >
                <StudyModeView
                  verses={currentVerses}
                  panelId={panelId}
                  tabId={activeTab!.tabId}
                  currentBookNumber={currentBook}
                  currentBookName={currentBookName}
                  currentChapter={currentChapter}
                  selectedVerseId={selectedVerseId}
                  selectionEndVerseId={selectionEndVerseId}
                  previewVerseId={previewVerseId}
                  previewVerseEndId={previewVerseEndId}
                  onVerseClick={handleVerseClick}
                  onVerseContextMenu={handleVerseContextMenu}
                  onStrongsClick={handleStrongsClick}
                  showRedLetter={textSettings.showRedLetter}
                  moduleId={activeTab!.moduleId ?? 0}
                  selectedVerseRef={selectedVerseRef}
                  scrollTrigger={scrollTrigger}
                  scrollMode={scrollMode}
                />
              </HighlightSelector>
            ) : (
              // Standard/Reading modes with highlighting support
              <>
                <div className="px-xl py-lg">
                <div className="max-w-3xl mx-auto bible-text">
                  {/* Chapter Heading */}
                  <BibleHeader />

                  {/* Verses wrapped in HighlightSelector for drag-to-highlight */}
                  <HighlightSelector
                    moduleId={activeTab!.moduleId ?? 0}
                    repository={highlightRepository}
                    onShowMenu={handleShowHighlightMenu}
                  >
                    {displayMode === 'reading' ? (
                      // Reading mode: continuous, book-like prose. No verse numbers,
                      // no per-verse borders/boxes. Paragraph breaks in the underlying
                      // data (verse.is_paragraph_start) start a new indented paragraph.
                      <div
                        className="reading-mode"
                        style={{ lineHeight: 1.8, textAlign: 'justify' }}
                      >
                        {(() => {
                          // Group consecutive verses into paragraphs. The first verse of
                          // the chapter always starts a paragraph; subsequent verses do so
                          // whenever is_paragraph_start is true.
                          const paragraphs: (typeof currentVerses)[] = [];
                          currentVerses.forEach((verse, i) => {
                            if (i === 0 || verse.is_paragraph_start) {
                              paragraphs.push([verse]);
                            } else {
                              paragraphs[paragraphs.length - 1].push(verse);
                            }
                          });

                          return paragraphs.map((para, pi) => {
                            // Section headings (Psalm superscriptions, "The Beatitudes", etc.)
                            // ride on the paragraph's first verse (verse.formatting.sectionHeading,
                            // sourced from Module Format v2's formatting.block.heading) rather than
                            // as a separate verse, so render it as a block above the paragraph.
                            const headingText = para[0] ? getSectionHeading(para[0]) : undefined;
                            return (
                              <React.Fragment key={pi}>
                                {headingText && (
                                  <SectionHeadingBlock text={headingText} className="mt-lg mb-xs first:mt-0" />
                                )}
                                <p
                                  className="mb-md"
                                  style={{ textIndent: pi === 0 ? 0 : '1.5em' }}
                                >
                                  {para.map((verse, vi) => {
                                    const isSelected = verse.verse_id === selectedVerseId;
                                    // Swept in by a shift-click, but not the anchor: rendered
                                    // as a washed-out version of the selection fill.
                                    const isInRange = isInSelectedRange(verse.verse_id, selectedVerseId, selectionEndVerseId);
                                    const isPreview = isPreviewed(verse.verse_id);
                                    // verse.verse === 0: a chapter preface/superscription stored
                                    // as a literal verse 0 (legacy v1-style data). Style it as
                                    // secondary/italic like a heading rather than body text.
                                    const isPreface = isPrefaceVerse(verse);
                                    return (
                                      <React.Fragment key={verse.verse_id}>
                                        <span
                                          ref={isSelected ? selectedVerseRef as any : null}
                                          className={`verse-row ${isSelected ? 'verse-selected' : ''} ${isInRange ? 'verse-in-range' : ''} ${isPreview ? 'verse-preview' : ''} ${isPreface ? PREFACE_TEXT_CLASSNAME : ''}`}
                                          data-verse-id={verse.verse_id}
                                          data-testid={`verse-${verse.verse}`}
                                          onMouseDown={handleVerseMouseDown}
                                          onClick={(e) => handleVerseBodyClick(verse.verse_id, e.shiftKey)}
                                          onContextMenu={(e) => handleVerseContextMenu(e, verse)}
                                        >
                                          <HighlightedVerse
                                            verseId={verse.verse_id}
                                            verseHTML={verse.text_html || verse.text}
                                            moduleId={activeTab!.moduleId ?? 0}
                                            suffix={renderVerseIndicators(verse.verse_id, 'w-3 h-3', 'ms-0.5')}
                                          />
                                        </span>
                                        {vi < para.length - 1 && ' '}
                                      </React.Fragment>
                                    );
                                  })}
                                </p>
                              </React.Fragment>
                            );
                          });
                        })()}
                      </div>
                    ) : (
                      // Standard mode: verse numbers on left, each verse on new line
                      // `space-y-1`, not `space-y-2`: every row carries 2px of
                      // its own vertical padding (see `.verse-row`), so the gap
                      // between two verses stays 8px and does not appear out of
                      // nowhere when a verse is selected.
                      <div className="space-y-1">
                        {currentVerses.map((verse, index) => {
                          const isSelected = verse.verse_id === selectedVerseId;
                          // Swept in by a shift-click, but not the anchor.
                          const isInRange = isInSelectedRange(verse.verse_id, selectedVerseId, selectionEndVerseId);
                          const isPreview = isPreviewed(verse.verse_id);
                          const isParagraphStart = verse.is_paragraph_start && index > 0;
                          // verse.verse === 0: a chapter preface/superscription stored as a
                          // literal verse 0 (legacy v1-style data) - no verse-number affordance,
                          // styled as secondary/italic like a heading rather than body text.
                          const isPreface = isPrefaceVerse(verse);
                          // Module Format v2 attaches Psalm superscriptions and section
                          // headings ("The Beatitudes") to the verse that follows them via
                          // formatting.block.heading (projected here as formatting.sectionHeading)
                          // rather than storing them as a separate verse.
                          const sectionHeading = getSectionHeading(verse);

                          return (
                            <React.Fragment key={verse.verse_id}>
                              {sectionHeading && (
                                <SectionHeadingBlock
                                  text={sectionHeading}
                                  className={`px-1 pb-1 ${index > 0 ? 'pt-lg' : ''}`}
                                />
                              )}
                              {/*
                                `items-start` (rather than the flex default `stretch`):
                                otherwise the verse-number button is stretched to the
                                full height of a multi-line verse and its numeral
                                centers vertically instead of sitting on the first line.
                              */}
                              <div
                                ref={isSelected ? selectedVerseRef as React.RefObject<HTMLDivElement> : null}
                                className={`verse-row flex items-start ${isParagraphStart ? 'mt-10' : ''} ${
                                  isSelected ? 'verse-selected' : ''
                                } ${isInRange ? 'verse-in-range' : ''} ${isPreview ? 'verse-preview' : ''} ${isPreface ? PREFACE_TEXT_CLASSNAME : ''}`}
                                data-verse-id={verse.verse_id}
                                data-testid={`verse-${verse.verse}`}
                                aria-current={isSelected ? 'true' : undefined}
                                /* Whole row, so the verse TEXT selects the verse
                                   too - not just the number. Guarded against
                                   drag-selection; the note indicator inside
                                   stops propagation and keeps its own action. */
                                onMouseDown={handleVerseMouseDown}
                                onClick={(e) => handleVerseBodyClick(verse.verse_id, e.shiftKey)}
                                onContextMenu={(e) => handleVerseContextMenu(e, verse)}
                              >
                                {!isPreface && (
                                  /*
                                    The whole row selects the verse (see handleVerseBodyClick),
                                    so this is not a click target in its own right - it
                                    carries no onClick and no hover treatment, because a second
                                    affordance on the number implied it did something the rest
                                    of the row did not. It stays a real <button> purely as the
                                    KEYBOARD target: Tab reaches it and Enter/Space fires a
                                    native click that bubbles to the row's handler. The bare
                                    numeral is not a name, so it is labelled with the full
                                    reference.

                                    `w-11` rather than anything wider: a wider gutter leaves an
                                    obvious channel of dead space between the numeral and the
                                    text, and the numeral reads as floating off to the left of
                                    the verse.
                                  */
                                  <button
                                    type="button"
                                    className="flex-shrink-0 w-11 text-end pe-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                    aria-label={t(
                                      'biblePane.selectVerse',
                                      { book: currentBookName, chapter: currentChapter, verse: verse.verse, },
                                    )}
                                  >
                                    {/* <bdi> rather than a bare <span>: a bare
                                        numeral is weak-directional, so in RTL
                                        scripture it would otherwise merge with
                                        neighbouring digits/punctuation and be
                                        reordered out of its column. */}
                                    <bdi
                                      aria-hidden="true"
                                      className="text-lg font-bold text-accent inline-block py-1"
                                    >
                                      {verse.verse}
                                    </bdi>
                                  </button>
                                )}
                                <HighlightedVerse
                                  verseId={verse.verse_id}
                                  verseHTML={verse.text_html || verse.text}
                                  moduleId={activeTab!.moduleId ?? 0}
                                  suffix={renderVerseIndicators(verse.verse_id, 'w-3.5 h-3.5', 'ms-1')}
                                />
                              </div>
                            </React.Fragment>
                          );
                        })}
                      </div>
                    )}
                  </HighlightSelector>
                </div>
                </div>
              </>
            )}
          </div>
        </Panel>

      </PanelGroup>
    </div>
  );
};

export default BibleVerseList;
