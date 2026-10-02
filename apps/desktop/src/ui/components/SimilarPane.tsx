import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SimilarList, DEFAULT_SIMILAR_LIST_LABELS, type SimilarListRow } from '@bible/ui';
import { VerseIdHelper } from '@bible/core';
import type { PassageRange } from '../../../electron/ipc/similarTypes';
import { useI18n } from '../contexts/useI18n';
import { useBibleStore } from '../stores/useBibleStore';
import { useToastStore } from '../stores/useToastStore';
import {
  useSimilarStore, explanationKey, SIMILAR_MAX_RESULTS, type SimilarTestament,
} from '../stores/useSimilarStore';
import { bibleAPI, similarAPI } from '../services/electronAPI';
import { localizedBookNames } from '../constants/bibleBooks';
import { openModuleManager } from '../utils/openModuleManager';
import { anchorAtPointerX, isDocumentRtl } from '../utils/overlayPosition';

/** The user database the "Add as my cross-reference" action writes to. */
const USER_XREF_DB = 'default';

const TESTAMENTS: SimilarTestament[] = ['any', 'other', 'ot', 'nt'];
const TESTAMENT_KEYS: Record<SimilarTestament, string> = {
  any: 'similar.testament.any',
  other: 'similar.testament.other',
  ot: 'similar.testament.ot',
  nt: 'similar.testament.nt',
};

interface SimilarPaneProps {
  /** Optional so the pane renders outside dockview (tests, detached windows). */
  panelId?: string;
}

interface RowMenu { row: SimilarListRow; x: number; y: number }

const SimilarPane: React.FC<SimilarPaneProps> = ({ panelId = 'similar_default' }) => {
  const { t, localizer } = useI18n();
  const ps = useSimilarStore(s => s.panels.get(panelId));
  const explanations = useSimilarStore(s => s.explanations);
  const [menu, setMenu] = useState<RowMenu | null>(null);

  useEffect(() => {
    useSimilarStore.getState().initPanel(panelId); // allow-getstate: mount/unmount effect - store API for panel lifecycle
    return () => { useSimilarStore.getState().destroyPanel(panelId); }; // allow-getstate: mount/unmount effect - store API for panel lifecycle
  }, [panelId]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const names = useMemo(() => localizedBookNames(localizer), [localizer]);
  const format = useCallback(
    (r: PassageRange) => VerseIdHelper.formatReference(r.startVerseId, r.endVerseId, (n: number) => names[n] ?? `Book ${n}`),
    [names],
  );

  const labels = useMemo(() => ({
    moreLikeThis: t('similar.moreLikeThis'),
    crossRef: t('similar.crossRef'),
    otNtBadge: t('similar.otNtBadge'),
    similarInMeaning: t('similar.similarInMeaning'),
    barLabel: t('similar.barLabel'),
    menu: t('similar.menu'),
    empty: t('similar.empty'),
  }), [t]);

  const source = ps?.source ?? null;
  const rows = (ps?.result?.rows ?? []) as SimilarListRow[];

  const reasonsFor = useCallback(
    (row: SimilarListRow) => (source ? explanations.get(explanationKey(source, row)) : undefined),
    [explanations, source],
  );
  const onVisible = useCallback(
    (row: SimilarListRow) => useSimilarStore.getState().requestExplanation(panelId, row), // allow-getstate: event callback
    [panelId],
  );
  const onOpen = useCallback((row: SimilarListRow, e: { newTab: boolean }) => {
    const bible = useBibleStore.getState(); // allow-getstate: event handler
    if (e.newTab) {
      const p = VerseIdHelper.parse(row.startVerseId);
      void bible.openPassageInNewPanel(p.bookNumber, p.chapter, p.verse);
    } else {
      void bible.navigateToVerseInPrimary(
        row.startVerseId,
        row.endVerseId !== row.startVerseId ? row.endVerseId : undefined,
      );
    }
  }, []);
  const onMoreLike = useCallback(
    (row: SimilarListRow) => useSimilarStore.getState().moreLike(panelId, row), // allow-getstate: event callback
    [panelId],
  );
  const onMenu = useCallback((row: SimilarListRow, anchor: HTMLElement) => {
    const r = anchor.getBoundingClientRect();
    // The menu unfolds from the anchor's leading edge: its left edge in LTR, its right edge in RTL.
    setMenu({ row, x: isDocumentRtl() ? r.right : r.left, y: r.bottom });
  }, []);

  const copyReference = (row: SimilarListRow) => {
    setMenu(null);
    void navigator.clipboard?.writeText(row.reference || format(row));
  };
  const addXref = async (row: SimilarListRow) => {
    setMenu(null);
    if (!source) return;
    try {
      await bibleAPI.createUserCrossReference(USER_XREF_DB, source.startVerseId, row.startVerseId);
      useToastStore.getState().addToast(t('similar.xrefAdded'), 'info'); // allow-getstate: event handler
      // Cached results lack the new link; drop them and reload this panel.
      await similarAPI.reset().catch(() => undefined);
      useSimilarStore.getState().retry(panelId); // allow-getstate: event handler
    } catch (err) {
      console.error('[SimilarPane] Could not add cross-reference:', err);
      useToastStore.getState().addToast(t('similar.xrefFailed'), 'error'); // allow-getstate: event handler
    }
  };

  const store = () => useSimilarStore.getState(); // allow-getstate: event handlers
  const status = ps?.status ?? 'idle';
  const hasRows = rows.length > 0;
  const canShowMore = !!ps && hasRows && rows.length >= ps.maxResults && ps.maxResults < SIMILAR_MAX_RESULTS;

  let body: React.ReactNode;
  if (!source || (status === 'idle')) {
    body = <p className="p-4 text-sm opacity-70" data-testid="similar-idle">{t('similar.idle')}</p>;
  } else if (status === 'unavailable') {
    const key = ps?.unavailableReason === 'range-needs-live' ? 'similar.needsLive'
      : ps?.unavailableReason === 'no-data' ? 'similar.noData' : 'similar.noPack';
    body = (
      <div className="p-4 text-sm" data-testid="similar-unavailable">
        <p>{t(key)}</p>
        {ps?.unavailableReason !== 'no-data' && (
          <button type="button" className="mt-2 underline" onClick={() => openModuleManager()}>
            {t('similar.openModuleManager')}
          </button>
        )}
      </div>
    );
  } else if (status === 'error') {
    body = (
      <div className="p-4 text-sm" data-testid="similar-error">
        <p>{ps?.error === 'timeout' ? t('similar.timeout') : t('similar.error')}</p>
        <button type="button" className="mt-2 underline" onClick={() => store().retry(panelId)}>{t('similar.retry')}</button>
      </div>
    );
  } else if (status === 'preparing' && !hasRows) {
    body = <p className="p-4 text-sm opacity-70" data-testid="similar-preparing">{t('similar.preparing')}</p>;
  } else if (status === 'loading' && !hasRows) {
    body = <p className="p-4 text-sm opacity-70" data-testid="similar-loading">{t('similar.loading')}</p>;
  } else if (!hasRows) {
    body = <p className="p-4 text-sm opacity-70" data-testid="similar-empty">{t('similar.empty')}</p>;
  } else {
    body = (
      <>
        <div style={{ opacity: status === 'ready' ? 1 : 0.6 }}>
          <SimilarList
            rows={rows}
            floor={ps?.result?.floor ?? 0}
            labels={{ ...DEFAULT_SIMILAR_LIST_LABELS, ...labels }}
            onOpen={onOpen}
            onMoreLike={onMoreLike}
            onMenu={onMenu}
            reasonsFor={reasonsFor}
            onVisible={onVisible}
          />
        </div>
        {canShowMore && (
          <div className="p-2 text-center">
            <button type="button" className="underline text-sm" data-testid="similar-show-more"
              onClick={() => store().showMore(panelId)}>
              {t('similar.showMore')}
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="h-full flex flex-col" data-testid="similar-pane" style={{ backgroundColor: 'var(--theme-bg-primary)' }}>
      <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: 'var(--theme-border-primary)' }}>
        <button
          type="button"
          className="control-nav-button"
          aria-label={t('similar.back')}
          title={t('similar.back')}
          disabled={!ps || ps.history.length === 0}
          onClick={() => store().goBack(panelId)}
          data-testid="similar-back"
        >
          <span aria-hidden="true" className="rtl-mirror">{'←'}</span>
        </button>
        <h2 className="text-sm font-semibold flex-1 truncate" data-testid="similar-header">
          {source ? t('similar.header', { reference: format(source) }) : t('paneName.similar')}
        </h2>
        <label className="text-xs flex items-center gap-1">
          <input
            type="checkbox"
            checked={ps?.linked ?? true}
            onChange={e => store().setLinked(panelId, e.target.checked)}
            data-testid="similar-linked"
          />
          {t('similar.linkToPane')}
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3 px-3 py-2 text-xs border-b" style={{ borderColor: 'var(--theme-border-primary)' }}>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={ps?.filters.hideKnownXrefs ?? false}
            onChange={e => store().setFilters(panelId, { hideKnownXrefs: e.target.checked })}
            data-testid="similar-hide-xrefs"
          />
          {t('similar.hideKnownXrefs')}
        </label>
        <div role="radiogroup" aria-label={t('similar.testament')} className="flex items-center gap-1">
          <span>{t('similar.testament')}:</span>
          {TESTAMENTS.map(v => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={(ps?.filters.testament ?? 'any') === v}
              className={(ps?.filters.testament ?? 'any') === v ? 'font-semibold underline' : 'opacity-70'}
              onClick={() => store().setFilters(panelId, { testament: v })}
              data-testid={`similar-testament-${v}`}
            >
              {t(TESTAMENT_KEYS[v])}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">{body}</div>

      {menu && (
        <div
          role="menu"
          className="fixed z-50 border rounded shadow text-sm"
          style={{ ...anchorAtPointerX(menu.x), top: menu.y, backgroundColor: 'var(--theme-bg-primary)', borderColor: 'var(--theme-border-primary)' }}
          onMouseDown={e => e.stopPropagation()}
        >
          <button type="button" role="menuitem" className="block w-full text-start px-3 py-1.5 hover:bg-background-hover" onClick={() => copyReference(menu.row)}>
            {t('similar.copyReference')}
          </button>
          <button type="button" role="menuitem" className="block w-full text-start px-3 py-1.5 hover:bg-background-hover" onClick={() => void addXref(menu.row)}>
            {t('similar.addXref')}
          </button>
        </div>
      )}
    </div>
  );
};

export default SimilarPane;

