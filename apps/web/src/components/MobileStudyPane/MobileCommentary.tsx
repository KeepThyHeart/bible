import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { commentaryStore, HOME_TAB_ID } from '../../stores/commentaryStore';
import { bibleStore } from '../../stores/bibleStore';
import { studyStore } from '../../stores/studyStore';
import { offlineStore } from '../../stores/offlineStore';
import { useStore } from '../../hooks/useStore';
import { useVersePopup } from '../../hooks/useVersePopup';
import { processCommentaryLinks } from '../../../../../packages/core/src/Services/CommentaryLinkProcessor';
import { parseVerseId, formatVerseRange, isTskModule } from '../../utils/verseId';
import { filterCommentaryEntries } from '../../utils/commentaryEntries';
import { renderMarkdownToHtml } from '../../utils/markdownRenderer';
import { sanitizeHtml } from '../../utils/sanitize';
import { isDigestModule, getDigestDisplayName, getDigestDisclaimer } from '../../moduleDescriptions';
import { DigestDisclaimer } from '../CommentaryPane/DigestDisclaimer';
import { CommentaryAbout } from '../CommentaryPane/CommentaryContent';
import type { CommentaryHomeModule, CommentaryEntryData } from '../../types';
import type { IBibleDataProvider } from '../../providers/interfaces';

/** Hardcoded popularity ranking (lower = more popular). */
const POPULARITY: Record<string, number> = {
  'SYNTHESIS': 0, 'MHC': 1, 'MHCC': 2, 'Barnes': 3, 'TSK': 4,
  'Gill': 5, 'JFB': 6, 'Clarke': 7, 'Geneva': 8, 'Wesley': 9,
  'Poole': 10, 'Trapp': 11, 'BensonCom': 12, 'K&D': 13,
  'CambridgeBible': 14, 'PulpitCom': 15, 'Spurgeon': 16,
  'CalvinCom': 17, 'Ellicott': 18, 'Expositors': 19, 'Lightfoot': 20,
  'PNT': 21, 'RWP': 22, 'Vincent': 23, 'Bengel': 24,
};

function popularityRank(abbr: string): number {
  return POPULARITY[abbr] ?? 100;
}

type ContentLevel = 'verse' | 'passage' | 'none';

interface CardData {
  moduleAbbr: string;
  moduleName: string;
  wordCount: number;
  level: ContentLevel;
  starred: boolean;
  muted: boolean;
}

function renderCard(
  card: CardData,
  levelColor: Record<ContentLevel, string>,
  setViewingModule: (detail: { abbr: string; name: string } | null) => void,
  t: (key: string) => string,
) {
  return (
    <button
      key={card.moduleAbbr}
      class={`mobile-commentary__card ${card.muted ? 'mobile-commentary__card--muted' : ''}`}
      onClick={() => setViewingModule({ abbr: card.moduleAbbr, name: card.moduleName })}
    >
      <div
        class="mobile-commentary__card-border"
        style={{ backgroundColor: levelColor[card.level] }}
      />
      <div class="mobile-commentary__card-body">
        <div class="mobile-commentary__card-header">
          <span class="mobile-commentary__card-abbr">{isDigestModule(card.moduleAbbr) ? getDigestDisplayName() : card.moduleAbbr}</span>
          <div class="mobile-commentary__card-actions">
            <button
              class={`mobile-commentary__card-action ${card.starred ? 'mobile-commentary__card-action--active' : ''}`}
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); commentaryStore.togglePromoted(card.moduleAbbr); }}
              onTouchEnd={(e) => { e.stopPropagation(); }}
              title={card.starred ? t('mobileCommentary.unstar') : t('mobileCommentary.star')}
            >
              <i class={`${card.starred ? 'fa-solid' : 'fa-regular'} fa-star`} />
            </button>
            <button
              class={`mobile-commentary__card-action ${card.muted ? 'mobile-commentary__card-action--active' : ''}`}
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); commentaryStore.toggleMuted(card.moduleAbbr); }}
              onTouchEnd={(e) => { e.stopPropagation(); }}
              title={card.muted ? t('mobileCommentary.unmute') : t('mobileCommentary.mute')}
            >
              <i class={`fa-solid ${card.muted ? 'fa-eye' : 'fa-eye-slash'}`} />
            </button>
          </div>
        </div>
        {/* The line above already shows the digest's display name; repeating
            it here — as the raw "SYNTHESIS" — says nothing. */}
        <div class="mobile-commentary__card-name">{isDigestModule(card.moduleAbbr) ? '' : card.moduleName}</div>
        {card.wordCount > 0 && (
          <div class="mobile-commentary__card-words">
            {card.wordCount.toLocaleString()} {t('mobileCommentary.words')}
            <span class="mobile-commentary__card-level">
              {card.level === 'verse' ? t('mobileCommentary.verse') : card.level === 'passage' ? t('mobileCommentary.passage') : ''}
            </span>
          </div>
        )}
      </div>
    </button>
  );
}

interface MobileCommentaryProps {
  bibleProvider?: IBibleDataProvider;
  onOpenSettings?: (section?: string) => void;
  /** Lifted state: which module is being viewed in detail (null = card list) */
  viewingModule?: { abbr: string; name: string } | null;
  onViewModule?: (detail: { abbr: string; name: string } | null) => void;
}

export function MobileCommentary({ bibleProvider, onOpenSettings, viewingModule, onViewModule }: MobileCommentaryProps) {
  const { t } = useTranslation();
  const setViewingModule = onViewModule ?? ((_: { abbr: string; name: string } | null) => {});
  const [filter, setFilter] = useState('');
  const filterRef = useRef<HTMLInputElement>(null);

  const homeData = useStore(commentaryStore, () => commentaryStore.homeData);
  const homeLoading = useStore(commentaryStore, () => commentaryStore.homeLoading);
  const isOnline = useStore(offlineStore, () => offlineStore.isOnline);
  const promoted = useStore(commentaryStore, () => commentaryStore.promotedModules);
  const muted = useStore(commentaryStore, () => commentaryStore.mutedModules);
  const syncedBook = useStore(commentaryStore, () => commentaryStore.syncedBook);
  const syncedChapter = useStore(commentaryStore, () => commentaryStore.syncedChapter);

  const studyVerseId = useStore(studyStore, () => studyStore.verseId);
  const studyBook = useStore(studyStore, () => studyStore.book);
  const studyChapter = useStore(studyStore, () => studyStore.chapter);

  // Derive effective book/chapter from multiple sources (same pattern as detail view)
  const activeTab = bibleStore.getActiveTab();
  const effectiveBook = syncedBook || studyBook || activeTab?.book || null;
  const effectiveChapter = syncedChapter || studyChapter || activeTab?.chapter || null;

  // Infer verse: study store → Bible pane highlight → verse 1 of current chapter
  const effectiveVerseId = studyVerseId
    || activeTab?.studyVerse
    || (effectiveBook && effectiveChapter ? effectiveBook * 1000000 + effectiveChapter * 1000 + 1 : null);

  // Load home data when verse changes, and prefetch all commentary content in background.
  // Uses effectiveBook/Chapter so data loads even if syncedBook/Chapter hasn't been set yet.
  useEffect(() => {
    if (!effectiveBook || !effectiveChapter) return;
    const verse = effectiveVerseId ? effectiveVerseId % 1000 : undefined;
    commentaryStore.loadHomeData(effectiveBook, effectiveChapter, verse);
    // Eagerly prefetch all module entries so expanding a card is instant
    commentaryStore.prefetchAllEntries(effectiveBook, effectiveChapter);
  }, [effectiveBook, effectiveChapter, effectiveVerseId]);

  // Snapshot promoted/muted sets at navigation time (when homeData changes).
  // Cards stay in their section until the next navigation; only visual icons update live.
  const layoutPromotedRef = useRef(promoted);
  const layoutMutedRef = useRef(muted);
  useEffect(() => {
    layoutPromotedRef.current = promoted;
    layoutMutedRef.current = muted;
  }, [homeData]);

  // Build unified card list — visual flags from live store, layout from snapshot
  const cards = useMemo(() => {
    if (!homeData) return [];
    const verseSet = new Set((homeData.verseModules || []).map(m => m.moduleAbbr));
    const passageSet = new Set((homeData.passageModules || []).map(m => m.moduleAbbr));

    // Merge all modules
    const allModules = new Map<string, CommentaryHomeModule>();
    for (const m of [...(homeData.verseModules || []), ...(homeData.passageModules || []), ...(homeData.chapterModules || [])]) {
      if (!allModules.has(m.moduleAbbr)) allModules.set(m.moduleAbbr, m);
    }

    const result: CardData[] = [];
    for (const [abbr, m] of allModules) {
      const level: ContentLevel = verseSet.has(abbr) ? 'verse' : passageSet.has(abbr) ? 'passage' : 'none';
      result.push({
        moduleAbbr: abbr,
        moduleName: m.moduleName,
        wordCount: m.wordCount,
        level,
        starred: promoted.has(abbr),
        muted: muted.has(abbr),
      });
    }
    return result;
  }, [homeData, promoted, muted]);

  // Split cards into starred / regular / muted sections using the layout snapshot,
  // so cards don't move until the next navigation.
  const { starredCards, regularCards, mutedCards } = useMemo(() => {
    const layoutPromoted = layoutPromotedRef.current;
    const layoutMuted = layoutMutedRef.current;
    const filtered = filter
      ? cards.filter(c => c.moduleAbbr.toLowerCase().includes(filter.toLowerCase()) || c.moduleName.toLowerCase().includes(filter.toLowerCase()))
      : cards;

    const starred: CardData[] = [];
    const regular: CardData[] = [];
    const mutedList: CardData[] = [];

    for (const c of filtered) {
      if (layoutMuted.has(c.moduleAbbr)) mutedList.push(c);
      else if (layoutPromoted.has(c.moduleAbbr)) starred.push(c);
      else regular.push(c);
    }

    const levelOrder: Record<ContentLevel, number> = { verse: 0, passage: 1, none: 2 };
    const sortFn = (a: CardData, b: CardData) => {
      // Digest/Synthesis always first
      const aDigest = isDigestModule(a.moduleAbbr);
      const bDigest = isDigestModule(b.moduleAbbr);
      if (aDigest && !bDigest) return -1;
      if (!aDigest && bDigest) return 1;
      if (levelOrder[a.level] !== levelOrder[b.level]) return levelOrder[a.level] - levelOrder[b.level];
      return popularityRank(a.moduleAbbr) - popularityRank(b.moduleAbbr);
    };
    regular.sort(sortFn);
    mutedList.sort(sortFn);
    // Starred keep insertion order (no sort)

    return { starredCards: starred, regularCards: regular, mutedCards: mutedList };
  }, [cards, filter]);

  // Auto-focus filter on mount — only on desktop (mobile auto-focus opens keyboard)
  useEffect(() => {
    if (!viewingModule && window.innerWidth > 768) filterRef.current?.focus();
  }, [viewingModule]);

  // ========== Detail view ==========
  if (viewingModule) {
    return (
      <MobileCommentaryDetail
        moduleAbbr={viewingModule.abbr}
        bibleProvider={bibleProvider}
      />
    );
  }

  // ========== Card list ==========
  const levelColor: Record<ContentLevel, string> = {
    verse: 'var(--commentary-card-verse, #4caf50)',
    passage: 'var(--commentary-card-passage, #ff9800)',
    none: 'var(--commentary-card-none, #9e9e9e)',
  };

  return (
    <div class="mobile-commentary">
      {/* Filter */}
      <div class="mobile-commentary__filter-bar">
        <i class="fa-solid fa-magnifying-glass mobile-commentary__filter-icon" />
        <input
          ref={filterRef}
          class="mobile-commentary__filter-input"
          type="text"
          placeholder={t('mobileCommentary.findCommentary')}
          value={filter}
          onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
        />
        {filter && (
          <button class="mobile-commentary__filter-clear" onClick={() => setFilter('')}>
            <i class="fa-solid fa-xmark" />
          </button>
        )}
      </div>

      {/* Cards */}
      <div class="mobile-commentary__scroll">
        {starredCards.length > 0 && (
          <div class="mobile-commentary__section">
            <div class="mobile-commentary__section-label">
              <i class="fa-solid fa-star" /> {t('mobileCommentary.starred')}
            </div>
            <div class="mobile-commentary__cards">
              {starredCards.map((card) => renderCard(card, levelColor, setViewingModule, t))}
            </div>
          </div>
        )}

        {regularCards.length > 0 && (
          <div class="mobile-commentary__section">
            {starredCards.length > 0 && (
              <div class="mobile-commentary__section-label">{t('mobileCommentary.all')}</div>
            )}
            <div class="mobile-commentary__cards">
              {regularCards.map((card) => renderCard(card, levelColor, setViewingModule, t))}
            </div>
          </div>
        )}

        {mutedCards.length > 0 && (
          <div class="mobile-commentary__section">
            <div class="mobile-commentary__section-label mobile-commentary__section-label--muted">{t('mobileCommentary.muted')}</div>
            <div class="mobile-commentary__cards">
              {mutedCards.map((card) => renderCard(card, levelColor, setViewingModule, t))}
            </div>
          </div>
        )}

        {starredCards.length === 0 && regularCards.length === 0 && mutedCards.length === 0 && (
          <div class="mobile-commentary__empty">
            {homeLoading ? (
              <><i class="fa-solid fa-spinner fa-spin" /> {t('mobileCommentary.loading')}</>
            ) : !isOnline ? t('mobileCommentary.offlineNotice')
              : filter ? t('mobileCommentary.noMatching') : t('mobileCommentary.noAvailable')}
          </div>
        )}
      </div>
    </div>
  );
}

// ========================= Detail View =========================

interface DetailProps {
  moduleAbbr: string;
  bibleProvider?: IBibleDataProvider;
}

export function MobileCommentaryDetail({ moduleAbbr, bibleProvider }: DetailProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<CommentaryEntryData[]>([]);
  const [loading, setLoading] = useState(true);
  const { containerProps: versePopupProps, popupJsx: versePopupJsx } = useVersePopup(bibleProvider);

  const syncedBook = useStore(commentaryStore, () => commentaryStore.syncedBook);
  const syncedChapter = useStore(commentaryStore, () => commentaryStore.syncedChapter);
  const studyBook = useStore(studyStore, () => studyStore.book);
  const studyChapter = useStore(studyStore, () => studyStore.chapter);
  const studyVerse = useStore(bibleStore, () => bibleStore.getActiveTab()?.studyVerse);
  const studyVerseId = useStore(studyStore, () => studyStore.verseId);
  const isOnline = useStore(offlineStore, () => offlineStore.isOnline);
  const contentFormat = commentaryStore.contentFormatByModule.get(moduleAbbr);

  // Use commentary store's synced values, falling back to study store, then Bible tab
  const activeTab = bibleStore.getActiveTab();
  const effectiveBook = syncedBook || studyBook || activeTab?.book || null;
  const effectiveChapter = syncedChapter || studyChapter || activeTab?.chapter || null;
  const effectiveVerse = studyVerse || studyVerseId
    || (effectiveBook && effectiveChapter ? effectiveBook * 1000000 + effectiveChapter * 1000 + 1 : null);

  // Track the last fetched book/chapter to detect stale cache
  const lastFetchRef = useRef<string>('');

  // Fetch entries for this module — invalidate cache only when passage actually changes
  useEffect(() => {
    if (!effectiveBook || !effectiveChapter) return;
    const fetchKey = `${moduleAbbr}-${effectiveBook}-${effectiveChapter}`;
    const prevKey = lastFetchRef.current;
    lastFetchRef.current = fetchKey;

    // Only clear cache when the passage has changed (not on first mount,
    // where prefetched data may already be in the cache)
    if (prevKey && prevKey !== fetchKey) {
      commentaryStore.entriesByTab.delete(moduleAbbr);
    }

    setLoading(true);
    commentaryStore.fetchModuleEntries(moduleAbbr, effectiveBook, effectiveChapter).then(result => {
      setEntries(result);
      setLoading(false);
    });
  }, [moduleAbbr, effectiveBook, effectiveChapter]);

  // Filter entries for the current verse
  const { verse: verseSpecific, passage: passageLevel } = useMemo(
    () => filterCommentaryEntries(entries, effectiveVerse),
    [entries, effectiveVerse],
  );

  const allEntries = [...verseSpecific, ...passageLevel];

  // Derive distinct verse numbers that have content in this chapter (for prev/next nav)
  const chapterVerses = useMemo(() => {
    const verseSet = new Set<number>();
    for (const e of entries) {
      verseSet.add(e.verse_id_start % 1000);
    }
    return Array.from(verseSet).sort((a, b) => a - b);
  }, [entries]);

  const currentVerse = effectiveVerse ? effectiveVerse % 1000 : 0;
  let prevVerse: number | null = null;
  let nextVerse: number | null = null;
  for (let i = chapterVerses.length - 1; i >= 0; i--) {
    if (chapterVerses[i] < currentVerse) { prevVerse = chapterVerses[i]; break; }
  }
  for (let i = 0; i < chapterVerses.length; i++) {
    if (chapterVerses[i] > currentVerse) { nextVerse = chapterVerses[i]; break; }
  }

  const navigateToCommentaryVerse = (verse: number) => {
    const book = effectiveBook;
    const chapter = effectiveChapter;
    if (book && chapter) {
      const verseId = (book * 1000000) + (chapter * 1000) + verse;
      commentaryStore.setOverrideVerse(verseId);
      bibleStore.adoptPreviewAsStudy(verseId);
      bibleStore.scrollToVerse(verseId);
      // Scroll the outer mobile scroll wrapper back to top
      document.querySelector('.mobile-scroll-wrapper')?.scrollTo({ top: 0 });
    }
  };

  const isDigest = isDigestModule(moduleAbbr);

  return (
    <div class="mobile-commentary-detail">
      {loading ? (
        <div class="mobile-commentary-detail__loading">
          <i class="fa-solid fa-spinner fa-spin" /> {t('mobileCommentary.loading')}
        </div>
      ) : allEntries.length === 0 ? (
        <div class="mobile-commentary-detail__empty">
          {!isOnline ? t('mobileCommentary.offlineNotice') : t('mobileCommentary.noCommentary')}
          {(prevVerse || nextVerse) && (
            <div class="commentary-empty-verse__nav" style={{ marginTop: '12px' }}>
              {prevVerse ? (
                <button class="commentary-empty-verse__nav-btn" onClick={() => navigateToCommentaryVerse(prevVerse!)}>
                  <i class="fa-solid fa-chevron-left fa-xs" /> {t('mobileCommentary.prevVerse', { verse: prevVerse })}
                </button>
              ) : <span />}
              {nextVerse ? (
                <button class="commentary-empty-verse__nav-btn" onClick={() => navigateToCommentaryVerse(nextVerse!)}>
                  {t('mobileCommentary.nextVerse', { verse: nextVerse })} <i class="fa-solid fa-chevron-right fa-xs" />
                </button>
              ) : <span />}
            </div>
          )}
        </div>
      ) : (
        <div class="mobile-commentary-detail__content" {...versePopupProps}>
          {isDigest && <DigestDisclaimer collapsedLabel={t('digestDisclaimer.autoGeneratedNotice')} />}
          {allEntries.map((entry, i) => {
            let html = entry.content || '';
            if (contentFormat === 'markdown') {
              html = renderMarkdownToHtml(html);
            }
            const parsed = parseVerseId(entry.verse_id_start);
            html = processCommentaryLinks(html, { ...parsed, matchBareVerseNumbers: isTskModule(moduleAbbr) });
            const isPassage = entry.verse_id_end && entry.verse_id_end !== entry.verse_id_start;
            return (
              <div key={i} class="mobile-commentary-detail__entry">
                {isPassage && (
                  <div class="mobile-commentary-detail__ref">
                    {formatVerseRange(entry.verse_id_start, entry.verse_id_end)}
                  </div>
                )}
                <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />
              </div>
            );
          })}
          {(prevVerse || nextVerse) && (
            <div class="commentary-empty-verse__nav">
              {prevVerse ? (
                <button class="commentary-empty-verse__nav-btn" onClick={() => navigateToCommentaryVerse(prevVerse!)}>
                  <i class="fa-solid fa-chevron-left fa-xs" /> {t('mobileCommentary.prevVerse', { verse: prevVerse })}
                </button>
              ) : <span />}
              {nextVerse ? (
                <button class="commentary-empty-verse__nav-btn" onClick={() => navigateToCommentaryVerse(nextVerse!)}>
                  {t('mobileCommentary.nextVerse', { verse: nextVerse })} <i class="fa-solid fa-chevron-right fa-xs" />
                </button>
              ) : <span />}
            </div>
          )}
          {!isDigest && <CommentaryAbout moduleAbbr={moduleAbbr} />}
          {versePopupJsx}
        </div>
      )}
    </div>
  );
}
