/**
 * Localization helpers for the Reading plans pane and the Bible-pane bar (task 0073): the labels
 * the shared `@bible/ui` reading-plan components take, localized book and stock-plan names,
 * weekday names and date formatting. Everything comes from the `readingPlans.*` catalog keys.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getBookName, ReadingPlans } from '@bible/core/browser';
import type {
  ReadingPlanBuilderFormLabels, ReadingPlanDayGridLabels, ReadingPlanLibraryLabels, ReadingPlanTodayCardLabels,
} from '@bible/ui';
import { useI18n } from '../../contexts/useI18n';
import { bibleAPI } from '../../services/electronAPI';
import { loadBookNamesCache, getBookNameFromCache } from '../../utils/verseReference';

/** Track ids the catalog translates (`readingPlans.track.<id>`); others keep the plan's own name. */
const TRANSLATED_TRACKS = new Set(['family1', 'family2', 'secret1', 'secret2', 'ot', 'nt', 'psalms', 'proverbs']);

const DAY_STATUSES: ReadingPlans.DayStatus[] = ['done', 'partial', 'missed', 'current', 'upcoming'];

const BUILDER_KEYS = [
  'name', 'namePlaceholder', 'whatToRead', 'wholeBible', 'oldTestament', 'newTestament', 'gospels', 'clear', 'books',
  'addPassage', 'passages', 'order', 'orderCanonical', 'orderAsListed', 'orderChronological', 'pace', 'paceDays',
  'paceEndDate', 'paceChapters', 'paceVerses', 'split', 'splitChapter', 'splitVerse', 'readingDays', 'schedule',
  'flexible', 'flexibleHint', 'fixed', 'fixedHint', 'startDate', 'preview', 'chooseSomething', 'create', 'cancel',
] as const;

const BUILDER_ERROR_KEYS = {
  errorEmptyScope: 'emptyScope', errorInvalidRange: 'invalidRange', errorInvalidPace: 'invalidPace',
  errorTooManyDays: 'tooManyDays', errorTooManyReadings: 'tooManyReadings',
} as const;

export interface ReadingPlanLabelSet {
  todayCard: ReadingPlanTodayCardLabels;
  dayGrid: ReadingPlanDayGridLabels;
  library: ReadingPlanLibraryLabels;
  builder: ReadingPlanBuilderFormLabels;
  weekdayGroup: string;
  weekdayNames: string[];
  /** Localized "Genesis 1-3". */
  formatReading: (r: ReadingPlans.Reading) => string;
  bookName: (book: number) => string;
  trackName: (id: string, fallback?: string) => string;
  stockName: (p: { key: string; name: string; source: string }) => string;
  stockDescription: (p: { key: string; description?: string; source: string }) => string | undefined;
  /** A plan's display name from its stored English name (stock plans are translated). */
  localizePlanName: (planKey: string, fallback: string) => string;
  /** An ISO date in the active locale. */
  formatDate: (iso: string) => string;
}

export function useReadingPlanLabels(): ReadingPlanLabelSet {
  const { t, locale, localizer } = useI18n();
  const [bookNamesReady, setBookNamesReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadBookNamesCache(bibleAPI)
      .catch(() => {})
      .finally(() => { if (!cancelled) setBookNamesReady(true); });
    return () => { cancelled = true; };
  }, []);

  const bookName = useCallback((book: number): string => {
    const cached = getBookNameFromCache(book);
    return cached && cached !== 'Unknown' ? cached : getBookName(book);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookNamesReady]);

  const formatReading = useCallback((r: ReadingPlans.Reading) => ReadingPlans.formatReading(r, bookName), [bookName]);

  const weekdayNames = useMemo(() => {
    // 2023-01-01 was a Sunday.
    const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2023, 0, 1 + i)));
  }, [locale]);

  const formatDate = useCallback((iso: string) => {
    const ms = ReadingPlans.parseIsoDate(iso);
    if (ms === null) return iso;
    // The date is midnight UTC; format in UTC so the calendar day never shifts.
    return localizer.formatDate(new Date(ms), { dateStyle: 'medium', timeZone: 'UTC' });
  }, [localizer]);

  const trackName = useCallback((id: string, fallback?: string) => (
    TRANSLATED_TRACKS.has(id) ? t(`readingPlans.track.${id}`) : (fallback ?? id)
  ), [t]);

  const stockIds = useMemo(() => new Set(ReadingPlans.stockPlanIds()), []);
  const stockId = (key: string): string | null => {
    const id = key.startsWith(ReadingPlans.STOCK_PREFIX) ? key.slice(ReadingPlans.STOCK_PREFIX.length) : null;
    return id !== null && stockIds.has(id) ? id : null;
  };
  const stockName = useCallback((p: { key: string; name: string; source: string }) => {
    const id = p.source === 'stock' ? stockId(p.key) : null;
    return id ? t(`readingPlans.stock.${id}.name`) : p.name;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, stockIds]);
  const stockDescription = useCallback((p: { key: string; description?: string; source: string }) => {
    const id = p.source === 'stock' ? stockId(p.key) : null;
    return id ? t(`readingPlans.stock.${id}.description`) : p.description;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, stockIds]);

  /** Localized name of an enrollment's plan: stock plans by key (`stock:<id>@<version>`), others as stored. */
  const localizePlanName = useCallback((planKey: string, fallback: string) => {
    const base = planKey.split('@')[0];
    return stockName({ key: base, name: fallback, source: base.startsWith(ReadingPlans.STOCK_PREFIX) ? 'stock' : 'user' });
  }, [stockName]);

  const todayCard = useMemo<ReadingPlanTodayCardLabels>(() => ({
    dayOf: (day, count) => t('readingPlans.card.dayOf', { day, count }),
    percent: (percent) => t('readingPlans.card.percent', { percent }),
    minutes: (n) => t('readingPlans.card.minutes', { n }),
    open: t('readingPlans.card.open'),
    markDayRead: t('readingPlans.card.markDayRead'),
    markDayUnread: t('readingPlans.card.markDayUnread'),
    completed: t('readingPlans.card.completed'),
    notStarted: t('readingPlans.card.notStarted'),
    restDay: t('readingPlans.card.restDay'),
    behind: (n) => t('readingPlans.card.behind', { n }),
    catchUp: (extra, days) => t('readingPlans.card.catchUp', { extra, days }),
    missed: (days) => t('readingPlans.card.missed', { days: days.join(', ') }),
    missedMore: (n) => t('readingPlans.card.missedMore', { n }),
    reschedule: t('readingPlans.card.reschedule'),
    switchToFlexible: t('readingPlans.card.switchToFlexible'),
    switchConfirmText: t('readingPlans.card.switchConfirmText'),
    confirm: t('readingPlans.card.confirm'),
    cancel: t('readingPlans.card.cancel'),
    openReading: (reading) => t('readingPlans.card.openReading', { reading }),
    readings: t('readingPlans.card.readings'),
  }), [t]);

  const dayGrid = useMemo<ReadingPlanDayGridLabels>(() => {
    const status = Object.fromEntries(
      DAY_STATUSES.map((s) => [s, t(`readingPlans.grid.status.${s}`)]),
    ) as Record<ReadingPlans.DayStatus, string>;
    return {
      dayStatus: (day, s) => t('readingPlans.grid.dayStatus', { day, status: status[s] }),
      status,
      grid: t('readingPlans.grid.grid'),
      legend: t('readingPlans.grid.legend'),
    };
  }, [t]);

  const library = useMemo<ReadingPlanLibraryLabels>(() => ({
    empty: t('readingPlans.library.empty'),
    summary: (days, minutes) => t('readingPlans.library.summary', { days, minutes }),
    tracks: (n) => t('readingPlans.library.tracks', { n }),
    start: t('readingPlans.library.start'),
    preview: t('readingPlans.library.preview'),
    delete: t('readingPlans.library.delete'),
    startNamed: (name) => t('readingPlans.library.startNamed', { name }),
    previewNamed: (name) => t('readingPlans.library.previewNamed', { name }),
    deleteNamed: (name) => t('readingPlans.library.deleteNamed', { name }),
    list: t('readingPlans.library.list'),
  }), [t]);

  const builder = useMemo<ReadingPlanBuilderFormLabels>(() => {
    const simple = Object.fromEntries(BUILDER_KEYS.map((k) => [k, t(`readingPlans.builder.${k}`)]));
    const errors = Object.fromEntries(
      Object.entries(BUILDER_ERROR_KEYS).map(([label, key]) => [label, t(`readingPlans.builder.error.${key}`)]),
    );
    return {
      ...simple,
      ...errors,
      removePassage: (label: string) => t('readingPlans.builder.removePassage', { label }),
      previewSummary: (days: number, minutes: number) => t('readingPlans.builder.previewSummary', { days, minutes }),
      previewDay: (day: number, readings: string) => t('readingPlans.builder.previewDay', { day, readings }),
    } as ReadingPlanBuilderFormLabels;
  }, [t]);

  return {
    todayCard, dayGrid, library, builder, weekdayGroup: t('readingPlans.weekdays.group'), weekdayNames,
    formatReading, bookName, trackName, stockName, stockDescription, localizePlanName, formatDate,
  };
}
