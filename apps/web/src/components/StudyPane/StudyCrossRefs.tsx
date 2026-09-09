import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { useVersePopup } from '../../hooks/useVersePopup';
import { studyStore } from '../../stores/studyStore';
import { bibleStore } from '../../stores/bibleStore';
import { offlineStore } from '../../stores/offlineStore';
import { useStore } from '../../hooks/useStore';
import { formatPassageRef } from '../../constants';
import { collapseReferencesStructured } from '../../utils/collapseReferences';
import { parseVerseId } from '../../utils/verseId';
import type { IBibleDataProvider } from '../../providers/interfaces';

const TABLE_STORAGE_KEY = 'bible-reader-crossrefs-show-table';

function loadTablePref(): boolean {
  try { return localStorage.getItem(TABLE_STORAGE_KEY) === 'true'; } catch { return false; }
}
function saveTablePref(show: boolean): void {
  try { localStorage.setItem(TABLE_STORAGE_KEY, show ? 'true' : 'false'); } catch { /* ignore */ }
}

function shortRef(verseId: number): string {
  const { bookNumber, chapter, verse } = parseVerseId(verseId);
  return formatPassageRef(bookNumber, chapter, verse);
}

function shortRange(startId: number, endId: number | null): string {
  if (!endId || endId === startId) return shortRef(startId);
  const start = parseVerseId(startId);
  const end = parseVerseId(endId);
  if (start.bookNumber === end.bookNumber && start.chapter === end.chapter) {
    return `${shortRef(startId)}-${end.verse}`;
  }
  return `${shortRef(startId)}–${shortRef(endId)}`;
}

/**
 * Split a TSK phrase into keyword and aside comment.
 * TSK phrases often embed aside commentary after the keyword, e.g.:
 *   "locusts.The word {arbeh,} Locust, is derived from {ravah,}..."
 *   "thou mayest freely eat.  Heb. eating thou shalt eat."
 */
function splitPhrase(phrase: string): { keyword: string; aside: string | null } {
  if (!phrase || phrase.length < 30) return { keyword: phrase, aside: null };

  for (let i = 4; i < phrase.length - 10; i++) {
    if (phrase[i] !== '.') continue;
    // Period + 2+ spaces
    if (phrase[i + 1] === ' ' && phrase[i + 2] === ' ') {
      const keyword = phrase.substring(0, i);
      let start = i + 1;
      while (start < phrase.length && phrase[start] === ' ') start++;
      const aside = phrase.substring(start);
      if (aside.length >= 10) return { keyword, aside };
    }
    // Period directly followed by uppercase letter (e.g., "locusts.The")
    else if (phrase[i + 1] >= 'A' && phrase[i + 1] <= 'Z') {
      const aside = phrase.substring(i + 1);
      if (aside.length >= 10) return { keyword: phrase.substring(0, i), aside };
    }
  }

  return { keyword: phrase, aside: null };
}

interface StudyCrossRefsProps {
  bibleProvider?: IBibleDataProvider;
}

export function StudyCrossRefs({ bibleProvider }: StudyCrossRefsProps) {
  const { t } = useTranslation();
  const verseId = useStore(studyStore, () => studyStore.verseId);
  const groups = useStore(studyStore, () => studyStore.crossRefGroups);
  const loading = useStore(studyStore, () => studyStore.crossRefLoading);
  const isOnline = useStore(offlineStore, () => offlineStore.isOnline);
  const { handleHover, handleLeave, handleClick, popupJsx } = useVersePopup(bibleProvider);

  // The store no longer loads cross-references on verse selection — nothing
  // should pay for a section that is collapsed, or in a pane that is not the
  // one on screen. Being mounted is the signal, and this is where it is given.
  useEffect(() => {
    studyStore.ensureCrossRefs();
  }, [verseId]);

  // Verse list toggle state
  const [showVerses, setShowVerses] = useState(loadTablePref);
  const [verseTexts, setVerseTexts] = useState<Map<number, string>>(new Map());
  const [versesLoading, setVersesLoading] = useState(false);
  const prevGroupsRef = useRef(groups);

  // Clear cached verse texts when groups change (new verse selected)
  useEffect(() => {
    if (prevGroupsRef.current !== groups) {
      setVerseTexts(new Map());
      prevGroupsRef.current = groups;
    }
  }, [groups]);

  // Fetch verse texts when verse list is shown.
  //
  // Use ONE batched request (getVerseTexts) rather than one getVerse per
  // cross-reference target. A single verse in a dense chapter can carry dozens
  // of TSK cross-references; fanning those out to one HTTP request each hammered
  // the server and tripped the per-IP rate limiter. The batch endpoint returns
  // all of them in a single round-trip. Mirrors VerseRefList's approach.
  useEffect(() => {
    if (!showVerses || !bibleProvider || groups.length === 0) return;
    const moduleAbbr = bibleStore.getActiveTab()?.moduleAbbr;
    if (!moduleAbbr) return;

    const allEntries = groups.flatMap(g => g.entries);
    // De-duplicate: the same target verse can appear in multiple phrase groups.
    const ids = [...new Set(allEntries.map(e => e.target_verse_id))]
      .filter(id => !verseTexts.has(id));
    if (ids.length === 0) return;

    setVersesLoading(true);
    let cancelled = false;

    const markUnavailable = () => {
      setVerseTexts(prev => {
        const next = new Map(prev);
        for (const id of ids) next.set(id, '(verse not available)');
        return next;
      });
      setVersesLoading(false);
    };

    bibleProvider.getVerseTexts(moduleAbbr, ids).then(batch => {
      if (cancelled) return;
      setVerseTexts(prev => {
        const next = new Map(prev);
        for (const id of ids) {
          const entry = batch.verses[String(id)];
          const text = entry
            ? (entry.text_html || entry.text || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
            : '(verse not available)';
          next.set(id, text);
        }
        return next;
      });
      setVersesLoading(false);
    }).catch(() => {
      if (cancelled) return;
      markUnavailable();
    });

    return () => { cancelled = true; };
  }, [showVerses, groups, bibleProvider, verseTexts]);

  const toggleVerses = useCallback(() => {
    setShowVerses(prev => {
      const next = !prev;
      saveTablePref(next);
      return next;
    });
  }, []);

  // Use the popup hook for verse list clicks too (shows popup on mobile, navigates on desktop)
  const handleVerseRefClick = (verseId: number, e: MouseEvent, endVerseId?: number) => {
    e.preventDefault();
    handleClick(verseId, e, endVerseId);
  };

  if (loading) {
    return <div class="study-crossrefs__loading">{t('studyCrossRefs.loading')}</div>;
  }

  if (groups.length === 0) {
    return (
      <div class="study-crossrefs__empty">
        {!isOnline ? t('studyCrossRefs.offlineNotice') : t('studyCrossRefs.noData')}
      </div>
    );
  }

  // Sort: whole-verse group (phrase=null) first, then phrase groups by sort_order
  const sorted = [...groups].sort((a, b) => {
    if (a.group.phrase === null && b.group.phrase !== null) return -1;
    if (a.group.phrase !== null && b.group.phrase === null) return 1;
    return a.group.sort_order - b.group.sort_order;
  });

  const renderRefs = (entries: typeof groups[0]['entries']) => {
    // Build a map of entry-level end verse IDs (TSK ranges like "Jer 23:3-4")
    const endMap = new Map<number, number>();
    for (const e of entries) {
      if (e.target_verse_end_id && e.target_verse_end_id !== e.target_verse_id) {
        endMap.set(e.target_verse_id, e.target_verse_end_id);
      }
    }
    const verseIds = entries.map(e => e.target_verse_id);
    const segments = collapseReferencesStructured(verseIds, { format: 'short' });
    return segments.map((seg, i) => {
      if (seg.type === 'sep') {
        return <span key={`sep-${i}`} class="study-crossrefs__sep">{seg.text}</span>;
      }
      // Prefer the TSK entry's own end verse, fall back to collapser's detected range
      const endId = endMap.get(seg.verseId) ?? seg.endVerseId;
      // If TSK entry has a range, update the label to show it
      const label = endMap.has(seg.verseId) && !seg.endVerseId
        ? shortRange(seg.verseId, endMap.get(seg.verseId)!)
        : seg.label;
      return (
        <a
          key={`ref-${seg.verseId}`}
          class="study-crossrefs__ref-link"
          href="#"
          onClick={(e) => handleClick(seg.verseId, e as any, endId)}
          onMouseEnter={(e) => handleHover(seg.verseId, e as any)}
          onMouseLeave={handleLeave}
        >
          {label}
        </a>
      );
    });
  };

  return (
    <div class="study-crossrefs">
      {/* Compact reference list */}
      <ul class="study-crossrefs__list">
        {sorted.map(({ group, entries }) => {
          const parsed = group.phrase ? splitPhrase(group.phrase.replace(/\.+$/, '')) : null;
          return (
            <li key={group.group_id}>
              {parsed
                ? <><strong class="study-crossrefs__phrase-inline">"{parsed.keyword.replace(/\.+$/, '')}"</strong>{' — '}</>
                : <><strong class="study-crossrefs__phrase-inline">{t('studyCrossRefs.overall')}</strong>{' — '}</>
              }
              {renderRefs(entries)}
              {parsed?.aside && (
                <div class="study-crossrefs__aside">{parsed.aside.replace(/\.+$/, '')}</div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Toggle verse list */}
      <button class="study-crossrefs__table-toggle" onClick={toggleVerses}>
        <i class={`fa-solid fa-${showVerses ? 'chevron-up' : 'list'} fa-xs`} />{' '}
        {showVerses ? t('studyCrossRefs.hideVerses') : t('studyCrossRefs.showVerses')}
      </button>

      {/* Expanded verse list */}
      {showVerses && (
        <div class="study-crossrefs__verse-list">
          {versesLoading ? (
            <div class="study-crossrefs__loading">
              <i class="fa-solid fa-spinner fa-spin" style={{ marginRight: '6px' }} />{t('studyCrossRefs.loadingVerses')}
            </div>
          ) : (
            sorted.map(({ group, entries }) => {
              const parsed = group.phrase ? splitPhrase(group.phrase.replace(/\.+$/, '')) : null;
              return (
                <div key={group.group_id} class="study-crossrefs__vl-group">
                  <div class="study-crossrefs__vl-phrase">
                    {parsed
                      ? `"${parsed.keyword.replace(/\.+$/, '')}"`
                      : t('studyCrossRefs.general')}
                  </div>
                  {parsed?.aside && (
                    <div class="study-crossrefs__aside">{parsed.aside.replace(/\.+$/, '')}</div>
                  )}
                  {entries.map(entry => {
                    const text = verseTexts.get(entry.target_verse_id);
                    return (
                      <div key={entry.entry_id} class="study-crossrefs__vl-entry">
                        <a
                          class="study-crossrefs__vl-ref"
                          href="#"
                          onClick={(e) => handleVerseRefClick(entry.target_verse_id, e as any, entry.target_verse_end_id ?? undefined)}
                        >
                          {shortRange(entry.target_verse_id, entry.target_verse_end_id)}
                        </a>
                        <span class="study-crossrefs__vl-text">
                          {text !== undefined ? (text || '(no text)') : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      )}

      {popupJsx}
    </div>
  );
}
