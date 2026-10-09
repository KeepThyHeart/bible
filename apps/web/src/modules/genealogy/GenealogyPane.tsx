import { useEffect, useMemo, useState } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { GenealogyExplorer } from '@bible/ui';
import { GenealogyGraph, createGenealogyStore, focusPerson, computeGenealogyLayout } from '@bible/core/browser';
import type { GenealogyDatasetDto, IGenealogyDataProvider } from '@bible/core/browser';
import { formatPassageRef } from '../../constants';
import { parseVerseId } from '../../utils/verseId';

/** A request to centre the family tree on a person (the token changes on every request). */
export interface FamilyTreeFocus {
  personId: string;
  name?: string;
  token: number;
}

interface GenealogyPaneProps {
  provider?: IGenealogyDataProvider;
  /** Person to centre on. Re-applied whenever `token` changes. */
  focus?: FamilyTreeFocus | null;
  /** Phone layout: the person card is a bottom sheet regardless of width. */
  compact?: boolean;
  /** Read button / verse links on the person card. */
  onOpenVerse?: (verseId: number) => void;
}

/**
 * Find the genealogy person a request means. The Topics pane knows a person by
 * its tag-graph entity id and name, which are not guaranteed to be the genealogy
 * dataset's ids, so try: the id itself, an external id, then the name.
 */
export function resolvePersonId(graph: GenealogyGraph, focus: { personId: string; name?: string }): string | null {
  if (graph.has(focus.personId)) return focus.personId;
  const external = graph.dataset.externalIds;
  if (external) {
    for (const [personId, schemes] of Object.entries(external)) {
      if (graph.has(personId) && Object.values(schemes).includes(focus.personId)) return personId;
    }
  }
  if (focus.name) {
    const byName = graph.findByName(focus.name);
    if (byName.length > 0) return byName[0].id;
  }
  return null;
}

function formatVerse(verseId: number): string {
  const { bookNumber, chapter, verse } = parseVerseId(verseId);
  return formatPassageRef(bookNumber, chapter, verse);
}

type LoadState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error' }
  | { status: 'ready'; dataset: GenealogyDatasetDto };

/**
 * Family tree mode of the Study pane: loads the genealogy dataset once, builds
 * the graph and a view store, and hands them to the shared `GenealogyExplorer`.
 */
export function GenealogyPane({ provider, focus, compact, onOpenVerse }: GenealogyPaneProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const store = useMemo(() => createGenealogyStore(), []);

  useEffect(() => {
    if (!provider) {
      setState({ status: 'empty' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    provider.getDataset().then(
      (dataset) => {
        if (cancelled) return;
        setState(dataset && dataset.persons.length > 0 ? { status: 'ready', dataset } : { status: 'empty' });
      },
      (error) => {
        console.error('Error loading genealogy dataset:', error);
        if (!cancelled) setState({ status: 'error' });
      },
    );
    return () => { cancelled = true; };
  }, [provider, attempt]);

  const graph = useMemo(
    () => (state.status === 'ready' ? GenealogyGraph.from(state.dataset) : null),
    [state],
  );

  useEffect(() => {
    if (!graph || !focus) return;
    const id = resolvePersonId(graph, focus);
    if (id) focusPerson(store, id);
  }, [graph, store, focus?.token]);

  const labels = {
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
  };

  return (
    <div class="genealogy-pane">
      {state.status === 'loading' && <div class="genealogy-pane__message">{t('genealogyPane.loading')}</div>}
      {state.status === 'empty' && <div class="genealogy-pane__message">{t('genealogyPane.empty')}</div>}
      {state.status === 'error' && (
        <div class="genealogy-pane__message genealogy-pane__message--error">
          <span>{t('genealogyPane.error')}</span>
          <button class="genealogy-pane__retry" onClick={() => setAttempt(a => a + 1)}>{t('genealogyPane.retry')}</button>
        </div>
      )}
      {graph && (
        <GenealogyExplorer
          graph={graph}
          store={store}
          computeLayout={computeGenealogyLayout}
          formatVerse={formatVerse}
          onOpenVerse={onOpenVerse}
          labels={labels}
          compact={compact}
        />
      )}
    </div>
  );
}
