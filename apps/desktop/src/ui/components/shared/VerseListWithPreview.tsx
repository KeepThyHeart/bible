import React, { useState, useEffect, useCallback } from 'react';
import { formatVerseReference, formatVerseRange, loadBookNamesCache } from '../../utils/verseReference';
import { bibleAPI } from '../../services/electronAPI';
import { useBiblePanel } from '../../stores/hooks/useBiblePanel';
import { useBibleStore } from '../../stores/useBibleStore';
import { useI18n } from '../../contexts/useI18n';
import { sanitizeHtml } from '../../utils/sanitize';

interface VerseItem {
  start_verse_id: number;
  end_verse_id: number;
  context?: string;
}

interface FetchedVerse {
  verse_id: number;
  verse: number;
  text: string;
}

interface VerseListWithPreviewProps {
  verses: VerseItem[];
  /** The verse the reader is on. Marked so they can find their place. */
  currentVerseId?: number;
  maxVisible?: number;
  onVerseClick: (verseId: number) => void;
  /**
   * Scopes the "show verses" preference and the last-clicked mark to this
   * particular list. Two lists on screen - a topic's passages and a
   * cross-reference list - must not trample each other's state. Omit for a
   * one-off list that need not remember anything.
   */
  storageKey?: string;
  /** Fetch another page. Omit when the list is complete. */
  onLoadMore?: () => void;
  /** True when `onLoadMore` has more to fetch. */
  hasMore?: boolean;
  /** True while a page is in flight, so the button can say so. */
  loadingMore?: boolean;
}

// Cache fetched verse text across renders
const verseTextCache = new Map<string, FetchedVerse[]>();

const SHOW_VERSES_PREFIX = 'bible.verseList.showVerses.';

function loadShowVerses(storageKey: string | undefined): boolean {
  if (!storageKey) return true;
  try {
    const raw = localStorage.getItem(SHOW_VERSES_PREFIX + storageKey);
    return raw === null ? true : raw === 'true';
  } catch {
    // Private mode, or storage disabled. Showing the text is the better
    // default; a preference that cannot be read is not a reason to hide it.
    return true;
  }
}

function saveShowVerses(storageKey: string | undefined, value: boolean): void {
  if (!storageKey) return;
  try {
    localStorage.setItem(SHOW_VERSES_PREFIX + storageKey, String(value));
  } catch {
    // Nothing to do - the toggle still works for this session.
  }
}

/**
 * A list of verse passages: reference, and - when the reader wants it - the
 * verse text beside it.
 *
 * Three things this list has to do beyond listing references:
 *
 *  - **Show or hide the text.** The text is what makes a topic's passage list
 *    readable in place; it is also what makes a list of eighty references
 *    unscannable. Which of those the reader wants depends on what they are
 *    doing, so it is a toggle, remembered per list.
 *  - **Remember where they were.** Clicking a reference sends the Bible pane
 *    somewhere else; coming back to a long list with no mark on it means
 *    re-finding your place by eye every time. The last-clicked row keeps a
 *    subtle tint.
 *  - **Load more.** `maxVisible` trims the rendered rows, and `onLoadMore`
 *    fetches rows that were never loaded at all. Both are bounded views of a
 *    longer list, and neither may be a silent ceiling.
 *
 * The leading accent bar is drawn on every row - transparent unless the row is
 * marked - so marking a row cannot shift its text sideways or move the rows
 * below it.
 */
const VerseListWithPreview: React.FC<VerseListWithPreviewProps> = ({
  verses,
  currentVerseId,
  maxVisible = 10,
  onVerseClick,
  storageKey,
  onLoadMore,
  hasMore = false,
  loadingMore = false,
}) => {
  const { t } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const [showVerses, setShowVerses] = useState(() => loadShowVerses(storageKey));
  const [lastClickedKey, setLastClickedKey] = useState<string | null>(null);
  const visibleVerses = showAll ? verses : verses.slice(0, maxVisible);
  const hiddenCount = verses.length - visibleVerses.length;

  const { openTabs, activeTabIndex } = useBiblePanel();
  const defaultBible = useBibleStore(s => s.getDefaultBible());
  // Undefined only when no Bible is installed (or none is known yet); the
  // references still list, just without text.
  const activeVersion = openTabs[activeTabIndex]?.abbreviation ?? defaultBible;

  // Fetched verse text keyed by "start-end"
  const [verseTexts, setVerseTexts] = useState<Map<string, FetchedVerse[]>>(new Map());

  // Ensure book names are loaded
  useEffect(() => { loadBookNamesCache(bibleAPI); }, []);

  const toggleShowVerses = useCallback(() => {
    setShowVerses(prev => {
      const next = !prev;
      saveShowVerses(storageKey, next);
      return next;
    });
  }, [storageKey]);

  // Fetch verse text for all visible entries. Skipped entirely while the text
  // is hidden - there is no point paying for text nobody asked to see.
  useEffect(() => {
    if (!showVerses || !activeVersion) return undefined;
    let cancelled = false;

    const fetchAll = async () => {
      const newTexts = new Map<string, FetchedVerse[]>();
      const toFetch: VerseItem[] = [];

      for (const v of visibleVerses) {
        const key = `${activeVersion}:${v.start_verse_id}-${v.end_verse_id}`;
        const cached = verseTextCache.get(key);
        if (cached) {
          newTexts.set(`${v.start_verse_id}-${v.end_verse_id}`, cached);
        } else {
          toFetch.push(v);
        }
      }

      // Set cached results immediately
      if (newTexts.size > 0 && !cancelled) {
        setVerseTexts(prev => {
          const merged = new Map(prev);
          newTexts.forEach((val, k) => merged.set(k, val));
          return merged;
        });
      }

      // Fetch remaining in parallel (batched)
      if (toFetch.length > 0) {
        const results = await Promise.all(
          toFetch.map(async (v) => {
            try {
              // Only fetch the first verse for display; for single verses start==end
              const data = await bibleAPI.getVerses(activeVersion, v.start_verse_id, v.start_verse_id);
              return { v, data: data ?? [] };
            } catch {
              return { v, data: [] };
            }
          })
        );

        if (cancelled) return;

        const fetched = new Map<string, FetchedVerse[]>();
        for (const { v, data } of results) {
          const itemKey = `${v.start_verse_id}-${v.end_verse_id}`;
          const cacheKey = `${activeVersion}:${v.start_verse_id}-${v.end_verse_id}`;
          fetched.set(itemKey, data);
          verseTextCache.set(cacheKey, data);
        }

        setVerseTexts(prev => {
          const merged = new Map(prev);
          fetched.forEach((val, k) => merged.set(k, val));
          return merged;
        });
      }
    };

    fetchAll();
    return () => { cancelled = true; };
  }, [visibleVerses.length, showAll, activeVersion, showVerses]);

  const handleRefClick = (v: VerseItem): void => {
    setLastClickedKey(`${v.start_verse_id}-${v.end_verse_id}`);
    onVerseClick(v.start_verse_id);
  };

  return (
    <div style={{ fontSize: '13px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '4px' }}>
        <button
          type="button"
          data-testid="verse-list-toggle-verses"
          onClick={toggleShowVerses}
          aria-pressed={showVerses}
          style={{
            padding: '2px 6px',
            fontSize: '11px',
            color: 'var(--theme-accent-primary)',
            backgroundColor: 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          {showVerses
            ? t('ui.verseList.hideVerses')
            : t('ui.verseList.showVerses')}
        </button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', border: '1.5px solid var(--theme-border-primary)' }}>
        <tbody>
          {visibleVerses.map((v) => {
            const isRange = v.start_verse_id !== v.end_verse_id;
            const label = isRange
              ? formatVerseRange(v.start_verse_id, v.end_verse_id)
              : formatVerseReference(v.start_verse_id);
            const isCurrent = currentVerseId !== undefined
              && currentVerseId >= v.start_verse_id
              && currentVerseId <= v.end_verse_id;
            const itemKey = `${v.start_verse_id}-${v.end_verse_id}`;
            const isLastClicked = lastClickedKey === itemKey;
            const marked = isCurrent || isLastClicked;
            const fetchedVerses = verseTexts.get(itemKey);

            return (
              <tr
                key={itemKey}
                data-testid={marked ? 'verse-ref-row-marked' : 'verse-ref-row'}
                style={{
                  // The current verse reads stronger than a row merely visited
                  // on the way to it.
                  backgroundColor: isCurrent
                    ? 'var(--theme-accent-bg, rgba(59, 130, 246, 0.1))'
                    : isLastClicked
                      ? 'color-mix(in srgb, var(--theme-accent-primary) 7%, transparent)'
                      : 'transparent',
                }}
              >
                {/* Reference column */}
                <td style={{
                  padding: '4px 8px',
                  verticalAlign: 'top',
                  whiteSpace: 'nowrap',
                  width: '1%',
                  borderBottom: '1.5px solid var(--theme-border-primary)',
                  borderInlineEnd: '1.5px solid var(--theme-border-primary)',
                  // Always drawn, transparent when unmarked: reserving the
                  // space here is what stops a click from nudging every row's
                  // text sideways and shifting the rows below it. The extra
                  // padding is the gap between the bar and the reference.
                  borderInlineStart: `3px solid ${marked ? 'var(--theme-accent-primary)' : 'transparent'}`,
                  paddingInlineStart: '8px',
                }}>
                  <a
                    href="#"
                    data-testid="verse-ref-link"
                    onClick={(e) => { e.preventDefault(); handleRefClick(v); }}
                    style={{
                      color: 'var(--theme-accent-primary)',
                      fontWeight: 600,
                      fontSize: '12px',
                      textDecoration: 'none',
                    }}
                    onMouseEnter={(e) => { (e.target as HTMLElement).style.textDecoration = 'underline'; }}
                    onMouseLeave={(e) => { (e.target as HTMLElement).style.textDecoration = 'none'; }}
                  >
                    {label}
                  </a>
                </td>
                {/* Text column */}
                {showVerses && (
                  <td style={{ padding: '4px 8px', verticalAlign: 'top', lineHeight: '1.5', borderBottom: '1.5px solid var(--theme-border-primary)' }}>
                    {fetchedVerses && fetchedVerses.length > 0 ? (
                      <span style={{ color: 'var(--theme-text-primary)' }}>
                        <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(fetchedVerses[0].text) }} />
                        {fetchedVerses.length > 1 && (
                          <span style={{ color: 'var(--theme-text-secondary)' }}> ...</span>
                        )}
                        {v.context && (
                          <span style={{ fontSize: '11px', color: 'var(--theme-text-secondary)', fontStyle: 'italic' }}>
                            {' '}({v.context})
                          </span>
                        )}
                      </span>
                    ) : fetchedVerses === undefined && activeVersion ? (
                      <span style={{ fontSize: '11px', color: 'var(--theme-text-secondary)' }}>{t('ui.common.loading')}</span>
                    ) : null}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Two different "more"s, and the reader is told about both: rows already
          loaded but trimmed from view, and rows not fetched yet. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {hiddenCount > 0 && (
          <button
            onClick={() => setShowAll(true)}
            data-testid="verse-list-show-all"
            style={{
              padding: '4px 8px',
              fontSize: '12px',
              color: 'var(--theme-accent-primary)',
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {t('ui.verseList.showAll', { count: verses.length })}
          </button>
        )}

        {onLoadMore && hasMore && hiddenCount === 0 && (
          <button
            onClick={onLoadMore}
            disabled={loadingMore}
            data-testid="verse-list-load-more"
            style={{
              padding: '4px 8px',
              fontSize: '12px',
              color: 'var(--theme-accent-primary)',
              backgroundColor: 'transparent',
              border: 'none',
              cursor: loadingMore ? 'default' : 'pointer',
              opacity: loadingMore ? 0.6 : 1,
            }}
          >
            {loadingMore
              ? t('ui.verseList.loadingMore')
              : t('ui.verseList.loadMore')}
          </button>
        )}
      </div>
    </div>
  );
};

export default VerseListWithPreview;
