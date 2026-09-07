import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { BiblePane } from './components/BiblePane/BiblePane';
import { BibleTabBar } from './components/BiblePane/BibleTabBar';
import { BackBar } from './components/BiblePane/BackBar';
import { BibleToolbar } from './components/BiblePane/BibleToolbar';
import { SearchResultsPanel } from './components/Search/SearchResultsPanel';
import { MobileStudyPane } from './components/MobileStudyPane/MobileStudyPane';
import { MobileCommentaryView } from './components/MobileStudyPane/MobileCommentaryView';
import { Header } from './components/Header';
import { ConnectionBanner } from './components/ConnectionBanner';
// PullToRefresh removed — replaced by a simple scroll wrapper. Refresh is available from Settings.
import { HomeScreen } from './components/HomeScreen';
import { DialogLayer } from './components/common/DialogLayer';
import { ContextMenuPopup } from './components/common/ContextMenuPopup';
import { commentaryStore } from './stores/commentaryStore';
import { parseVerseId } from './utils/verseId';
import { bibleStore } from './stores/bibleStore';
import { searchStore } from './stores/searchStore';
import { studyStore } from './stores/studyStore';
import { MAX_CHAPTERS } from './constants';
import { settingsStore } from './stores/settingsStore';
import { useStore } from './hooks/useStore';
import { useAppShared } from './hooks/useAppShared';
import { useContextMenu } from './hooks/useContextMenu';
import type { IDataProviders } from './providers/interfaces';

interface MobileAppProps {
  providers: IDataProviders;
}

export function MobileApp({ providers }: MobileAppProps) {
  const shared = useAppShared(providers);
  const { t } = useTranslation();
  const showHome = useStore(bibleStore, () => bibleStore.showHome);
  const [mobileView, setMobileView] = useState<'home' | 'bible' | 'search' | 'study' | 'commentary'>('home');
  const leftHanded = useStore(settingsStore, () => settingsStore.leftHandedMode);
  const searchIsOpen = useStore(searchStore, () => searchStore.isOpen);
  const searchSeq = useStore(searchStore, () => searchStore.searchSeq);
  const [navTooltip, setNavTooltip] = useState<string | null>(null);
  /** Saved scroll positions per mobile view. For the commentary view we also
   *  record the verseId the scroll position belongs to, so we can discard the
   *  restore if the user navigated to a different verse while away. */
  const savedScrollRef = useRef<Map<string, { scrollTop: number; verseId: number | null }>>(new Map());

  /** Compute the verseId currently displayed in the commentary view, mirroring
   *  the fallback logic in MobileCommentaryView. */
  const getCommentaryVerseId = (): number | null => {
    const tab = bibleStore.getActiveTab();
    return studyStore.verseId
      || tab?.studyVerse
      || (tab?.book && tab?.chapter ? tab.book * 1000000 + tab.chapter * 1000 + 1 : null);
  };

  // Landscape theme dropdown
  const [landscapeThemeOpen, setLandscapeThemeOpen] = useState(false);
  const theme = useStore(settingsStore, () => settingsStore.getResolvedTheme());
  const themeIcon = theme === 'dark' ? 'fa-moon' : theme === 'sepia' ? 'fa-mug-hot' : 'fa-sun';

  // Detect landscape orientation, preserving scroll position across rotation
  const [isLandscape, setIsLandscape] = useState(() => window.innerWidth > window.innerHeight && window.innerWidth <= 1024);
  useEffect(() => {
    const checkOrientation = () => {
      // Save scroll position before orientation change
      const wrapper = document.querySelector('.mobile-scroll-wrapper');
      const scrollTop = wrapper?.scrollTop ?? 0;
      setIsLandscape(window.innerWidth > window.innerHeight && window.innerWidth <= 1024);
      // Restore scroll position after DOM settles
      requestAnimationFrame(() => {
        const newWrapper = document.querySelector('.mobile-scroll-wrapper');
        if (newWrapper && scrollTop > 0) {
          newWrapper.scrollTop = scrollTop;
        }
      });
    };
    window.addEventListener('resize', checkOrientation);
    const mql = window.matchMedia('(orientation: landscape)');
    const handler = () => checkOrientation();
    mql.addEventListener('change', handler);
    return () => {
      window.removeEventListener('resize', checkOrientation);
      mql.removeEventListener('change', handler);
    };
  }, []);

  // Auto-switch to search view when a search is performed. `searchSeq` is in the
  // deps because `isOpen` stays true once results exist, so a repeat search from
  // another view would otherwise never fire this.
  useEffect(() => {
    if (searchIsOpen) {
      commentaryStore.setRightPaneMode('search');
      commentaryStore.expand();
      switchMobileView('search');
    }
  }, [searchIsOpen, searchSeq]);

  // When showHome becomes false (e.g., VOTD clicked), switch to bible view
  useEffect(() => {
    if (!showHome && mobileView === 'home') {
      setMobileView('bible');
    }
  }, [showHome]);

  // Auto-dismiss nav tooltip
  useEffect(() => {
    if (!navTooltip) return;
    const timer = setTimeout(() => setNavTooltip(null), 2500);
    return () => clearTimeout(timer);
  }, [navTooltip]);

  // Save/restore mobile-scroll-wrapper scroll position when switching views
  const switchMobileView = (view: typeof mobileView) => {
    // Save current view's scroll position
    const wrapper = document.querySelector('.mobile-scroll-wrapper');
    if (wrapper) {
      const verseId = mobileView === 'commentary' ? getCommentaryVerseId() : null;
      savedScrollRef.current.set(mobileView, { scrollTop: wrapper.scrollTop, verseId });
    }
    if (view === 'home') {
      bibleStore.setShowHome(true);
    } else if (view === 'bible') {
      bibleStore.setShowHome(false);
    }
    setMobileView(view);
  };

  // Restore scroll position when switching back to a view
  useEffect(() => {
    const saved = savedScrollRef.current.get(mobileView);
    if (saved != null) {
      savedScrollRef.current.delete(mobileView);
      // For the commentary view, only restore if the verse hasn't changed
      // since we left — otherwise a fresh commentary page should start at top.
      if (mobileView === 'commentary' && saved.verseId !== getCommentaryVerseId()) {
        return;
      }
      requestAnimationFrame(() => {
        const wrapper = document.querySelector('.mobile-scroll-wrapper');
        if (wrapper) wrapper.scrollTop = saved.scrollTop;
      });
    }
  }, [mobileView]);

  // Listen for navigate-to-bible events from commentary pane
  useEffect(() => {
    const handler = () => switchMobileView('bible');
    window.addEventListener('navigate-to-bible', handler);
    return () => window.removeEventListener('navigate-to-bible', handler);
  }, [mobileView]);

  // Mobile hardware Back button support via popstate.
  // We push a dummy history entry so pressing Back fires popstate instead of
  // leaving the app, then route it through the in-app navigation stack.
  useEffect(() => {
    // Seed with a dummy entry so the first Back press stays in-app
    window.history.pushState({ mobileBack: true }, '');

    const handlePopState = (_e: PopStateEvent) => {
      // Re-push so the next Back press also stays in-app
      window.history.pushState({ mobileBack: true }, '');

      // Priority 1: Close topics browser overlay
      if (studyStore.topicsBrowserOpen) {
        studyStore.closeTopicsBrowser();
        return;
      }

      // Priority 2: Commentary detail → back to commentary list
      if (mobileView === 'commentary' && commentaryStore.mobileSelectedCommentary) {
        commentaryStore.setMobileSelectedCommentary(null);
        return;
      }

      // Priority 3: Non-bible view → back to bible
      if (mobileView === 'search' || mobileView === 'study' || mobileView === 'commentary') {
        switchMobileView('bible');
        return;
      }

      // Priority 4: Bible has navigation history → go back
      if (mobileView === 'bible' && bibleStore.canGoBack()) {
        bibleStore.goBack();
        return;
      }

      // Priority 5: Bible with no history → go home
      if (mobileView === 'bible') {
        switchMobileView('home');
        return;
      }

      // On home with nowhere to go — let it be (user sees home screen)
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [mobileView]);

  // Swipe left/right navigation for Commentary mode = prev/next verse
  // (Bible mode swipe is handled by BiblePane's own touch handler on the content area)
  const swipeTouchRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const handleSwipeStart = useCallback((e: TouchEvent) => {
    const t = e.touches[0];
    swipeTouchRef.current = { x: t.clientX, y: t.clientY, time: Date.now() };
  }, []);
  const handleSwipeEnd = useCallback((e: TouchEvent) => {
    if (!swipeTouchRef.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - swipeTouchRef.current.x;
    const dy = t.clientY - swipeTouchRef.current.y;
    const elapsed = Date.now() - swipeTouchRef.current.time;
    swipeTouchRef.current = null;
    // Only register swipe if horizontal, fast enough, and not too vertical
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.6 || elapsed > 500) return;

    if (mobileView === 'commentary') {
      const sv = studyStore.verse;
      const sb = studyStore.book;
      const sc = studyStore.chapter;
      if (!sb || !sc) return;
      // Stepping verse by verse is paging, not jumping: each swipe modifies the
      // current history entry instead of leaving a breadcrumb behind it.
      const PAGE = { replace: true } as const;
      if (dx < 0) {
        // Swipe left = next verse
        const maxVerse = bibleStore.getActiveTab()?.verses?.length || 999;
        if (sv && sv < maxVerse) bibleStore.navigateTo(sb, sc, sv + 1, PAGE);
        else {
          const maxChap = MAX_CHAPTERS[sb] || 1;
          if (sc < maxChap) bibleStore.navigateTo(sb, sc + 1, 1, PAGE);
          else if (sb < 66) bibleStore.navigateTo(sb + 1, 1, 1, PAGE);
        }
      } else {
        // Swipe right = previous verse
        if (sv && sv > 1) bibleStore.navigateTo(sb, sc, sv - 1, PAGE);
        else if (sc > 1) bibleStore.navigateTo(sb, sc - 1, undefined, PAGE);
        else if (sb > 1) bibleStore.navigateTo(sb - 1, MAX_CHAPTERS[sb - 1] || 1, undefined, PAGE);
      }
      // Scroll to top when viewing an individual commentary detail
      if (commentaryStore.mobileSelectedCommentary) {
        document.querySelector('.mobile-scroll-wrapper')?.scrollTo({ top: 0 });
      }
    }
  }, [mobileView]);

  useEffect(() => {
    const el = document.querySelector('.mobile-scroll-wrapper');
    if (!el) return;
    el.addEventListener('touchstart', handleSwipeStart as EventListener, { passive: true });
    el.addEventListener('touchend', handleSwipeEnd as EventListener, { passive: true });
    return () => {
      el.removeEventListener('touchstart', handleSwipeStart as EventListener);
      el.removeEventListener('touchend', handleSwipeEnd as EventListener);
    };
  }, [handleSwipeStart, handleSwipeEnd]);

  const { contextMenu, contextMenuRef, handleContextMenuAction } = useContextMenu(
    shared.findVerseAtPoint,
    shared.setCopyOpen,
    switchMobileView,
  );

  const bibleStyle = {
    fontFamily: shared.fontFamily,
    fontSize: `${shared.fontSize}px`,
    lineHeight: String(shared.lineHeight),
    '--heading-font': shared.headingFontFamily,
  } as Record<string, string>;

  // The Study text size comes from `--study-font-size` on <html> (see
  // settingsStore.applyStudyFontSize) rather than an inline size here, so the
  // Study pane's own `calc(Npx * var(--study-font-scale))` rules follow it too.
  const commentaryStyle = {
    fontFamily: shared.studyFontFamily,
    lineHeight: String(shared.studyLineHeight),
  };

  // Shared Bible pane content (used in both portrait and landscape)
  const bibleContent = (
    <>
      <BackBar />
      <BibleToolbar onOpenSettings={shared.openSettings} />
      <div class="main-layout__bible" style={bibleStyle}>
        <BiblePane
          hideBars
          interlinearProvider={providers.interlinear}
          strongsProvider={providers.strongs}
          onStrongsClick={shared.handleStrongsClick}
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
            switchMobileView('commentary');
          }}
        />
      </div>
    </>
  );

  // On mobile the entire content area is one scroll container.
  // Header, tab bar, and toolbar are siblings inside it.
  // The tab bar uses position:sticky to stay pinned while the
  // header and toolbar scroll away naturally with the content.
  //
  // In landscape: tabs go to a left sidebar, content scrolls in center,
  // Bible/Commentary/Search nav buttons go vertical on right.
  return (
    <div class={`app app--mobile app--mobile-${mobileView}${isLandscape ? ' app--mobile-landscape' : ''}`}>
      {isLandscape ? (
        <>
          {/* Left sidebar: header + actions + tab bars */}
          <div class="mobile-landscape-sidebar">
            <div class="mobile-landscape-sidebar__header">
              <i class="fa-solid fa-book-bible" /> {t('app.name')}
            </div>
            <div class="mobile-landscape-sidebar__actions">
              <div class="mobile-landscape-sidebar__theme-wrapper">
                <button
                  class="mobile-landscape-sidebar__action-btn"
                  onClick={() => setLandscapeThemeOpen(!landscapeThemeOpen)}
                  title={t('header.theme')}
                >
                  <i class={`fa-solid ${themeIcon}`} />
                </button>
                {landscapeThemeOpen && (
                  <div class="mobile-landscape-sidebar__theme-dropdown">
                    {([
                      { value: 'light', label: 'themes.light', icon: 'fa-sun' },
                      { value: 'dark', label: 'themes.dark', icon: 'fa-moon' },
                      { value: 'sepia', label: 'themes.sepia', icon: 'fa-mug-hot' },
                    ] as const).map(opt => (
                      <button
                        key={opt.value}
                        class={`mobile-landscape-sidebar__theme-option ${theme === opt.value ? 'mobile-landscape-sidebar__theme-option--active' : ''}`}
                        onClick={() => {
                          settingsStore.setTheme(opt.value);
                          setLandscapeThemeOpen(false);
                        }}
                      >
                        <i class={`fa-solid ${opt.icon}`} /> {t(opt.label)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                class="mobile-landscape-sidebar__action-btn"
                onClick={() => window.location.reload()}
                title={t('header.refresh')}
              >
                <i class="fa-solid fa-rotate-right" />
              </button>
              <button
                class="mobile-landscape-sidebar__action-btn"
                onClick={() => shared.setHelpOpen(true)}
                title={t('header.help')}
              >
                <i class="fa-solid fa-circle-question" />
              </button>
              <button
                class="mobile-landscape-sidebar__action-btn"
                onClick={() => shared.openSettings()}
                title={t('header.settings')}
              >
                <i class="fa-solid fa-gear" />
              </button>
            </div>
            {mobileView === 'bible' && <BibleTabBar vertical hideHome />}
          </div>
          {/* Center: scrollable content (no tab bars, those are in sidebar) */}
          <div class="mobile-scroll-wrapper">
            <ConnectionBanner />
            {mobileView === 'home' && <HomeScreen onNavigate={switchMobileView} />}
            {mobileView === 'bible' && bibleContent}
            {mobileView === 'search' && (
              <div class="main-layout__right-pane" style={commentaryStyle}>
                <SearchResultsPanel onNavigate={() => switchMobileView('bible')} onOpenStrongsEntry={shared.handleStrongsClick} />
              </div>
            )}
            {mobileView === 'study' && (
              <div class="main-layout__right-pane" style={commentaryStyle}>
                <MobileStudyPane providers={providers} onStrongsClick={shared.handleStrongsClick} onStrongsHover={shared.handleStrongsHover} onStrongsLeave={shared.handleStrongsLeave} onOpenSettings={shared.openSettings} onNavigateBible={() => switchMobileView('bible')} />
              </div>
            )}
            {mobileView === 'commentary' && (
              <div class="main-layout__right-pane" style={commentaryStyle}>
                <MobileCommentaryView providers={providers} onNavigateBible={() => switchMobileView('bible')} onOpenSettings={shared.openSettings} />
              </div>
            )}
          </div>
        </>
      ) : (
        <div class="mobile-scroll-wrapper">
          <Header onSettingsClick={(section) => shared.openSettings(section)} onHelpClick={() => shared.setHelpOpen(true)} onLogoClick={() => switchMobileView('home')} />
          <ConnectionBanner />
          {mobileView === 'home' && <HomeScreen onNavigate={switchMobileView} />}
          {mobileView === 'bible' && (
            <>
              <BibleTabBar hideHome />
              {bibleContent}
            </>
          )}
          {mobileView === 'search' && (
            <div class="main-layout__right-pane" style={commentaryStyle}>
              <SearchResultsPanel onNavigate={() => switchMobileView('bible')} onOpenStrongsEntry={shared.handleStrongsClick} />
            </div>
          )}
          {mobileView === 'study' && (
            <div class="main-layout__right-pane" style={commentaryStyle}>
              <MobileStudyPane providers={providers} onStrongsClick={shared.handleStrongsClick} onStrongsHover={shared.handleStrongsHover} onStrongsLeave={shared.handleStrongsLeave} onOpenSettings={shared.openSettings} onNavigateBible={() => switchMobileView('bible')} />
            </div>
          )}
          {mobileView === 'commentary' && (
            <div class="main-layout__right-pane" style={commentaryStyle}>
              <MobileCommentaryView providers={providers} onNavigateBible={() => switchMobileView('bible')} onOpenSettings={shared.openSettings} />
            </div>
          )}
        </div>
      )}
      {navTooltip && (
        <div class="mobile-nav-tooltip" onClick={() => setNavTooltip(null)}>
          {navTooltip}
        </div>
      )}
      <nav class={`mobile-nav${leftHanded ? ' mobile-nav--left-handed' : ''}`}>
        {[
          { view: 'home' as const, icon: 'fa-solid fa-house', label: 'mobileNav.home' },
          { view: 'study' as const, icon: 'fa-solid fa-bookmark', label: 'mobileNav.study' },
          { view: 'bible' as const, icon: 'fa-solid fa-book-bible', label: 'mobileNav.read' },
          { view: 'commentary' as const, icon: 'fa-solid fa-comment-dots', label: 'mobileNav.commentary' },
          { view: 'search' as const, icon: 'fa-solid fa-magnifying-glass', label: 'mobileNav.search' },
        ].map((item) => (
          <button
            key={item.view}
            class={`mobile-nav__btn ${mobileView === item.view ? 'mobile-nav__btn--active' : ''}`}
            onClick={() => switchMobileView(item.view)}
            data-testid={`mobile-nav-${item.view}`}
          >
            <i class={item.icon} />
            <span>{t(item.label)}</span>
          </button>
        ))}
      </nav>
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
