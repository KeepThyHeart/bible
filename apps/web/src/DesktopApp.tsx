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
import { CompanionSlot } from './host/CompanionSlot';
import { StudyLayoutOutlet } from './host/slots';
import { UpdateBanner } from './components/UpdateBanner';
import { commentaryStore } from './stores/commentaryStore';
import { fireActivation } from './modules/moduleHost';
import { LazyPane } from './modules/host/LazyPane';
import { usePaneModes } from './modules/host/usePaneModes';
import { resolveLabel } from './host/appNavEntries';
import type { PaneViewProps } from './modules/host/panes';
import { parseVerseId } from './utils/verseId';
import { isTagGraphEnabled } from './utils/clientConfig';
import { dictionaryStore } from './stores/dictionaryStore';
import { bibleStore } from './stores/bibleStore';
import { searchStore } from './stores/searchStore';
import { evalVerseWhen, whenKeys } from './host/verseActionWhen';
import { useReadable } from './host/useReadable';
import { useAppShared } from './hooks/useAppShared';
import { useContextMenu } from './hooks/useContextMenu';
import type { IDataProviders } from './providers/interfaces';

/**
 * Panes that stay in the entry chunk exactly as before (first paint is
 * unchanged); everything else resolves through `modulePoints.views` and loads
 * on first use. Which panes exist at all is the `paneModes` registry's call.
 */
const EAGER_PANES: Record<string, (p: PaneViewProps) => unknown> = {
  study: (p) => (
    <StudyPane
      onStrongsClick={p.onStrongsClick}
      onStrongsHover={p.onStrongsHover as never}
      onStrongsLeave={p.onStrongsLeave}
      bibleProvider={p.providers.bible}
      onOpenSettings={p.onOpenSettings}
    />
  ),
  commentary: (p) => <CommentaryPane bibleProvider={p.providers.bible} onOpenSettings={p.onOpenSettings} />,
  topics: (p) => <TopicsPane topicalProvider={p.providers.topical} tagGraphProvider={p.showTagGraph ? p.providers.tagGraph : undefined} bibleProvider={p.providers.bible} />,
  dictionary: (p) => <DictionaryPane bibleProvider={p.providers.bible} />,
};

function PaneBody({ id, props }: { id: string; props: PaneViewProps }) {
  const eager = EAGER_PANES[id];
  return eager ? <>{eager(props)}</> : <LazyPane id={id} props={props} />;
}

interface DesktopAppProps {
  providers: IDataProviders;
}

export function DesktopApp({ providers }: DesktopAppProps) {
  const shared = useAppShared(providers);
  const { t } = useTranslation();
  // Read, not fetched: main.tsx already has /api/config in hand by the time
  // anything renders, and asking for it again cost a second round trip on the
  // boot path for one boolean.
  const showTagGraph = isTagGraphEnabled();
  const paneModes = usePaneModes();
  const [biblePaneWidth, setBiblePaneWidth] = useState(60);

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

  const { contextMenu, contextMenuRef, handleContextMenuAction, handleVerseAction, verseActionItems } = useContextMenu(
    shared.findVerseAtPoint,
    shared.setCopyOpen,
  );

  // The Search tab exists only while a search is open; `pane:show` lets a
  // plugin put any id in rightPaneMode. Resolve to a mode the strip actually has a tab for, rather
  // than rendering a right pane with nothing highlighted and no content —
  // which is what made a remembered Search pane look broken.
  // A pane exists exactly when its module does, and its `when` context key (a feature detection) holds.
  const whenVersion = useReadable(whenKeys);
  const paneAvailable = (id: string) => paneModes.some((m) => m.id === id && (!m.when || evalVerseWhen(m.when)));
  const paneMode = shared.rightPaneMode === 'search'
    ? (shared.searchIsOpen ? 'search' : 'study')
    : paneAvailable(shared.rightPaneMode) ? shared.rightPaneMode : 'study';

  useEffect(() => { if (paneMode !== 'search') fireActivation('onPanel:' + paneMode); }, [paneMode]);

  // Show the fallback while a pane is unavailable, but keep the saved choice (a disabled module, or
  // a pane whose feature detection has not answered yet) and bring it back when the pane returns.
  useEffect(() => {
    commentaryStore.reconcilePaneMode(paneMode, paneAvailable);
  }, [paneMode, shared.rightPaneMode, paneModes, whenVersion]);

  // A pane mode with `keepMounted` stays mounted (hidden) once opened while another tab is
  // active, so switching tabs does not lose its state (a quiz in progress).
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (opened.has(paneMode)) return;
    if (paneModes.some((m) => m.id === paneMode && m.keepMounted)) setOpened((prev) => new Set(prev).add(paneMode));
  }, [paneMode, paneModes, opened]);

  const showRightPane = !shared.collapsed;
  const paneProps: PaneViewProps = {
    providers,
    showTagGraph,
    onStrongsClick: handleStrongsClick,
    onStrongsHover: shared.handleStrongsHover as never,
    onStrongsLeave: shared.handleStrongsLeave,
    onOpenSettings: shared.openSettings as never,
  };

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
      <UpdateBanner />
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
                {paneModes.filter((m) => paneAvailable(m.id)).map((m) => (
                  <button
                    key={m.id}
                    class={`right-pane-tabs__tab ${paneMode === m.id ? 'right-pane-tabs__tab--active' : ''}`}
                    onClick={() => commentaryStore.setRightPaneMode(m.id)}
                    data-testid={`right-pane-tab-${m.id}`}
                  >
                    {resolveLabel((k, f) => t(k, f), m.title)}
                  </button>
                ))}
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
                  <i class="fa-solid fa-chevron-right kth-rtl-mirror" />
                </button>
              </div>
              {paneModes.filter((m) => paneAvailable(m.id)).map((m) =>
                m.keepMounted ? (
                  opened.has(m.id) || paneMode === m.id ? (
                    <div key={m.id} class="pane-keep-mounted" hidden={paneMode !== m.id}>
                      <PaneBody id={m.id} props={paneProps} />
                    </div>
                  ) : null
                ) : paneMode === m.id ? (
                  <PaneBody key={m.id} id={m.id} props={paneProps} />
                ) : null,
              )}
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
      {/* Study's companion strip while a session is live; the shortcuts are `PresenterKeys`, mounted by the app shell. */}
      <CompanionSlot />
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
      <StudyLayoutOutlet layout="desktop" placement="dialogs" onOpenSettings={shared.openSettings} />
      <StudyLayoutOutlet layout="desktop" placement="overlay" onOpenSettings={shared.openSettings} />
      {contextMenu && (
        <ContextMenuPopup
          x={contextMenu.x}
          y={contextMenu.y}
          menuRef={contextMenuRef}
          onAction={handleContextMenuAction}
          actions={verseActionItems}
          onVerseAction={handleVerseAction}
        />
      )}
    </div>
  );
}
