import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { GenealogyExplorer } from '@bible/ui';
import { GenealogyGraph, computeGenealogyLayout, createGenealogyStore, focusPerson } from '@bible/core/browser';
import type { GenealogyStore } from '@bible/core/browser';
import { createDesktopDataProviders } from '../../api/dataProviderAdapter';
import { useI18n } from '../contexts/useI18n';
import { useGenealogyFocusStore } from '../stores/useGenealogyFocusStore';
import { navigateToVerseInPrimary } from '../stores/crossStoreBridge';
import { formatVerseReference } from '../utils/verseReference';

interface GenealogyPaneProps {
  /** Optional, like the other panes, so a detached window can mount the pane without a dockview panel. */
  panelId?: string;
}

/** One provider for the whole renderer: it caches the (large) dataset after the first read. */
type GenealogyProvider = NonNullable<ReturnType<typeof createDesktopDataProviders>['genealogy']>;
let sharedProvider: GenealogyProvider | null = null;
function getGenealogyProvider(): GenealogyProvider {
  if (!sharedProvider) {
    const provider = createDesktopDataProviders().genealogy;
    if (!provider) throw new Error('Genealogy data provider is not available');
    sharedProvider = provider;
  }
  return sharedProvider;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error' }
  | { status: 'ready'; graph: GenealogyGraph };

const centered: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%',
  padding: '20px', textAlign: 'center', fontSize: '13px', color: 'var(--theme-text-secondary)',
};

/**
 * Genealogy pane: the shared `GenealogyExplorer` (line to Christ, family, tribes) over the
 * installed genealogy dataset. The dataset is read once; the explorer state lives in an
 * in-memory store for the life of the pane.
 */
const GenealogyPane: React.FC<GenealogyPaneProps> = ({ panelId }) => {
  const { t } = useI18n();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const store = useMemo<GenealogyStore>(() => createGenealogyStore(), []);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    getGenealogyProvider().getDataset()
      .then((dataset) => {
        if (cancelled) return;
        if (!dataset || dataset.persons.length === 0) setLoad({ status: 'empty' });
        else setLoad({ status: 'ready', graph: GenealogyGraph.from(dataset) });
      })
      .catch(() => { if (!cancelled) setLoad({ status: 'error' }); });
    return () => { cancelled = true; };
  }, [attempt]);

  // "Show family tree" requests from other panes. Applied once the graph exists, so a request that
  // arrives while the dataset is still loading is not lost.
  const request = useGenealogyFocusStore((s) => (panelId ? s.requests[panelId] : undefined));
  const graph = load.status === 'ready' ? load.graph : null;
  useEffect(() => {
    if (!request || !graph || !graph.has(request.personId)) return;
    focusPerson(store, request.personId);
  }, [request, graph, store]);

  const handleOpenVerse = useCallback((verseId: number) => {
    navigateToVerseInPrimary(verseId);
  }, []);

  const labels = useMemo(() => ({
    tabs: t('genealogyPane.tabs'),
    line: t('genealogyPane.line'),
    family: t('genealogyPane.family'),
    tribes: t('genealogyPane.tribes'),
    highlight: t('genealogyPane.highlight'),
    showDisputed: t('genealogyPane.showDisputed'),
    fullscreen: t('genealogyPane.fullscreen'),
    exitFullscreen: t('genealogyPane.exitFullscreen'),
    key: t('genealogyPane.key'),
    showDisputedHint: t('genealogyPane.showDisputedHint'),
    hintLine: t('genealogyPane.hintLine'),
    hintFamily: t('genealogyPane.hintFamily'),
    hintTribes: t('genealogyPane.hintTribes'),
  }), [t]);

  if (load.status === 'loading') {
    return <div data-testid="genealogy-loading" style={centered}>{t('genealogyPane.loading')}</div>;
  }
  if (load.status === 'empty') {
    return <div data-testid="genealogy-empty" style={centered}>{t('genealogyPane.empty')}</div>;
  }
  if (load.status === 'error') {
    return (
      <div data-testid="genealogy-error" style={{ ...centered, flexDirection: 'column', gap: '8px' }}>
        <span>{t('genealogyPane.error')}</span>
        <button type="button" onClick={() => setAttempt((n) => n + 1)}>{t('genealogyPane.retry')}</button>
      </div>
    );
  }

  return (
    <div data-testid="genealogy-pane" style={{ height: '100%', width: '100%' }}>
      <GenealogyExplorer
        graph={load.graph}
        store={store}
        computeLayout={computeGenealogyLayout}
        formatVerse={(verseId) => formatVerseReference(verseId)}
        onOpenVerse={handleOpenVerse}
        labels={labels}
      />
    </div>
  );
};

export default GenealogyPane;
