import { useState, useEffect, useCallback, useRef, useMemo } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { bibleStore } from '../../stores/bibleStore';
import { searchStore } from '../../stores/searchStore';
import { useStore } from '../../hooks/useStore';
import { formatPassageRef } from '../../constants';
import type { IBibleDataProvider } from '../../providers/interfaces';
import { collapseReferencesStructured } from '../../utils/collapseReferences';
import type { CollapsedSegment } from '../../utils/collapseReferences';
import { useVersePopup } from '../../hooks/useVersePopup';
import { parseVerseId } from '../../utils/verseId';
import { sanitizeHtml } from '../../utils/sanitize';

export interface VerseRef {
  startVerseId: number;
  endVerseId?: number;
  context?: string | null;
}

interface VerseRefListProps {
  verses: VerseRef[];
  /**
   * Total for display only. It may be counted in a different unit than
   * `verses` (topics count verses inside ranges, while each row here is one
   * range), so it must never on its own decide whether more can be loaded —
   * pass `hasMore` for that.
   */
  totalCount?: number;
  /**
   * Whether another page actually exists. When omitted, falls back to
   * `totalCount > verses.length`, which is only correct if the caller counts
   * in the same unit it paginates in.
   */
  hasMore?: boolean;
  onNavigateBible?: (verseId: number) => void;
  bibleProvider?: IBibleDataProvider;
  storageKey?: string;
  onLoadMore?: () => void;
  loadingMore?: boolean;
}

function shortRef(verseId: number): string {
  const { bookNumber, chapter, verse } = parseVerseId(verseId);
  return formatPassageRef(bookNumber, chapter, verse);
}

function shortRange(startId: number, endId?: number): string {
  if (!endId || endId === startId) return shortRef(startId);
  const start = parseVerseId(startId);
  const end = parseVerseId(endId);
  if (start.bookNumber === end.bookNumber && start.chapter === end.chapter) {
    return `${shortRef(startId)}-${end.verse}`;
  }
  return `${shortRef(startId)}\u2013${shortRef(endId)}`;
}

function loadPref(key: string): boolean {
  try { return localStorage.getItem(key) === 'true'; } catch { return false; }
}
function savePref(key: string, val: boolean): void {
  try { localStorage.setItem(key, val ? 'true' : 'false'); } catch { /* ignore */ }
}

/**
 * Reusable verse reference list with compact and expanded modes.
 *
 * - Compact: semicolon-separated inline verse reference links
 * - Expanded (togglable): each verse on its own line with fetched verse text
 */
export function VerseRefList({ verses, totalCount, hasMore, onNavigateBible, bibleProvider, storageKey, onLoadMore, loadingMore }: VerseRefListProps) {
  const { t } = useTranslation();
  const { handleHover, handleLeave, handleClick: popupClick, popupJsx } = useVersePopup(bibleProvider);
  const effectiveKey = storageKey ?? 'bible-verse-ref-list-show';
  const lastClickedVerseRefId = useStore(searchStore, () => searchStore.lastClickedVerseRefId);
  // Scope the mark to this specific list instance, so the cross-ref list and
  // the topic verses list don't trample each other's highlight.
  const verseRefIdFor = (verseId: number): string => `${effectiveKey}|${verseId}`;
  const [showExpanded, setShowExpanded] = useState(() => loadPref(effectiveKey));
  const [verseTexts, setVerseTexts] = useState<Map<number, string>>(new Map());
  const [textsLoading, setTextsLoading] = useState(false);
  const prevVersesRef = useRef(verses);

  // Clear cached texts when verses change
  useEffect(() => {
    if (prevVersesRef.current !== verses) {
      setVerseTexts(new Map());
      prevVersesRef.current = verses;
    }
  }, [verses]);

  // Fetch verse texts when expanded
  useEffect(() => {
    if (!showExpanded || !bibleProvider || verses.length === 0) return;
    const moduleAbbr = bibleStore.getActiveTab()?.moduleAbbr;
    if (!moduleAbbr) return;

    const toFetch = verses.filter(v => !verseTexts.has(v.startVerseId));
    if (toFetch.length === 0) return;

    setTextsLoading(true);
    let cancelled = false;

    const ids = toFetch.map(v => v.startVerseId);
    bibleProvider.getVerseTexts(moduleAbbr, ids).then(batch => {
      if (cancelled) return;
      setVerseTexts(prev => {
        const next = new Map(prev);
        for (const v of toFetch) {
          const entry = batch.verses[String(v.startVerseId)];
          if (entry) {
            // Preserve safe formatting tags (em, i, b, strong, span) but strip
            // potentially unsafe ones (script, a, etc.) for verse display
            const html = (entry.text_html || entry.text || '')
              .replace(/<(?!\/?(?:em|i|b|strong|span)\b)[^>]*>/gi, '')
              .replace(/\s+/g, ' ')
              .trim();
            next.set(v.startVerseId, html);
          } else {
            next.set(v.startVerseId, '(verse not available)');
          }
        }
        return next;
      });
      setTextsLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setVerseTexts(prev => {
        const next = new Map(prev);
        for (const v of toFetch) next.set(v.startVerseId, '(verse not available)');
        return next;
      });
      setTextsLoading(false);
    });

    return () => { cancelled = true; };
  }, [showExpanded, verses, bibleProvider, verseTexts]);

  const toggleExpanded = useCallback(() => {
    setShowExpanded(prev => {
      const next = !prev;
      savePref(effectiveKey, next);
      return next;
    });
  }, [effectiveKey]);

  // Use the popup hook for all verse ref clicks (shows popup on mobile, navigates on desktop)
  const handleRefClick = (verseId: number, e: MouseEvent) => {
    e.preventDefault();
    searchStore.setLastClickedVerseRefId(verseRefIdFor(verseId));
    popupClick(verseId, e);
  };

  // Collapse verse IDs into compact TSK-style segments
  const collapsedSegments = useMemo(() => {
    const ids = verses.map(v => v.startVerseId);
    return collapseReferencesStructured(ids, { format: 'short' });
  }, [verses]);

  if (verses.length === 0) return null;

  const count = totalCount ?? verses.length;
  const remaining = totalCount != null ? totalCount - verses.length : 0;
  // `hasMore` wins when given; otherwise infer, but never claim more when the
  // remainder isn't positive.
  const showMore = (hasMore ?? (totalCount != null && totalCount > verses.length)) && remaining > 0;

  return (
    <div class="verse-ref-list">
      {/* Compact inline refs (TSK-style collapsed) */}
      <div class="verse-ref-list__compact">
        {collapsedSegments.map((seg, i) => {
          if (seg.type === 'sep') {
            return <span key={`sep-${i}`} class="verse-ref-list__sep">{seg.text}</span>;
          }
          const isLast = lastClickedVerseRefId === verseRefIdFor(seg.verseId);
          return (
            <a
              key={`ref-${seg.verseId}`}
              class={`verse-ref-list__ref-link${isLast ? ' verse-ref-list__ref-link--last-clicked' : ''}`}
              href="#"
              onClick={(e) => handleRefClick(seg.verseId, e as any)}
              onMouseEnter={(e) => handleHover(seg.verseId, e as any)}
              onMouseLeave={handleLeave}
            >
              {seg.label}
            </a>
          );
        })}
        {showMore && (
          onLoadMore ? (
            <button class="verse-ref-list__load-more-inline" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore ? ` ${t('verseRefList.loading')}` : ` ${t('verseRefList.and')} ${remaining} more — load more`}
            </button>
          ) : (
            <span class="verse-ref-list__more"> {t('verseRefList.and')} {remaining} more</span>
          )
        )}
      </div>

      {/* Toggle button */}
      {bibleProvider && (
        <button class="verse-ref-list__toggle" onClick={toggleExpanded}>
          <i class={`fa-solid fa-${showExpanded ? 'chevron-up' : 'list'} fa-xs`} />{' '}
          {showExpanded ? t('verseRefList.hideVerses') : t('verseRefList.showVerses', { count })}
        </button>
      )}

      {/* Expanded verse list */}
      {showExpanded && (
        <div class="verse-ref-list__expanded">
          {textsLoading && (
            <div class="verse-ref-list__loading">
              <i class="fa-solid fa-spinner fa-spin" style={{ marginRight: '6px' }} />{t('verseRefList.loadingVerses')}
            </div>
          )}
          {verses.map(v => {
            const text = verseTexts.get(v.startVerseId);
            const isLast = lastClickedVerseRefId === verseRefIdFor(v.startVerseId);
            return (
              <div
                key={v.startVerseId}
                class={`verse-ref-list__expanded-entry${isLast ? ' verse-ref-list__expanded-entry--last-clicked' : ''}`}
              >
                <a
                  class="verse-ref-list__expanded-ref"
                  href="#"
                  onClick={(e) => handleRefClick(v.startVerseId, e as any)}
                  onMouseEnter={(e) => handleHover(v.startVerseId, e as any)}
                  onMouseLeave={handleLeave}
                >
                  {shortRange(v.startVerseId, v.endVerseId)}
                </a>
                <span
                  class="verse-ref-list__expanded-text"
                  dangerouslySetInnerHTML={
                    text !== undefined
                      ? { __html: sanitizeHtml(text || '(no text)') }
                      : undefined
                  }
                >
                  {text === undefined ? (v.context || '...') : undefined}
                </span>
              </div>
            );
          })}
          {showMore && onLoadMore && (
            <button class="verse-ref-list__load-more" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore
                ? <><i class="fa-solid fa-spinner fa-spin fa-xs" /> {t('verseRefList.loadingMore')}</>
                : t('verseRefList.loadMore', { count: remaining })}
            </button>
          )}
        </div>
      )}
      {popupJsx}
    </div>
  );
}
