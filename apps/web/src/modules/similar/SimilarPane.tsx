import { useEffect, useMemo } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { SimilarList } from '@bible/ui';
import type { SimilarListLabels } from '@bible/ui';
import { bibleStore } from '../../stores/bibleStore';
import { studyStore } from '../../stores/studyStore';
import { similarStore } from './similarStore';
import type { SimilarRowData, SimilarTestament } from './similarStore';
import { moduleStore } from '../../stores/moduleStore';
import { useStore } from '../../hooks/useStore';
import { parseVerseId } from '../../utils/verseId';
import { createWebSimilar, formatPassage } from './webSimilarService';
import type { SimilarProviders } from './webSimilarService';

interface SimilarPaneProps {
  providers: SimilarProviders;
  mobile?: boolean;
}

const TESTAMENTS: SimilarTestament[] = ['any', 'ot', 'nt', 'other'];

/**
 * Passages similar to the selected verse or passage, from the precomputed neighbour table (asset
 * `similar-neighbours`). Follows the selection like the Topics pane. Keeps nothing in the browser.
 */
export function SimilarPane({ providers, mobile }: SimilarPaneProps) {
  const { t } = useTranslation();
  const start = useStore(bibleStore, () => bibleStore.getSelectedRange()?.start ?? null);
  const end = useStore(bibleStore, () => bibleStore.getSelectedRange()?.end ?? null);
  const studyVerse = useStore(studyStore, () => studyStore.verseId);
  const status = useStore(similarStore, () => similarStore.status);
  const progress = useStore(similarStore, () => similarStore.progress);
  const rows = useStore(similarStore, () => similarStore.rows);
  const floor = useStore(similarStore, () => similarStore.floor);
  const source = useStore(similarStore, () => similarStore.source);
  const hideKnown = useStore(similarStore, () => similarStore.hideKnown);
  const testament = useStore(similarStore, () => similarStore.testament);
  const canShowMore = useStore(similarStore, () => similarStore.canShowMore);
  const canGoBack = useStore(similarStore, () => similarStore.canGoBack);
  const approximate = useStore(similarStore, () => similarStore.approximate);
  const errorMessage = useStore(similarStore, () => similarStore.errorMessage);
  const reasons = useStore(similarStore, () => similarStore.reasons);

  useEffect(() => {
    similarStore.configure(createWebSimilar(providers, () => bibleStore.getActiveModule(), {
      getLanguage: () => {
        const code = moduleStore.getBibleModules().find((m) => m.abbreviation === bibleStore.getActiveModule())?.language_code;
        return (code ?? 'en').toLowerCase().split(/[-_]/)[0] || 'en';
      },
      crossRefModule: studyStore.crossRefModule,
    }));
    return () => similarStore.configure(null);
  }, [providers]);

  const selectedStart = start ?? studyVerse ?? null;
  const selectedEnd = end ?? selectedStart;
  useEffect(() => {
    similarStore.follow(selectedStart == null ? null : { startVerseId: selectedStart, endVerseId: selectedEnd ?? selectedStart });
  }, [selectedStart, selectedEnd, providers]);

  const labels = useMemo<Partial<SimilarListLabels>>(() => ({
    moreLikeThis: t('similar.moreLikeThis'),
    crossRef: t('similar.crossRef'),
    otNtBadge: t('similar.otNtBadge'),
    similarInMeaning: t('similar.similarInMeaning'),
    barLabel: t('similar.barLabel'),
    menu: t('similar.menu'),
    empty: t('similar.empty'),
  }), [t]);

  const open = (row: SimilarRowData, e: { newTab: boolean }) => {
    const { bookNumber, chapter, verse } = parseVerseId(row.startVerseId);
    if (e.newTab) bibleStore.addTabWithPassage(bibleStore.getActiveModule(), bookNumber, chapter, verse);
    else bibleStore.navigateToPreview(bookNumber, chapter, verse);
  };

  const testamentLabel = (v: SimilarTestament) => t(`similar.testament.${v}`);

  return (
    <div class="similar-pane" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0.75rem', overflowY: 'auto', height: '100%', boxSizing: 'border-box' }} data-mobile={mobile ? 'true' : undefined}>
      <div
        class="similar-pane__filters"
        role="group"
        aria-label={t('similar.filters')}
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: '0.75rem', rowGap: '0.4rem' }}
      >
        {canGoBack && (
          <button type="button" class="kth-btn kth-btn--sm" onClick={() => similarStore.back()}>
            {t('similar.back')}
          </button>
        )}
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
          <input type="checkbox" style={{ margin: 0 }} checked={hideKnown} onChange={(e) => similarStore.setHideKnown((e.target as HTMLInputElement).checked)} />
          <span>{t('similar.hideKnown')}</span>
        </label>
        <span role="group" aria-label={t('similar.testament.label')} style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '0.25rem' }}>
          {TESTAMENTS.map((v) => (
            <button
              key={v}
              type="button"
              class={`kth-btn kth-btn--sm${testament === v ? ' kth-btn--primary' : ''}`}
              aria-pressed={testament === v}
              onClick={() => similarStore.setTestament(v)}
            >
              {testamentLabel(v)}
            </button>
          ))}
        </span>
      </div>

      {source && (
        <div class="similar-pane__source" style={{ fontWeight: 600 }}>
          {t('similar.similarTo', { reference: formatPassage(source) })}
        </div>
      )}
      {approximate && status === 'ready' && <div class="kth-field__hint">{t('similar.approximate')}</div>}

      {status === 'idle' && <p>{t('similar.selectVerse')}</p>}
      {status === 'loading' && <p role="status">{t('similar.loading')}</p>}
      {status === 'downloading' && (
        <p role="status">
          {t('similar.downloading')}
          {progress && progress.total > 0 ? ` ${Math.min(100, Math.round((progress.loaded / progress.total) * 100))}%` : ''}
        </p>
      )}
      {status === 'unavailable' && <p role="status">{t('similar.unavailable')}</p>}
      {status === 'empty' && <p role="status">{t('similar.empty')}</p>}
      {status === 'needsLive' && <p role="status">{t('similar.rangeNeedsLive')}</p>}
      {status === 'error' && (
        <div role="alert">
          <p>{t('similar.error')}{errorMessage ? ` (${errorMessage})` : ''}</p>
          <button type="button" class="kth-btn kth-btn--sm" onClick={() => similarStore.retry()}>{t('similar.retry')}</button>
        </div>
      )}

      {status === 'ready' && (
        <>
          <SimilarList
            rows={rows}
            floor={floor}
            labels={labels}
            onOpen={(row, e) => open(row as SimilarRowData, e)}
            onMoreLike={(row) => similarStore.moreLike({ startVerseId: row.startVerseId, endVerseId: row.endVerseId })}
            reasonsFor={(row) => reasons.get(row.key)}
            onVisible={(row) => void similarStore.requestReasons(row as SimilarRowData)}
          />
          {canShowMore && (
            <button type="button" class="kth-btn" onClick={() => similarStore.showMore()}>{t('similar.showMore')}</button>
          )}
        </>
      )}
    </div>
  );
}
