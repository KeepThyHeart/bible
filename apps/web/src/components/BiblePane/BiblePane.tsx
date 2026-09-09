import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { BibleTabBar } from './BibleTabBar';
import { BibleToolbar } from './BibleToolbar';
import { BackBar } from './BackBar';
import { BibleContent } from './BibleContent';
import { ChapterNav } from './ChapterNav';
import { HomeScreen } from '../HomeScreen';
import { isInterlinearPending } from './interlinearPending';
import { bibleStore } from '../../stores/bibleStore';
import { moduleStore } from '../../stores/moduleStore';
import { settingsStore } from '../../stores/settingsStore';
import { useStore } from '../../hooks/useStore';
import type { IInterlinearDataProvider, IStrongsProvider } from '../../providers/interfaces';
import type { InterlinearWordData, StrongsEntryData } from '../../types';

interface BiblePaneProps {
  interlinearProvider?: IInterlinearDataProvider;
  strongsProvider?: IStrongsProvider;
  onStrongsClick?: (strongsNumber: string) => void;
  onStrongsHover?: (strongsNumber: string, rect: DOMRect) => void;
  onStrongsLeave?: () => void;
  onOpenSettings?: (section?: string) => void;
  onCopyVerse?: (verseId: number) => void;
  onCommentaryVerse?: (verseId: number) => void;
  /** When true, BibleTabBar and BibleToolbar are not rendered (caller renders them externally). */
  hideBars?: boolean;
}

export function BiblePane({
  interlinearProvider,
  strongsProvider,
  onStrongsClick,
  onStrongsHover,
  onStrongsLeave,
  onOpenSettings,
  onCopyVerse,
  onCommentaryVerse,
  hideBars,
}: BiblePaneProps) {
  const tab = useStore(bibleStore, () => bibleStore.getActiveTab());
  const activeTabId = useStore(bibleStore, () => bibleStore.activeTabId);
  const showHome = useStore(bibleStore, () => bibleStore.showHome);
  const displayMode = tab?.displayMode ?? 'standard';
  const studyShowInterlinear = useStore(bibleStore, () => bibleStore.studyShowInterlinear);
  // Gesture settings (parallel agent is adding these to settingsStore; fall back to defaults if absent)
  const swipeChaptersEnabled = useStore(settingsStore, () => (settingsStore as any).swipeChaptersEnabled ?? true) as boolean;
  const swipeChapterThresholdPx = useStore(settingsStore, () => (settingsStore as any).swipeChapterThresholdPx ?? 100) as number;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollPositionsRef = useRef<Map<string, number>>(new Map());
  const lastTabIdRef = useRef<string>('');

  const [interlinearWords, setInterlinearWords] = useState<InterlinearWordData[]>([]);
  const [strongsEntries, setStrongsEntries] = useState<Record<string, StrongsEntryData>>({});
  const [interlinearLoading, setInterlinearLoading] = useState(false);
  /** A fetch has completed for the current chapter, so an empty result is meaningful. */
  const [interlinearResolved, setInterlinearResolved] = useState(false);

  // Cache interlinear data per tab so switching away and back doesn't re-fetch
  const interlinearCacheRef = useRef<Map<string, { key: string; words: InterlinearWordData[]; strongs: Record<string, StrongsEntryData> }>>(new Map());

  // Track the verse visible at the top of the viewport before a display mode switch,
  // so we can scroll back to it after the content re-renders (e.g. interlinear rows are taller).
  const prevDisplayModeRef = useRef(displayMode);
  const anchorVerseIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (prevDisplayModeRef.current !== displayMode && scrollContainerRef.current) {
      // Mode is changing — find the verse currently visible at the top of the scroll area
      const container = scrollContainerRef.current;
      if (container.scrollTop <= 0) {
        // Already at the top — just stay there
        anchorVerseIdRef.current = '__top__';
      } else {
        const verseEls = container.querySelectorAll('[data-verse-id]');
        const containerTop = container.getBoundingClientRect().top;
        let bestEl: Element | null = null;
        let bestDist = Infinity;
        for (const el of verseEls) {
          const rect = el.getBoundingClientRect();
          const dist = Math.abs(rect.top - containerTop);
          if (dist < bestDist) {
            bestDist = dist;
            bestEl = el;
          }
        }
        anchorVerseIdRef.current = bestEl?.getAttribute('data-verse-id') ?? null;
      }
    }
    prevDisplayModeRef.current = displayMode;
  }, [displayMode]);

  // After interlinear loading finishes (or mode changed to non-study), restore scroll to anchor verse
  useEffect(() => {
    if (!anchorVerseIdRef.current || interlinearLoading) return;
    const anchor = anchorVerseIdRef.current;
    anchorVerseIdRef.current = null;

    if (!scrollContainerRef.current) return;

    requestAnimationFrame(() => {
      if (!scrollContainerRef.current) return;
      if (anchor === '__top__') {
        scrollContainerRef.current.scrollTop = 0;
      } else {
        const el = scrollContainerRef.current.querySelector(`[data-verse-id="${anchor}"]`);
        if (el) {
          el.scrollIntoView({ block: 'start' });
        }
      }
    });
  }, [interlinearLoading, displayMode]);

  // Helper: get the actual scroll element (mobile-scroll-wrapper or our own container)
  const getScrollElement = (): Element | null => {
    const el = scrollContainerRef.current;
    if (!el) return null;
    // On mobile, the scroll parent is .mobile-scroll-wrapper
    if (el.scrollHeight <= el.clientHeight) {
      const wrapper = el.closest('.mobile-scroll-wrapper');
      if (wrapper) return wrapper;
    }
    return el;
  };

  // Save scroll position when switching tabs
  useEffect(() => {
    // Save previous tab's scroll position
    if (lastTabIdRef.current && lastTabIdRef.current !== activeTabId) {
      const scrollEl = getScrollElement();
      if (scrollEl) {
        scrollPositionsRef.current.set(lastTabIdRef.current, scrollEl.scrollTop);
      }
    }
    lastTabIdRef.current = activeTabId;

    // Restore scroll position for new active tab (instant, no smooth scroll)
    if (activeTabId) {
      const savedPos = scrollPositionsRef.current.get(activeTabId);
      if (savedPos !== undefined) {
        requestAnimationFrame(() => {
          const scrollEl = getScrollElement();
          if (scrollEl) {
            scrollEl.scrollTop = savedPos;
          }
        });
      }
    }
  }, [activeTabId]);

  // Register scroll position reader so the store can snapshot scroll before navigation.
  // On mobile, the scroll container is .mobile-scroll-wrapper (parent), not our own ref.
  useEffect(() => {
    bibleStore.getScrollTop = () => {
      const el = scrollContainerRef.current;
      if (!el) return 0;
      // If our container isn't scrollable (mobile), walk up to find the real scroll parent
      if (el.scrollHeight <= el.clientHeight) {
        const wrapper = el.closest('.mobile-scroll-wrapper');
        if (wrapper) return wrapper.scrollTop;
      }
      return el.scrollTop;
    };
    return () => { bibleStore.getScrollTop = null; };
  }, []);

  // Whether the verses are currently replaced by the interlinear spinner.
  // Derived with the same helper BibleContent renders from, so the pane never
  // scrolls against a DOM it thinks holds verses.
  const interlinearPending = isInterlinearPending(displayMode, studyShowInterlinear, interlinearLoading);

  // Auto-scroll to a specific verse when navigateTo (or goBack / a history pick) sets pendingScrollVerse.
  // Lives here, not in BibleContent, because the actual scrollable element may be the parent
  // .mobile-scroll-wrapper rather than scrollContainerRef itself — getScrollElement() resolves it.
  useEffect(() => {
    const verseId = tab?.pendingScrollVerse;
    if (verseId == null || !tab || !scrollContainerRef.current) return;
    // Wait for the verses themselves. On a chapter change this effect can fire
    // on the render that carries the new book/chapter but not yet the new verse
    // nodes, and a scroll with nothing to measure is silently dropped.
    if (!tab.verses.length) return;
    // While the interlinear is pending BibleContent renders a spinner *instead
    // of* the verses, so there is no verse node to measure either. Same
    // condition object BibleContent uses — a private copy of the expression is
    // what let the two disagree and drop the first scroll.
    if (interlinearPending) return;
    // A token for a verse this chapter does not contain can never be satisfied
    // (a typed "John 3:99"). Drop it now the chapter is loaded, rather than
    // leaving it armed to hijack some later render.
    if (!tab.verses.some(v => v.verse_id === verseId)) {
      bibleStore.clearPendingScrollVerse(verseId);
      return;
    }

    // Defer through two animation frames so the freshly-mounted scroll container
    // (after a home → bible transition) has a final layout before we measure offsets.
    let cancelled = false;
    const scrollToVerse = () => {
      if (cancelled) return;
      const scrollEl = getScrollElement() as HTMLElement | null;
      if (!scrollEl) return;
      const verseEl = scrollContainerRef.current?.querySelector(`[data-verse-id="${verseId}"]`) as HTMLElement | null;
      // Not mounted yet: leave the token armed so the next render that brings
      // the verses in re-runs this effect. Consuming it up front is what made
      // the first "John 3:16" land on the chapter but not the verse.
      if (!verseEl) return;
      // Compute offset relative to the scroll container, then center the verse in view.
      const containerRect = scrollEl.getBoundingClientRect();
      const verseRect = verseEl.getBoundingClientRect();
      const currentScroll = scrollEl.scrollTop;
      const target = currentScroll + (verseRect.top - containerRect.top) - (scrollEl.clientHeight / 2) + (verseRect.height / 2);
      scrollEl.scrollTop = Math.max(0, target);
      // Consume only now that the scroll actually happened.
      bibleStore.clearPendingScrollVerse(verseId);
    };

    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(scrollToVerse);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(outer);
      if (inner) cancelAnimationFrame(inner);
    };
    // `verses[0]?.verse_id` identifies the loaded chapter, so the effect re-runs
    // when the *new* chapter's verses mount — which `verses.length` alone misses
    // when two chapters happen to be the same length.
  }, [tab?.pendingScrollVerse, tab?.book, tab?.chapter, tab?.verses.length, tab?.verses[0]?.verse_id, interlinearPending]);

  // Restore exact scroll position from history (pendingScrollTop)
  useEffect(() => {
    if (tab?.pendingScrollTop != null && scrollContainerRef.current) {
      const scrollTop = tab.pendingScrollTop;
      tab.pendingScrollTop = null;
      requestAnimationFrame(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        // On mobile, scroll the outer wrapper instead
        if (el.scrollHeight <= el.clientHeight) {
          const wrapper = el.closest('.mobile-scroll-wrapper');
          if (wrapper) { wrapper.scrollTop = scrollTop; return; }
        }
        el.scrollTop = scrollTop;
      });
    }
  }, [tab?.pendingScrollTop, tab?.book, tab?.chapter]);

  // Commentary loading is triggered explicitly by user actions (verse clicks,
  // navigateTo with a verse, banner syncs) — not auto-synced on chapter change.

  // Load interlinear data in study mode, with per-tab caching.
  //
  // Deliberately NOT gated on `tab.hasInterlinearData`: once a module has been
  // downloaded for offline use, chapters come from the local lite DB, which
  // carries no interlinear_word table and so always reports false — while
  // /api/interlinear still serves that module's words from the full DB. What
  // is actually available is whatever the fetch comes back with, which is how
  // StudyPane has always decided it.
  useEffect(() => {
    let stale = false;

    if (displayMode !== 'study' || !tab?.book || !tab.chapter || !interlinearProvider) {
      setInterlinearWords([]);
      setStrongsEntries({});
      setInterlinearLoading(false);
      setInterlinearResolved(false);
      return;
    }

    const cacheKey = `${tab.moduleAbbr}:${tab.book}:${tab.chapter}`;
    const cached = interlinearCacheRef.current.get(activeTabId);
    if (cached && cached.key === cacheKey) {
      setInterlinearWords(cached.words);
      setStrongsEntries(cached.strongs);
      setInterlinearLoading(false);
      setInterlinearResolved(true);
      return;
    }

    setInterlinearLoading(true);
    setInterlinearResolved(false);
    setInterlinearWords([]);
    setStrongsEntries({});
    interlinearProvider.getInterlinear(tab.book, tab.chapter, tab.moduleAbbr).then(data => {
      if (stale) return;
      interlinearCacheRef.current.set(activeTabId, { key: cacheKey, words: data.words, strongs: data.strongsEntries });
      setInterlinearWords(data.words);
      setStrongsEntries(data.strongsEntries);
      setInterlinearResolved(true);
    }).catch(() => {
      if (stale) return;
      setInterlinearWords([]);
      setStrongsEntries({});
      setInterlinearResolved(true);
    }).finally(() => {
      if (stale) return;
      setInterlinearLoading(false);
    });

    return () => { stale = true; };
  }, [displayMode, activeTabId, tab?.book, tab?.chapter, tab?.moduleAbbr]);

  // Adjacent-chapter prefetch: warm the HTTP cache for chapter±1 so swipe/next-button
  // navigation feels instant. Fires after the current chapter is set; responses are
  // discarded — the browser/service-worker cache is the only consumer.
  //
  // Skipped entirely once the translation is readable from OPFS, because then
  // there is nothing to warm: `OfflineBibleProvider` answers chapter±1 from the
  // local database in a millisecond and never consults the HTTP cache. Without
  // this check a reader who has downloaded the whole Bible still sent two
  // chapter requests to the server on every single navigation, for text already
  // sitting on their disk.
  useEffect(() => {
    if (!tab?.moduleAbbr || !tab.book || !tab.chapter) return;
    if (bibleStore.isServedLocally(tab.moduleAbbr)) return;
    const moduleAbbr = tab.moduleAbbr;
    const book = tab.book;
    const chapter = tab.chapter;
    const bookInfo = moduleStore.getBookByNumber(book);
    const maxChapter = bookInfo?.chapter_count;

    const prefetch = (ch: number) => {
      if (ch < 1) return;
      if (maxChapter != null && ch > maxChapter) return;
      const url = `/api/bible/${moduleAbbr}/${book}/${ch}`;
      // `priority` is a Chromium-only RequestInit hint; cast to keep TS quiet.
      fetch(url, { priority: 'low' } as RequestInit & { priority: string }).catch(() => {
        // Silently ignore prefetch failures (out of range, offline, etc.)
      });
    };

    // Defer slightly so the current chapter render isn't blocked by the prefetch kickoff.
    const handle = window.setTimeout(() => {
      prefetch(chapter - 1);
      prefetch(chapter + 1);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [tab?.moduleAbbr, tab?.book, tab?.chapter]);

  // Swipe left/right to navigate chapters
  const ENABLE_SWIPE_NAVIGATION = true;
  const [swipeOffset, setSwipeOffset] = useState(0);
  const swipeRef = useRef<{ startX: number; startY: number; tracking: boolean; decided: boolean; offset: number }>({ startX: 0, startY: 0, tracking: false, decided: false, offset: 0 });

  const navigateChapter = useCallback((direction: 'prev' | 'next') => {
    if (!tab?.book || !tab.chapter) return;
    // Swiping is paging: it modifies the current history entry rather than
    // dropping a breadcrumb for every chapter swiped past.
    const PAGE = { replace: true } as const;
    if (direction === 'prev') {
      if (tab.chapter > 1) {
        bibleStore.navigateTo(tab.book, tab.chapter - 1, undefined, PAGE);
      } else if (tab.book > 1) {
        const prevBook = moduleStore.getBookByNumber(tab.book - 1);
        if (prevBook) bibleStore.navigateTo(tab.book - 1, prevBook.chapter_count, undefined, PAGE);
      }
    } else {
      const book = moduleStore.getBookByNumber(tab.book);
      const maxChapter = book?.chapter_count ?? 999;
      if (tab.chapter < maxChapter) {
        bibleStore.navigateTo(tab.book, tab.chapter + 1, undefined, PAGE);
      } else if (tab.book < 66) {
        bibleStore.navigateTo(tab.book + 1, 1, undefined, PAGE);
      }
    }
  }, [tab?.book, tab?.chapter]);

  useEffect(() => {
    if (!ENABLE_SWIPE_NAVIGATION) return;
    if (!swipeChaptersEnabled) return; // Setting disables swipe navigation entirely
    const container = scrollContainerRef.current;
    if (!container) return;

    const SWIPE_THRESHOLD = swipeChapterThresholdPx; // Configurable via settings
    const DIRECTION_LOCK_RATIO = 2.0; // Horizontal distance must be 2x vertical — strongly horizontal
    const DECISION_DISTANCE = 30; // Pixels moved before deciding direction (raised from 15 to avoid stealing taps)

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      swipeRef.current = { startX: touch.clientX, startY: touch.clientY, tracking: true, decided: false, offset: 0 };
      // Do not show drag feedback yet — wait until direction lock fires
    };

    const handleTouchMove = (e: TouchEvent) => {
      const s = swipeRef.current;
      if (!s.tracking) return;
      const touch = e.touches[0];
      const dx = touch.clientX - s.startX;
      const dy = touch.clientY - s.startY;

      // Wait until the finger has moved enough to decide direction
      if (!s.decided) {
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        if (absDx < DECISION_DISTANCE && absDy < DECISION_DISTANCE) return;
        // Require strongly horizontal: dx must be at least 2x dy
        if (absDy > 0 && absDx / absDy < DIRECTION_LOCK_RATIO) {
          // Not horizontal enough — treat as vertical scroll, stop tracking
          s.tracking = false;
          return;
        }
        s.decided = true;
      }

      // Only after the gesture is committed to horizontal: prevent browser
      // back/forward navigation and render translateX drag feedback.
      e.preventDefault();
      s.offset = dx;
      setSwipeOffset(dx);
    };

    const handleTouchEnd = () => {
      const s = swipeRef.current;
      if (!s.tracking || !s.decided) {
        s.tracking = false;
        s.offset = 0;
        setSwipeOffset(0);
        return;
      }
      s.tracking = false;
      const offset = s.offset;
      s.offset = 0;
      setSwipeOffset(0);
      if (Math.abs(offset) >= SWIPE_THRESHOLD) {
        navigateChapter(offset > 0 ? 'prev' : 'next');
      }
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
    container.addEventListener('touchcancel', handleTouchEnd);
    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [navigateChapter, swipeChaptersEnabled, swipeChapterThresholdPx]);

  const swipeStyle = ENABLE_SWIPE_NAVIGATION && swipeOffset !== 0 ? {
    transform: `translateX(${swipeOffset}px)`,
    transition: 'none',
  } : undefined;

  return (
    <div class={`bible-pane ${displayMode === 'reading' ? 'bible-pane--reading' : ''}`}>
      {!hideBars && <BibleTabBar />}
      {showHome ? (
        <div class="bible-pane__scroll-container">
          <HomeScreen />
        </div>
      ) : (
        <>
          {!hideBars && <BackBar />}
          {!hideBars && <BibleToolbar onOpenSettings={onOpenSettings} />}
          <div class="bible-pane__scroll-container" ref={scrollContainerRef}>
            <div style={swipeStyle}>
              <BibleContent
                interlinearWords={interlinearWords}
                strongsEntries={strongsEntries}
                interlinearLoading={interlinearLoading}
                interlinearUnavailable={displayMode === 'study' && interlinearResolved && !interlinearLoading && interlinearWords.length === 0}
                onStrongsClick={onStrongsClick}
                onStrongsHover={onStrongsHover}
                onStrongsLeave={onStrongsLeave}
                onCopyVerse={onCopyVerse}
                onCommentaryVerse={onCommentaryVerse}
              />
              <ChapterNav />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
