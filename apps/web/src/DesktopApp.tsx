import { useState, useCallback, useEffect } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { BiblePane } from './components/BiblePane/BiblePane';
import { CommentaryPane } from './components/CommentaryPane/CommentaryPane';
import { SearchResultsPanel } from './components/Search/SearchResultsPanel';
import { StudyPane } from './components/StudyPane/StudyPane';
import { TopicsPane } from './components/StudyPane/TopicsPane';
import { DictionaryPane } from './components/DictionaryPane/DictionaryPane';
import { Header } from './components/Header';
import { ResizeHandle } from './components/common/ResizeHandle';
import { DialogLayer } from './components/common/DialogLayer';
import { ContextMenuPopup } from './components/common/ContextMenuPopup';
import { ConnectionBanner } from './components/ConnectionBanner';
import { PresentBar } from './components/Present/PresentBar';
import { commentaryStore, RENDERABLE_PANE_MODES } from './stores/commentaryStore';
import { parseVerseId } from './utils/verseId';
import { dictionaryStore } from './stores/dictionaryStore';
import { bibleStore } from './stores/bibleStore';
import { searchStore } from './stores/searchStore';
import { useAppShared } from './hooks/useAppShared';
import { useContextMenu } from './hooks/useContextMenu';
import type { IDataProviders } from './providers/interfaces';

interface DesktopAppProps {
  providers: IDataProviders;
}

export function DesktopApp({ providers }: DesktopAppProps) {
  const shared = useAppShared(providers);
  const { t } = useTranslation();
  const [showTagGraph, setShowTagGraph] = useState(false);
  const [biblePaneWidth, setBiblePaneWidth] = useState(60);

  // Fetch server-controlled showTagGraph setting once on mount
  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(cfg => {
      setShowTagGraph(cfg.showTagGraph === true);
    }).catch(() => { /* leave as false */ });
  }, []);

  // Auto-switch to search mode when a search is performed, and force the pane
  // open. Keyed off `searchSeq` as well as `isOpen` so that a second search runs
  // this even when the results were already "open" behind the Commentary or
  // Dictionary tab — otherwise pressing Enter appears to do nothing.
  useEffect(() => {
    if (shared.searchIsOpen) {
      commentaryStore.setRightPaneMode('search');
      commentaryStore.expand();
    }
  }, [shared.searchIsOpen, shared.searchSeq]);

  const handleResize = useCallback((deltaX: number) => {
    setBiblePaneWidth(prev => {
      const containerWidth = document.querySelector('.main-layout')?.clientWidth || window.innerWidth;
      const deltaPercent = (deltaX / containerWidth) * 100;
      return Math.max(30, Math.min(80, prev + deltaPercent));
    });
  }, []);

  const handleStrongsClick = useCallback(async (strongsNumber: string) => {
    // Dismiss any existing tooltip/popup
    shared.setStrongsPopup(null);
    shared.handleStrongsLeave();
    // Open in Dictionary tab instead of popup
    commentaryStore.setRightPaneMode('dictionary');
    commentaryStore.expand();
    dictionaryStore.openStrongs(strongsNumber);
  }, [shared]);

  const { contextMenu, contextMenuRef, handleContextMenuAction } = useContextMenu(
    shared.findVerseAtPoint,
    shared.setCopyOpen,
  );

  // The Search tab exists only while a search is open, and `pane:show` lets a
  // plugin put any id in rightPaneMode. Resolve to a mode the strip actually has
  // a tab for, rather than rendering a right pane with nothing highlighted and
  // no content — which is what made a remembered Search pane look broken.
  const paneMode = shared.rightPaneMode === 'search'
    ? (shared.searchIsOpen ? 'search' : 'study')
    : ((RENDERABLE_PANE_MODES as readonly string[]).includes(shared.rightPaneMode) ? shared.rightPaneMode : 'study');

  // Self-heal the persisted value so a bad id does not survive another reload.
  useEffect(() => {
    if (paneMode !== shared.rightPaneMode) commentaryStore.setRightPaneMode(paneMode);
  }, [paneMode, shared.rightPaneMode]);

  const showRightPane = !shared.collapsed;

  const bibleStyle = {
    fontFamily: shared.fontFamily,
    fontSize: `${shared.fontSize}px`,
    lineHeight: String(shared.lineHeight),
    '--heading-font': shared.headingFontFamily,
    ...(showRightPane ? { width: `${biblePaneWidth}%`, flex: 'none' } : {}),
  } as Record<string, string>;

  // No `fontSize` here: the Study text size is published as `--study-font-size`
  // on <html> by settingsStore, and `.main-layout__right-pane` reads it. One
  // mechanism — an inline size here would only have governed the elements that
  // set no size of their own.
  const rightPaneStyle = {
    fontFamily: shared.studyFontFamily,
    lineHeight: String(shared.studyLineHeight),
    width: `${100 - biblePaneWidth}%`,
  };

  return (
    <div class="app">
      <Header
        onSettingsClick={(section) => shared.openSettings(section)}
        onHelpClick={() => shared.setHelpOpen(true)}
        onFeedbackClick={() => shared.setFeedbackOpen(true)}
      />
      <ConnectionBanner />
      <div class="main-layout">
        <div class="main-layout__bible" style={bibleStyle}>
          <BiblePane
            interlinearProvider={providers.interlinear}
            strongsProvider={providers.strongs}
            onStrongsClick={handleStrongsClick}
            onStrongsHover={shared.handleStrongsHover}
            onStrongsLeave={shared.handleStrongsLeave}
            onOpenSettings={shared.openSettings}
            onCopyVerse={(verseId) => {
              bibleStore.adoptPreviewAsStudy(verseId);
              shared.setCopyOpen(true);
            }}
            onCommentaryVerse={(verseId) => {
              bibleStore.adoptPreviewAsStudy(verseId);
              const { bookNumber, chapter } = parseVerseId(verseId);
              commentaryStore.loadForChapter(bookNumber, chapter);
              commentaryStore.setRightPaneMode('commentary');
              commentaryStore.expand();
            }}
          />
        </div>
        {showRightPane && (
          <>
            <ResizeHandle onResize={handleResize} />
            <div class="main-layout__right-pane" style={rightPaneStyle}>
              <div class="right-pane-tabs">
                <button
                  class={`right-pane-tabs__tab ${paneMode === 'study' ? 'right-pane-tabs__tab--active' : ''}`}
                  onClick={() => commentaryStore.setRightPaneMode('study')}
                >
                  {t('rightPane.study')}
                </button>
                <button
                  class={`right-pane-tabs__tab ${paneMode === 'commentary' ? 'right-pane-tabs__tab--active' : ''}`}
                  onClick={() => commentaryStore.setRightPaneMode('commentary')}
                >
                  {t('rightPane.commentary')}
                </button>
                <button
                  class={`right-pane-tabs__tab ${paneMode === 'topics' ? 'right-pane-tabs__tab--active' : ''}`}
                  onClick={() => commentaryStore.setRightPaneMode('topics')}
                >
                  {t('rightPane.topics')}
                </button>
                <button
                  class={`right-pane-tabs__tab ${paneMode === 'dictionary' ? 'right-pane-tabs__tab--active' : ''}`}
                  onClick={() => commentaryStore.setRightPaneMode('dictionary')}
                >
                  {t('rightPane.dictionary')}
                </button>
                {shared.searchIsOpen && (
                  <button
                    class={`right-pane-tabs__tab ${paneMode === 'search' ? 'right-pane-tabs__tab--active' : ''}`}
                    onClick={() => commentaryStore.setRightPaneMode('search')}
                  >
                    {t('rightPane.search')}
                  </button>
                )}
                <button
                  class="right-pane-tabs__collapse"
                  onClick={() => commentaryStore.toggleCollapsed()}
                  title={t('rightPane.collapseRight')}
                >
                  <i class="fa-solid fa-chevron-right" />
                </button>
              </div>
              {paneMode === 'study' && (
                <StudyPane
                  onStrongsClick={handleStrongsClick}
                  onStrongsHover={shared.handleStrongsHover}
                  onStrongsLeave={shared.handleStrongsLeave}
                  bibleProvider={providers.bible}
                />
              )}
              {paneMode === 'commentary' && <CommentaryPane bibleProvider={providers.bible} onOpenSettings={shared.openSettings} />}
              {paneMode === 'topics' && <TopicsPane topicalProvider={providers.topical} tagGraphProvider={showTagGraph ? providers.tagGraph : undefined} bibleProvider={providers.bible} />}
              {paneMode === 'dictionary' && <DictionaryPane bibleProvider={providers.bible} />}
              {paneMode === 'search' && <SearchResultsPanel onOpenStrongsEntry={handleStrongsClick} />}
            </div>
          </>
        )}
        {shared.collapsed && (
          <div class="main-layout__commentary-collapsed">
            <CommentaryPane bibleProvider={providers.bible} />
          </div>
        )}
      </div>
      {/*
        Docked below everything, and rendered only while a session is running.
        It is part of the app rather than a separate controller window because
        the reading app *is* the preview -- see `presentStore`.
      */}
      <PresentBar />
      <DialogLayer
        settingsOpen={shared.settingsOpen}
        setSettingsOpen={shared.setSettingsOpen}
        settingsSection={shared.settingsSection}
        helpOpen={shared.helpOpen}
        setHelpOpen={shared.setHelpOpen}
        feedbackOpen={shared.feedbackOpen}
        setFeedbackOpen={shared.setFeedbackOpen}
        copyOpen={shared.copyOpen}
        setCopyOpen={shared.setCopyOpen}
        strongsPopup={shared.strongsPopup}
        setStrongsPopup={shared.setStrongsPopup}
        strongsTooltip={shared.strongsTooltip}
      />
      {contextMenu && (
        <ContextMenuPopup
          x={contextMenu.x}
          y={contextMenu.y}
          menuRef={contextMenuRef}
          onAction={handleContextMenuAction}
        />
      )}
    </div>
  );
}
