import { useEffect, useState, useRef } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { commentaryStore } from '../../stores/commentaryStore';
import { bibleStore } from '../../stores/bibleStore';
import { moduleStore, getCommentaryPopularity } from '../../stores/moduleStore';
import { useStore } from '../../hooks/useStore';
import { useVersePopup } from '../../hooks/useVersePopup';
import { processCommentaryLinks } from '../../../../../packages/core/src/Services/CommentaryLinkProcessor';
import { renderMarkdownToHtml } from '../../utils/markdownRenderer';
import { sanitizeHtml } from '../../utils/sanitize';
import { parseVerseId, formatVerseRange } from '../../utils/verseId';
import { isDigestModule, getDigestDisplayName, getDigestDisclaimer } from '../../moduleDescriptions';
import { DigestDisclaimer } from './DigestDisclaimer';
import type { CommentaryHomeModule, CommentaryEntryData } from '../../types';
import type { IBibleDataProvider } from '../../providers/interfaces';

type SortMode = 'alpha' | 'default' | 'words-desc' | 'words-asc' | 'random';

const SORT_STORAGE_KEY = 'bible-reader-commentary-home-sort';

function loadSortPreference(): SortMode {
  try {
    const val = localStorage.getItem(SORT_STORAGE_KEY);
    // Migrate old 'popularity' preference to 'default'
    if (val === 'popularity') return 'default';
    if (val === 'alpha' || val === 'default' || val === 'words-desc' || val === 'words-asc' || val === 'random') return val;
  } catch { /* ignore */ }
  return 'default';
}

function saveSortPreference(mode: SortMode): void {
  try {
    localStorage.setItem(SORT_STORAGE_KEY, mode);
  } catch { /* ignore */ }
}

interface CommentaryHomeProps {
  bibleProvider?: IBibleDataProvider;
}

export function CommentaryHome({ bibleProvider }: CommentaryHomeProps) {
  const { t } = useTranslation();
  const homeData = useStore(commentaryStore, () => commentaryStore.homeData);
  const homeLoading = useStore(commentaryStore, () => commentaryStore.homeLoading);
  const liveBook = useStore(commentaryStore, () => commentaryStore.syncedBook);
  const liveChapter = useStore(commentaryStore, () => commentaryStore.syncedChapter);
  const liveHighlightedVerse = useStore(bibleStore, () => bibleStore.getActiveTab()?.studyVerse);
  const tabs = useStore(commentaryStore, () => commentaryStore.tabs);
  const pinned = useStore(commentaryStore, () => commentaryStore.pinned);
  const pinnedVerse = useStore(commentaryStore, () => commentaryStore.pinnedVerse);
  const pinnedBook = useStore(commentaryStore, () => commentaryStore.pinnedBook);
  const pinnedChapter = useStore(commentaryStore, () => commentaryStore.pinnedChapter);

  // A pinned Overview tab stays on the passage it was pinned to, the same way a
  // pinned module tab does. Reading the live passage here regardless is what
  // made the pin button look inert even once it was allowed to fire.
  const syncedBook = pinned ? (pinnedBook ?? liveBook) : liveBook;
  const syncedChapter = pinned ? (pinnedChapter ?? liveChapter) : liveChapter;
  const mutedModules = useStore(commentaryStore, () => commentaryStore.mutedModules);
  const promotedModules = useStore(commentaryStore, () => commentaryStore.promotedModules);
  const [showMuted, setShowMuted] = useState(false);
  const rawHighlightedVerse = pinned ? pinnedVerse : liveHighlightedVerse;
  // Validate that the highlighted verse belongs to the synced book/chapter
  const highlightedVerse = (() => {
    if (!rawHighlightedVerse || !syncedBook || !syncedChapter) return rawHighlightedVerse;
    const { bookNumber, chapter } = parseVerseId(rawHighlightedVerse);
    return bookNumber === syncedBook && chapter === syncedChapter ? rawHighlightedVerse : null;
  })();

  useEffect(() => {
    if (!syncedBook || !syncedChapter) return;
    const verse = highlightedVerse
      ? highlightedVerse - (syncedBook * 1000000) - (syncedChapter * 1000)
      : undefined;
    commentaryStore.loadHomeData(syncedBook, syncedChapter, verse);
  }, [syncedBook, syncedChapter, highlightedVerse]);

  // Auto-select the first visible verse when no verse is highlighted.
  // Must be before any conditional early return to keep hook order stable.
  // Skipped while pinned: the pin exists precisely so the Bible pane's own
  // selection stops driving this one.
  useEffect(() => {
    if (!pinned && !highlightedVerse && syncedBook && syncedChapter) {
      const visibleVerseId = bibleStore.getFirstVisibleVerseId();
      if (visibleVerseId) {
        bibleStore.adoptPreviewAsStudy(visibleVerseId);
      }
    }
  }, [pinned, highlightedVerse, syncedBook, syncedChapter]);

  if (!syncedBook || !syncedChapter) {
    return (
      <div class="commentary-content commentary-content--empty">
        <p>{t('commentaryHome.navigateToAPassageTo')}</p>
      </div>
    );
  }

  if (homeLoading) {
    return (
      <div class="commentary-content commentary-content--loading">
        <i class="fa-solid fa-spinner fa-spin" style={{ marginRight: '8px' }} />
        Loading commentaries...
      </div>
    );
  }

  if (!homeData) {
    return (
      <div class="commentary-content commentary-content--empty">
        <p>{t('commentaryHome.noCommentaryDataAvailable')}</p>
      </div>
    );
  }

  const bookName = moduleStore.getBookName(syncedBook) || `Book ${syncedBook}`;
  const verseNum = highlightedVerse
    ? highlightedVerse - (syncedBook * 1000000) - (syncedChapter * 1000)
    : null;

  const passageModulesRaw = homeData.passageModules ?? [];
  const chapterModulesCount = (homeData.chapterModules ?? []).length;
  if (homeData.verseModules.length === 0 && passageModulesRaw.length === 0 && chapterModulesCount === 0) {
    return (
      <div class="commentary-content commentary-content--empty">
        {verseNum
          ? <p>{t('commentaryHome.noCommentariesHaveContentFor')}</p>
          : <div class="commentary-content commentary-content--loading">
              <i class="fa-solid fa-spinner fa-spin" style={{ marginRight: '8px' }} />
              Loading commentaries...
            </div>
        }
      </div>
    );
  }

  const [filter, setFilter] = useState('');
  const filterRef = useRef<HTMLInputElement>(null);
  const [sortMode, setSortMode] = useState<SortMode>(loadSortPreference);
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  // Stable random order: assign each module a random key, regenerated on data/sort change
  const randomOrderRef = useRef<Map<string, number>>(new Map());
  const randomSeedKeyRef = useRef('');
  const seedKey = sortMode === 'random'
    ? `${syncedBook}-${syncedChapter}-${highlightedVerse}-${homeData.verseModules.map(m => m.moduleAbbr).join(',')}`
    : '';
  if (sortMode === 'random' && seedKey !== randomSeedKeyRef.current) {
    const map = new Map<string, number>();
    for (const mod of homeData.verseModules) {
      map.set(mod.moduleAbbr, Math.random());
    }
    for (const mod of homeData.chapterModules) {
      map.set(mod.moduleAbbr, Math.random());
    }
    randomOrderRef.current = map;
    randomSeedKeyRef.current = seedKey;
  }

  // Expanded modules state: which modules are open, and their entries
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [expandedEntriesMap, setExpandedEntriesMap] = useState<Map<string, CommentaryEntryData[]>>(new Map());
  const [loadingModules, setLoadingModules] = useState<Set<string>>(new Set());

  const { containerProps: versePopupProps, popupJsx: versePopupJsx } = useVersePopup(bibleProvider);

  // Reset expanded modules when passage changes
  useEffect(() => {
    setExpandedModules(new Set());
    setExpandedEntriesMap(new Map());
    setLoadingModules(new Set());
  }, [syncedBook, syncedChapter, highlightedVerse]);

  // Close sort menu on outside click
  useEffect(() => {
    if (!sortOpen) return;
    const handler = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [sortOpen]);

  const handleSortChange = (mode: SortMode) => {
    setSortMode(mode);
    saveSortPreference(mode);
    setSortOpen(false);
  };

  const handleToggleExpand = async (mod: CommentaryHomeModule, e?: MouseEvent) => {
    if (expandedModules.has(mod.moduleAbbr)) {
      // Collapse — scroll the accordion header back into view so it doesn't jump away
      const accordionEl = (e?.currentTarget as HTMLElement)?.closest('.commentary-home__accordion');
      setExpandedModules(prev => { const next = new Set(prev); next.delete(mod.moduleAbbr); return next; });
      setExpandedEntriesMap(prev => { const next = new Map(prev); next.delete(mod.moduleAbbr); return next; });
      if (accordionEl) {
        requestAnimationFrame(() => {
          accordionEl.scrollIntoView({ block: 'nearest' });
        });
      }
      return;
    }

    // Expand: fetch entries (pass current verse for per-verse fast path when cache is cold)
    setExpandedModules(prev => new Set(prev).add(mod.moduleAbbr));
    setLoadingModules(prev => new Set(prev).add(mod.moduleAbbr));
    const entries = await commentaryStore.fetchModuleEntries(mod.moduleAbbr, syncedBook!, syncedChapter!, highlightedVerse ?? undefined);

    // Filter to highlighted verse if applicable, fall back to all entries
    let filtered = entries;
    if (highlightedVerse) {
      const verseMatch = entries.filter(entry =>
        entry.verse_id_start <= highlightedVerse &&
        (entry.verse_id_end ? entry.verse_id_end >= highlightedVerse : entry.verse_id_start === highlightedVerse)
      );
      if (verseMatch.length > 0) {
        filtered = verseMatch;
      }
    } else {
      const chapterOnly = entries.filter(entry => entry.entry_level === 'chapter');
      if (chapterOnly.length > 0) filtered = chapterOnly;
    }

    setExpandedEntriesMap(prev => new Map(prev).set(mod.moduleAbbr, filtered));
    setLoadingModules(prev => { const next = new Set(prev); next.delete(mod.moduleAbbr); return next; });
  };

  const handleAddToTabs = (mod: CommentaryHomeModule) => {
    commentaryStore.addTab(mod.moduleAbbr, mod.moduleName, highlightedVerse ?? undefined);
  };

  const handleFilterKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (allFiltered.length > 0) {
        handleToggleExpand(allFiltered[0]);
        setFilter('');
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const firstItem = (filterRef.current?.closest('.commentary-home') as HTMLElement)
        ?.querySelector('.commentary-home__list-item') as HTMLElement;
      firstItem?.focus();
    }
  };

  // Filter modules by abbreviation or name
  const matchesFilter = (mod: CommentaryHomeModule) => {
    if (!filter) return true;
    const lower = filter.toLowerCase();
    return mod.moduleAbbr.toLowerCase().includes(lower) ||
      mod.moduleName.toLowerCase().includes(lower);
  };

  // Build a set of user's tab module abbreviations for the default sort
  const userTabAbbrs = new Set(tabs.filter(t => t.id !== 'ctab-home' && !t.temporary).map(t => t.moduleAbbr));

  // Separate muted and visible modules
  const visibleVerseModules = homeData.verseModules.filter(m => !mutedModules.has(m.moduleAbbr));
  const mutedVerseModules = homeData.verseModules.filter(m => mutedModules.has(m.moduleAbbr));

  const filteredVerse = visibleVerseModules.filter(matchesFilter).sort((a, b) => {
    // Digest always first (unless muted, which is already filtered out)
    const aDigest = isDigestModule(a.moduleAbbr);
    const bDigest = isDigestModule(b.moduleAbbr);
    if (aDigest && !bDigest) return -1;
    if (!aDigest && bDigest) return 1;

    // Promoted modules come next
    const aPromoted = promotedModules.has(a.moduleAbbr);
    const bPromoted = promotedModules.has(b.moduleAbbr);
    if (aPromoted && !bPromoted) return -1;
    if (!aPromoted && bPromoted) return 1;

    if (sortMode === 'default') {
      // User's tab modules come first (in tab order), then popularity ranking
      const aIsTab = userTabAbbrs.has(a.moduleAbbr);
      const bIsTab = userTabAbbrs.has(b.moduleAbbr);
      if (aIsTab && !bIsTab) return -1;
      if (!aIsTab && bIsTab) return 1;
      if (aIsTab && bIsTab) {
        // Preserve tab order
        const tabOrder = tabs.filter(t => t.id !== 'ctab-home' && !t.temporary).map(t => t.moduleAbbr);
        return tabOrder.indexOf(a.moduleAbbr) - tabOrder.indexOf(b.moduleAbbr);
      }
      // Both non-tab: use popularity ranking (from server config or built-in defaults)
      const popularity = getCommentaryPopularity();
      const popA = popularity[a.moduleAbbr] ?? 999;
      const popB = popularity[b.moduleAbbr] ?? 999;
      return popA !== popB ? popA - popB : a.moduleAbbr.localeCompare(b.moduleAbbr);
    }
    if (sortMode === 'words-desc') return b.wordCount - a.wordCount;
    if (sortMode === 'words-asc') return a.wordCount - b.wordCount;
    if (sortMode === 'random') return (randomOrderRef.current.get(a.moduleAbbr) ?? 0) - (randomOrderRef.current.get(b.moduleAbbr) ?? 0);
    return a.moduleAbbr.localeCompare(b.moduleAbbr);
  });
  const allFiltered = filteredVerse;

  const filteredMuted = mutedVerseModules.filter(matchesFilter);

  const bySecondarySection = (a: CommentaryHomeModule, b: CommentaryHomeModule) => {
    const aPromoted = promotedModules.has(a.moduleAbbr);
    const bPromoted = promotedModules.has(b.moduleAbbr);
    if (aPromoted && !bPromoted) return -1;
    if (!aPromoted && bPromoted) return 1;
    if (sortMode === 'words-desc') return b.wordCount - a.wordCount;
    if (sortMode === 'words-asc') return a.wordCount - b.wordCount;
    return a.moduleAbbr.localeCompare(b.moduleAbbr);
  };

  const visiblePassageModules = passageModulesRaw.filter(m => !mutedModules.has(m.moduleAbbr));
  const filteredPassage = visiblePassageModules.filter(matchesFilter).sort(bySecondarySection);

  /**
   * Commentaries that cover this chapter but say nothing about the selected
   * verse — Matthew Henry and other chapter-level works spend most of their
   * length here.
   *
   * Both the server and `getHomeDataFromOverview` have always computed this
   * list, and nothing rendered it. The result was a commentary that is plainly
   * installed (it is offered by the tab bar's "+" picker, and opens fine as its
   * own tab) simply missing from the Overview with no explanation.
   */
  const chapterModulesRaw = homeData.chapterModules ?? [];
  const filteredChapter = chapterModulesRaw
    .filter(m => !mutedModules.has(m.moduleAbbr))
    .filter(matchesFilter)
    .sort(bySecondarySection);

  // Normalize bar width: 2000 words = 100% bar
  const barNormWords = 2000;

  const renderItem = (mod: CommentaryHomeModule, showBar: boolean, isMutedItem = false) => {
    const barPct = Math.max(3, Math.min(100, Math.round((mod.wordCount / barNormWords) * 100)));
    const isExpanded = expandedModules.has(mod.moduleAbbr);
    const modEntries = expandedEntriesMap.get(mod.moduleAbbr) ?? [];
    const isLoading = loadingModules.has(mod.moduleAbbr);
    const isPromoted = promotedModules.has(mod.moduleAbbr);
    const isMuted = mutedModules.has(mod.moduleAbbr);
    return (
      <div key={mod.moduleAbbr} class="commentary-home__accordion">
        <div
          class={`commentary-home__list-item ${isExpanded ? 'commentary-home__list-item--expanded' : ''} ${isPromoted ? 'commentary-home__list-item--promoted' : ''}`}
          onClick={(e: MouseEvent) => handleToggleExpand(mod, e)}
        >
          <div class="commentary-home__item-row">
            <i class={`fa-solid ${isExpanded ? 'fa-chevron-down' : 'fa-chevron-right'} fa-xs commentary-home__item-chevron`} />
            <span class="commentary-home__item-module">{isDigestModule(mod.moduleAbbr) ? getDigestDisplayName() : mod.moduleAbbr}</span>
            {showBar && <div class="commentary-home__item-bar-track"><div class="commentary-home__item-bar" style={{ width: `${barPct}%` }} /></div>}
            <i
              class={`fa-${isPromoted ? 'solid' : 'regular'} fa-star fa-xs commentary-home__item-star ${isPromoted ? 'commentary-home__item-star--active' : ''}`}
              title={isPromoted ? 'Unstar (remove from top)' : 'Star (pin to top)'}
              onClick={(e: MouseEvent) => { e.stopPropagation(); commentaryStore.togglePromoted(mod.moduleAbbr); }}
            />
          </div>
          <div class="commentary-home__item-row">
            {/* Second line is the full name, suppressed when it would only
                repeat the line above. `isDigestModule` rather than a string
                comparison: the heading above already resolves the digest to
                "Combined Summary", so comparing against the raw abbreviation
                let the resolved name through as a duplicate. */}
            <span class="commentary-home__item-name">{!isDigestModule(mod.moduleAbbr) && mod.moduleName !== mod.moduleAbbr ? mod.moduleName : ''}</span>
            {showBar && <span class="commentary-home__item-words">{mod.wordCount.toLocaleString()} words</span>}
          </div>
        </div>
        {isExpanded && (
          <div class="commentary-home__inline-content" {...versePopupProps}>
            <div class="commentary-home__inline-header">
              <div class="commentary-home__inline-actions">
                <button
                  class="commentary-home__action-btn commentary-home__action-btn--mute"
                  onClick={(e) => { e.stopPropagation(); commentaryStore.toggleMuted(mod.moduleAbbr); }}
                  title={isMuted ? 'Unmute' : 'Mute (hide)'}
                >
                  <i class={`fa-solid ${isMuted ? 'fa-eye' : 'fa-eye-slash'} fa-xs`} /> {isMuted ? 'Unmute' : 'Mute'}
                </button>
              </div>
              {(() => {
                const alreadyAdded = tabs.some(t => t.moduleAbbr === mod.moduleAbbr && !t.temporary);
                return (
                  <button
                    class={`commentary-home__add-to-tabs ${alreadyAdded ? 'commentary-home__add-to-tabs--disabled' : ''}`}
                    disabled={alreadyAdded}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!alreadyAdded) handleAddToTabs(mod);
                    }}
                  >
                    <i class={`fa-solid ${alreadyAdded ? 'fa-check' : 'fa-plus'} fa-xs`} />
                    {alreadyAdded ? 'Added to tabs' : 'Add to tabs'}
                  </button>
                );
              })()}
            </div>
            {isDigestModule(mod.moduleAbbr) && !isLoading && modEntries.length > 0 && (
              <DigestDisclaimer collapsedLabel={t('digestDisclaimer.autoGeneratedNotice')} />
            )}
            {isLoading ? (
              <div class="commentary-home__inline-loading">
                <i class="fa-solid fa-spinner fa-spin" /> Loading...
              </div>
            ) : modEntries.length === 0 ? (
              <div class="commentary-home__inline-empty">{t('commentaryHome.noContentForThisVerse')}</div>
            ) : (
              <>
                {modEntries.map(entry => {
                  const entryParsed = parseVerseId(entry.verse_id_start);
                  const modFormat = commentaryStore.getContentFormat(mod.moduleAbbr);
                  const htmlContent = modFormat === 'markdown' ? renderMarkdownToHtml(entry.content) : entry.content;
                  const linkedContent = processCommentaryLinks(htmlContent, {
                    bookNumber: entryParsed.bookNumber,
                    chapter: entryParsed.chapter,
                  });
                  return (
                    <div key={entry.entry_id} class="commentary-entry">
                      <div class="commentary-entry__ref">
                        {formatVerseRange(entry.verse_id_start, entry.verse_id_end)}
                      </div>
                      <div
                        class="commentary-entry__text"
                        dangerouslySetInnerHTML={{ __html: sanitizeHtml(linkedContent) }}
                      />
                    </div>
                  );
                })}
                {isDigestModule(mod.moduleAbbr) && (
                  <div class="digest-disclaimer-footer">
                    <i class="fa-solid fa-circle-info" /> {getDigestDisclaimer()}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div class="commentary-content commentary-home">
      <div class="commentary-home__section">
        <div class="commentary-home__section-title">
          <i class="fa-solid fa-bookmark" />
          {verseNum
            ? `Commentaries on ${bookName} ${syncedChapter}:${verseNum}`
            : `Commentaries on ${bookName} ${syncedChapter}`
          }
        </div>
        <div class="commentary-home__toolbar">
          <input
            ref={filterRef}
            type="text"
            class="commentary-home__filter-input"
            placeholder={t('commentaryHome.filter')}
            value={filter}
            onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
            onKeyDown={handleFilterKeyDown}
          />
          <div class="commentary-home__sort" ref={sortRef}>
            <button
              class="commentary-home__sort-btn"
              onClick={() => setSortOpen(!sortOpen)}
              title={t('commentaryHome.sortOrder')}
            >
              <i class="fa-solid fa-arrow-down-wide-short" />
              <span class="commentary-home__sort-label">
                {{ alpha: 'A-Z', default: 'Default', 'words-desc': 'Long', 'words-asc': 'Short', random: 'Random' }[sortMode]}
              </span>
              <i class={`fa-solid fa-chevron-${sortOpen ? 'up' : 'down'} fa-2xs`} />
            </button>
            {sortOpen && (
              <div class="commentary-home__sort-menu">
                {([['default', 'Default'], ['alpha', 'A-Z'], ['words-desc', 'Long'], ['words-asc', 'Short'], ['random', 'Random']] as const).map(([value, label]) => (
                  <button
                    key={value}
                    class={`commentary-home__sort-option ${sortMode === value ? 'commentary-home__sort-option--active' : ''}`}
                    onClick={() => handleSortChange(value)}
                  >
                    {label}
                    {sortMode === value && <i class="fa-solid fa-check fa-xs" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {filteredVerse.map(mod => renderItem(mod, true))}
      </div>

      {filteredPassage.length > 0 && (
        <div class="commentary-home__section">
          <div class="commentary-home__section-title">
            <i class="fa-solid fa-bookmark" />
            Commentary on Passage
          </div>
          {filteredPassage.map(mod => renderItem(mod, true))}
        </div>
      )}

      {filteredChapter.length > 0 && (
        <div class="commentary-home__section">
          <div class="commentary-home__section-title">
            <i class="fa-solid fa-bookmark" />
            Commentary on {bookName} {syncedChapter}
          </div>
          {filteredChapter.map(mod => renderItem(mod, true))}
        </div>
      )}

      {filter && filteredVerse.length === 0 && filteredPassage.length === 0 && filteredChapter.length === 0 && filteredMuted.length === 0 && (
        <div class="commentary-content commentary-content--empty">
          <p>{t('commentaryHome.noMatchingCommentaries')}</p>
        </div>
      )}

      {filteredMuted.length > 0 && (
        <div class="commentary-home__section commentary-home__section--muted">
          <div class="commentary-home__section-title commentary-home__section-title--muted" onClick={() => setShowMuted(!showMuted)}>
            <i class={`fa-solid ${showMuted ? 'fa-chevron-down' : 'fa-chevron-right'} fa-xs`} />
            <i class="fa-solid fa-eye-slash" />
            Muted ({filteredMuted.length})
          </div>
          {showMuted && filteredMuted.map(mod => renderItem(mod, true, true))}
        </div>
      )}
      {versePopupJsx}
    </div>
  );
}
