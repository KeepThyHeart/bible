import React, { useEffect, useState, useCallback } from 'react';
import { useI18n } from '../../contexts/useI18n';
import { useBookStore, type BookSection, type BookSectionSummary } from '../../stores/useBookStore';
import { useTextSettingsStore, getFontFamilyCSS } from '../../stores/useTextSettingsStore';
import { useDeferredLoading } from '../../hooks/useDeferredLoading';
import { bookAPI } from '../../services/electronAPI';
import BookTreeView from '../BookTreeView';
import PassageSettingsMenu from '../bible/PassageSettingsMenu';
import PaneLoadingSkeleton from '../onboarding/PaneLoadingSkeleton';
import type { DockviewPanelApi } from 'dockview-react';
import { cleanModuleName } from '../../utils/verseFormatting';
import { sanitizeHtml } from '../../utils/sanitize';
import { moveIntoBooksPane } from '../BookPane/moveIntoBooksPane';

interface BookSinglePanelProps {
  /** Dockview panel ID */
  panelId?: string;
  /** Dockview panel API for updating tab title */
  dockviewPanelApi?: DockviewPanelApi;
  /** The book module abbreviation */
  contentKey: string;
}

/**
 * Lightweight single-book panel.
 *
 * Displays one book module with section navigation.
 * No tab bar, no module selector - just the content with navigation.
 */
const BookSinglePanel: React.FC<BookSinglePanelProps> = ({
  panelId,
  dockviewPanelApi,
  contentKey: abbreviation,
}) => {
  const { t } = useI18n();
  const [currentSection, setCurrentSection] = useState<BookSection | null>(null);
  const [sectionSummaries, setSectionSummaries] = useState<BookSectionSummary[]>([]);
  const [childSections, setChildSections] = useState<BookSectionSummary[]>([]);
  const [rawIsLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTreeView, setShowTreeView] = useState(false);
  const [summariesLoading, setSummariesLoading] = useState(false);
  const [summariesError, setSummariesError] = useState<string | null>(null);
  const [nextSectionInfo, setNextSectionInfo] = useState<{ section_id: number; title: string; section_number?: string } | null>(null);
  const [prevSectionInfo, setPrevSectionInfo] = useState<{ section_id: number; title: string; section_number?: string } | null>(null);

  const textSettings = useTextSettingsStore(state => state.getSettings('book'));
  // Section reads are usually sub-100ms; without the debounce every navigation
  // blanked the whole panel for a frame or two.
  const isLoading = useDeferredLoading(rawIsLoading);

  /*
    Module name resolution subscribes to the catalog rather than reading it once
    on mount. This panel is restored from the session, often before any pane has
    populated `availableBooks` - a one-shot read found nothing and left the raw
    abbreviation on screen for the rest of the run.
  */
  const availableBooks = useBookStore(s => s.availableBooks);
  const loadAvailableBooks = useBookStore(s => s.loadAvailableBooks);
  useEffect(() => {
    if (availableBooks.length === 0) loadAvailableBooks();
  }, [availableBooks.length, loadAvailableBooks]);
  const moduleName = availableBooks.find(b => b.abbreviation === abbreviation)?.name
    ?? cleanModuleName(abbreviation);

  // Update dockview tab title when section changes
  useEffect(() => {
    if (dockviewPanelApi && currentSection) {
      const title = currentSection.section_number
        ? `${moduleName} - ${currentSection.section_number}. ${currentSection.title}`
        : `${moduleName} - ${currentSection.title}`;
      dockviewPanelApi.setTitle(title);
    }
  }, [dockviewPanelApi, currentSection, moduleName]);

  // Load a specific section
  const loadSection = useCallback(async (sectionId: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const section = await bookAPI.getSection(abbreviation, sectionId);
      setCurrentSection(section);

      // Load child sections
      const children = await bookAPI.getSectionsByParent(abbreviation, sectionId);
      setChildSections(children.map(s => ({
        section_id: s.section_id!,
        parent_section_id: s.parent_section_id,
        section_number: s.section_number,
        title: s.title,
        word_count: s.word_count,
        has_children: false,
      })));

      // Load nav sections
      const [next, prev] = await Promise.all([
        bookAPI.getNextSection(abbreviation, sectionId).catch(() => null),
        bookAPI.getPreviousSection(abbreviation, sectionId).catch(() => null),
      ]);
      setNextSectionInfo(next?.section_id ? { section_id: next.section_id, title: next.title, section_number: next.section_number } : null);
      setPrevSectionInfo(prev?.section_id ? { section_id: prev.section_id, title: prev.title, section_number: prev.section_number } : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('bookSinglePanel.loadSectionFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [abbreviation, t]);

  /** Loads the table of contents on its own, so a failure here is retryable and doesn't blank the book. */
  const loadSummaries = useCallback(async () => {
    setSummariesLoading(true);
    setSummariesError(null);
    try {
      setSectionSummaries(await bookAPI.getAllSectionSummaries(abbreviation));
    } catch (err) {
      setSectionSummaries([]);
      setSummariesError(err instanceof Error ? err.message : t('bookSinglePanel.loadContentsFailed'));
    } finally {
      setSummariesLoading(false);
    }
  }, [abbreviation, t]);

  // Initial load: top-level sections + summaries
  useEffect(() => {
    loadSummaries();
    const init = async () => {
      setIsLoading(true);
      try {
        const topSections = await bookAPI.getTopLevelSections(abbreviation);

        if (topSections.length > 0 && topSections[0].section_id) {
          setCurrentSection(topSections[0]);
          // Load children of first section
          const children = await bookAPI.getSectionsByParent(abbreviation, topSections[0].section_id);
          setChildSections(children.map(s => ({
            section_id: s.section_id!,
            parent_section_id: s.parent_section_id,
            section_number: s.section_number,
            title: s.title,
            word_count: s.word_count,
            has_children: false,
          })));
          // Load nav
          const next = await bookAPI.getNextSection(abbreviation, topSections[0].section_id).catch(() => null);
          setNextSectionInfo(next?.section_id ? { section_id: next.section_id, title: next.title, section_number: next.section_number } : null);
          setPrevSectionInfo(null);
        } else {
          setError(t('bookSinglePanel.noSectionsFound'));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('bookSinglePanel.loadBookFailed'));
      } finally {
        setIsLoading(false);
      }
    };
    init();
  }, [abbreviation, loadSummaries, t]);

  const handleNavigateNext = () => {
    if (nextSectionInfo) loadSection(nextSectionInfo.section_id);
  };

  const handleNavigatePrev = () => {
    if (prevSectionInfo) loadSection(prevSectionInfo.section_id);
  };

  /**
   * The return leg of "Open in own panel": put this book back in the Books
   * pane as a tab, on the section currently open, and close this panel.
   */
  const handleMoveIntoBooksPane = useCallback(() => {
    moveIntoBooksPane({
      type: 'book',
      abbreviation,
      name: moduleName,
      sectionId: currentSection?.section_id ?? null,
      sourcePanelId: panelId,
    });
  }, [abbreviation, moduleName, currentSection, panelId]);

  const handleShowTreeView = () => {
    // A previous failure is retried by opening the dialog again, which is the
    // only affordance the user has for it.
    if (summariesError && !summariesLoading) loadSummaries();
    setShowTreeView(true);
  };

  // Build breadcrumbs
  const buildBreadcrumbs = (): Array<{ section_id: number; title: string; section_number?: string }> => {
    if (!currentSection?.section_id) return [];
    const crumbs: Array<{ section_id: number; title: string; section_number?: string }> = [];
    let currentId: number | undefined = currentSection.section_id;
    while (currentId) {
      const s = sectionSummaries.find(x => x.section_id === currentId);
      if (!s) break;
      crumbs.unshift({ section_id: s.section_id, title: s.title, section_number: s.section_number });
      currentId = s.parent_section_id;
    }
    return crumbs;
  };

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: 'var(--theme-bg-primary)' }}>
      {/*
        Navigation toolbar. Rendered whether or not a section loaded: it also
        carries "Move into Books pane" and the contents dialog, which are the
        two ways out of a book that failed to load - hiding it left the error
        state with no controls at all.
      */}
      <div className="flex items-center justify-between px-md py-sm border-b border-border bg-background">
        <div className="flex items-center gap-sm">
          <button
            type="button"
            onClick={handleNavigatePrev}
            disabled={isLoading || !prevSectionInfo}
            className="px-sm py-xs rounded hover:bg-background-warm disabled:opacity-50 disabled:cursor-not-allowed"
            title={prevSectionInfo
              ? t('bookSinglePanel.previousSectionTo', { title: prevSectionInfo.title })
              : t('bookSinglePanel.noPreviousSection')}
          >
            &#9664;
          </button>
          <button
            type="button"
            onClick={handleNavigateNext}
            disabled={isLoading || !nextSectionInfo}
            className="px-sm py-xs rounded hover:bg-background-warm disabled:opacity-50 disabled:cursor-not-allowed"
            title={nextSectionInfo
              ? t('bookSinglePanel.nextSectionTo', { title: nextSectionInfo.title })
              : t('bookSinglePanel.noNextSection')}
          >
            &#9654;
          </button>
        </div>
        <div className="flex items-center gap-sm">
          <span className="text-sm text-text-secondary">{moduleName}</span>
          <button
            type="button"
            onClick={handleMoveIntoBooksPane}
            className="px-md py-xs text-sm rounded hover:bg-background-warm transition-colors"
            title={t('bookSinglePanel.moveIntoBooksPaneTitle')}
            data-testid="book-single-move-into-books"
          >
            {t('bookSinglePanel.moveIntoBooksPane')}
          </button>
          <button
            onClick={handleShowTreeView}
            className="px-md py-xs text-sm rounded hover:bg-background-warm transition-colors"
            title={t('bookSinglePanel.tocTitle')}
          >
            📋 {t('bookSinglePanel.contentsButton')}
          </button>
          {/* The shared gear, not a fourth hand-rolled "Aa" box. See
              `bible/PassageSettingsMenu`. */}
          <PassageSettingsMenu paneKey="book" />
        </div>
      </div>

      {/* Content Area */}
      <div
        className="flex-1 overflow-auto pane-content-book"
        style={{
          '--pane-font-family-book': getFontFamilyCSS(textSettings.fontFamily),
          '--pane-font-size-book': `${textSettings.fontSize}px`,
          '--pane-line-height-book': textSettings.lineHeight
        } as React.CSSProperties}
      >
        {isLoading ? (
          <PaneLoadingSkeleton testId="book-single-loading-skeleton" />
        ) : error ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-danger">{error}</div>
          </div>
        ) : !currentSection ? (
          <div className="flex items-center justify-center h-full text-text-secondary">
            <p>{t('bookSinglePanel.noSectionLoaded')}</p>
          </div>
        ) : (
          <div className="px-xl py-lg max-w-4xl mx-auto">
            {/* Breadcrumbs */}
            {sectionSummaries.length > 0 && (() => {
              const breadcrumbs = buildBreadcrumbs();
              return breadcrumbs.length > 0 && (
                <div className="flex items-center flex-wrap mb-md text-sm">
                  {breadcrumbs.map((crumb, index) => (
                    <React.Fragment key={crumb.section_id}>
                      {index > 0 && <span className="text-text-secondary mx-xs">{'\u203A'}</span>}
                      <button
                        onClick={() => loadSection(crumb.section_id)}
                        className={`hover:underline transition-colors whitespace-nowrap ${
                          index === breadcrumbs.length - 1
                            ? 'text-accent font-semibold'
                            : 'text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        {crumb.section_number ? `${crumb.section_number}. ` : ''}{crumb.title}
                      </button>
                    </React.Fragment>
                  ))}
                </div>
              );
            })()}

            {/* Section header */}
            <div className="mb-lg">
              {currentSection.section_number && (
                <div className="text-sm text-text-secondary mb-xs">
                  {t('bookSinglePanel.sectionLabel', { number: currentSection.section_number })}
                </div>
              )}
              <h2 className="text-2xl font-semibold text-text-heading">
                {currentSection.title}
              </h2>
            </div>

            {/* Child sections */}
            {childSections.length > 0 && (
              <div className="mb-lg border-s-4 border-accent ps-md py-sm bg-background-warm">
                <h3 className="text-lg font-semibold text-text-heading mb-sm">{t('bookSinglePanel.contentsHeading')}</h3>
                <ul className="space-y-xs">
                  {childSections.map(child => (
                    <li key={child.section_id}>
                      <button
                        onClick={() => loadSection(child.section_id)}
                        className="text-start w-full px-sm py-xs rounded hover:bg-background transition-colors text-accent hover:underline"
                      >
                        {child.section_number && <span className="text-text-secondary me-sm">{child.section_number}.</span>}
                        <span>{child.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Content */}
            <div
              className="prose prose-lg max-w-none leading-relaxed"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(currentSection.content) }}
            />

            {/* Bottom navigation */}
            {(prevSectionInfo || nextSectionInfo) && (
              <div className="flex items-center justify-between mt-2xl pt-lg border-t border-border">
                {prevSectionInfo ? (
                  <button
                    onClick={() => loadSection(prevSectionInfo.section_id)}
                    className="flex items-start gap-sm text-start hover:bg-background-warm p-md rounded transition-colors max-w-[45%]"
                  >
                    <span className="text-2xl text-text-secondary">{'\u2190'}</span>
                    <div>
                      <div className="text-xs text-text-secondary mb-xs">{t('bookSinglePanel.previous')}</div>
                      <div className="text-sm text-accent hover:underline">
                        {prevSectionInfo.section_number && <span className="text-text-secondary me-xs">{prevSectionInfo.section_number}.</span>}
                        {prevSectionInfo.title}
                      </div>
                    </div>
                  </button>
                ) : <div />}
                {nextSectionInfo ? (
                  <button
                    onClick={() => loadSection(nextSectionInfo.section_id)}
                    className="flex items-start gap-sm text-end hover:bg-background-warm p-md rounded transition-colors max-w-[45%]"
                  >
                    <div>
                      <div className="text-xs text-text-secondary mb-xs">{t('bookSinglePanel.next')}</div>
                      <div className="text-sm text-accent hover:underline">
                        {nextSectionInfo.section_number && <span className="text-text-secondary me-xs">{nextSectionInfo.section_number}.</span>}
                        {nextSectionInfo.title}
                      </div>
                    </div>
                    <span className="text-2xl text-text-secondary">{'\u2192'}</span>
                  </button>
                ) : <div />}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tree View Modal - renders whenever asked for; it owns its loading/empty/error states */}
      {showTreeView && (
        <BookTreeView
          abbreviation={abbreviation}
          summaries={sectionSummaries}
          currentSectionId={currentSection?.section_id ?? null}
          isLoading={summariesLoading}
          error={summariesError}
          onRetry={loadSummaries}
          onSelectSection={(sectionId) => {
            loadSection(sectionId);
            setShowTreeView(false);
          }}
          onClose={() => setShowTreeView(false)}
        />
      )}
    </div>
  );
};

export default BookSinglePanel;
