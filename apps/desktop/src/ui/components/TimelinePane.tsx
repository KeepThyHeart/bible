import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { TimelinePanel } from '@bible/ui';
import type { TimelineDataset } from '@bible/core/browser';
import { getBookName } from '@bible/core/browser';
import { useI18n } from '../contexts/useI18n';
import { useBibleStore, DEFAULT_PANEL_ID } from '../stores/useBibleStore';
import { navigateToVerseInPrimary } from '../stores/crossStoreBridge';
import { openModuleManager } from '../utils/openModuleManager';
import { unwrap } from '../services/ipcResult';
import { bibleAPI } from '../services/electronAPI';
import { loadBookNamesCache, getBookNameFromCache, parseVerseId } from '../utils/verseReference';

/**
 * The verse the reader is on: the selected verse of the primary Bible panel,
 * else the first verse of the chapter on screen. A plain number, so the
 * selector is referentially stable.
 */
function selectReadingVerseId(state: {
  panels: Map<string, { selectedVerseId: number | null; currentBook: number; currentChapter: number }>;
}): number | null {
  const panel = state.panels.get(DEFAULT_PANEL_ID) ?? state.panels.values().next().value;
  if (!panel) return null;
  if (panel.selectedVerseId) return panel.selectedVerseId;
  if (panel.currentBook > 0 && panel.currentChapter > 0) {
    return panel.currentBook * 1000000 + panel.currentChapter * 1000 + 1;
  }
  return null;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; dataset: TimelineDataset | null };

const KIND_KEYS = ['reign', 'life', 'period', 'event', 'ministry'] as const;

/**
 * Timeline explorer pane: people, kings and events of the Bible on a zoomable
 * timeline, each linked to passages. Renders the shared `TimelinePanel`
 * from `@bible/ui` over the dataset served by the `timeline:getDataset` IPC.
 */
const TimelinePane: React.FC = () => {
  const { t } = useI18n();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [follow, setFollow] = useState(true);
  const [bookNamesReady, setBookNamesReady] = useState(false);
  const readingVerseId = useBibleStore(selectReadingVerseId);

  useEffect(() => {
    let cancelled = false;
    unwrap(window.electron.timeline.getDataset())
      .then((dataset) => { if (!cancelled) setState({ status: 'ready', dataset }); })
      .catch((err: unknown) => {
        if (!cancelled) setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => { cancelled = true; };
  }, []);

  // Localized book names come from the installed Bible module.
  useEffect(() => {
    let cancelled = false;
    loadBookNamesCache(bibleAPI)
      .catch(() => {})
      .finally(() => { if (!cancelled) setBookNamesReady(true); });
    return () => { cancelled = true; };
  }, []);

  const formatReference = useCallback((verseId: number, endVerseId?: number): string => {
    const name = (id: number) => {
      const { bookNumber } = parseVerseId(id);
      const cached = getBookNameFromCache(bookNumber);
      return cached && cached !== 'Unknown' ? cached : getBookName(bookNumber);
    };
    const a = parseVerseId(verseId);
    const head = `${name(verseId)} ${a.chapter}:${a.verse}`;
    if (endVerseId === undefined || endVerseId === verseId) return head;
    const z = parseVerseId(endVerseId);
    if (z.bookNumber !== a.bookNumber) return `${head} - ${name(endVerseId)} ${z.chapter}:${z.verse}`;
    return z.chapter === a.chapter ? `${head}-${z.verse}` : `${head}-${z.chapter}:${z.verse}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookNamesReady]);

  const labels = useMemo(() => ({
    chronology: t('timelinePane.chronology'),
    kinds: t('timelinePane.kinds'),
    search: t('timelinePane.search'),
    lanes: t('timelinePane.lanes'),
    zoomIn: t('timelinePane.zoomIn'),
    zoomOut: t('timelinePane.zoomOut'),
    fit: t('timelinePane.fit'),
    kindNames: Object.fromEntries(KIND_KEYS.map((k) => [k, t(`timelinePane.kind.${k}`)])),
    view: { group: t('timelinePane.view.group'), help: t('timelinePane.view.help') },
    card: {
      close: t('timelinePane.card.close'),
      read: t('timelinePane.card.read'),
      passages: t('timelinePane.card.passages'),
      dates: t('timelinePane.card.dates'),
      basis: t('timelinePane.card.basis'),
      circa: t('timelinePane.card.circa'),
      startRange: t('timelinePane.card.startRange', { min: '{min}', max: '{max}' }),
      endRange: t('timelinePane.card.endRange', { min: '{min}', max: '{max}' }),
      viaFallback: t('timelinePane.card.viaFallback', { chronology: '{chronology}' }),
      reviewed: t('timelinePane.card.reviewed'),
      unreviewed: t('timelinePane.card.unreviewed'),
    },
  }), [t]);

  const handleOpenPassage = useCallback((start: number) => {
    navigateToVerseInPrimary(start);
  }, []);

  const shell = { backgroundColor: 'var(--theme-bg-primary)', color: 'var(--theme-text-primary)' } as const;

  if (state.status === 'loading') {
    return <div className="h-full w-full" data-testid="timeline-pane-loading" style={shell} aria-busy="true" />;
  }

  if (state.status === 'error') {
    return (
      <div className="h-full w-full flex items-center justify-center p-lg" data-testid="timeline-pane-error" style={shell} role="alert">
        <p style={{ color: 'var(--theme-text-secondary)' }}>{t('timelinePane.loadError', { message: state.message })}</p>
      </div>
    );
  }

  if (!state.dataset) {
    return (
      <div className="h-full w-full flex items-center justify-center p-lg" data-testid="timeline-pane-empty" style={shell}>
        <div className="text-center max-w-md">
          <div style={{ fontSize: '1rem', fontWeight: 500, marginBottom: '8px' }}>{t('timelinePane.emptyTitle')}</div>
          <p style={{ color: 'var(--theme-text-secondary)', marginBottom: '12px' }}>{t('timelinePane.emptyBody')}</p>
          <button
            type="button"
            onClick={() => openModuleManager()}
            className="px-md py-sm rounded border border-border bg-transparent hover:bg-background-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {t('timelinePane.openModuleManager')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col overflow-hidden" data-testid="timeline-pane" style={shell}>
      <label className="flex items-center gap-xs px-md py-xs text-xs" style={{ color: 'var(--theme-text-secondary)' }}>
        <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
        {t('timelinePane.followReading')}
      </label>
      <div className="flex-1 min-h-0 overflow-auto">
        <TimelinePanel
          dataset={state.dataset}
          labels={labels}
          focusVerse={follow ? readingVerseId : null}
          onOpenPassage={handleOpenPassage}
          formatReference={formatReference}
        />
      </div>
    </div>
  );
};

export default TimelinePane;
