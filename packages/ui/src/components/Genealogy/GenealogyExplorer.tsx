/**
 * GenealogyExplorer: the whole explorer. View tabs (line to Christ / family / tribes), the two toggles, person
 * search, the SVG view and the person card. State lives in a core `GenealogyStore` (read with
 * `useSyncExternalStore`); the layout comes from the `computeLayout` prop, so this package never imports the
 * layout functions (the app passes a function that calls layoutLineage / layoutFamily / layoutTribes).
 *
 * The graph handed to `computeLayout` and to the card is rebuilt from `graph.dataset` with the store's chosen
 * readings and `showDisputed`, so toggling them re-layouts without the app rebuilding the graph.
 * Below 600px wide (or with `compact`) the card is a bottom sheet.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { GenealogyGraph, focusPerson } from '@bible/core/browser';
import type { GenealogyState, GenealogyStore, GenealogyViewKind, GraphLayout } from '@bible/core/browser';
import { GenealogyView } from './GenealogyView';
import type { GenealogyViewLabels } from './GenealogyView';
import { PersonCard } from './PersonCard';
import type { PersonCardLabels } from './PersonCard';
import { PersonSearch } from './PersonSearch';
import type { PersonSearchLabels } from './PersonSearch';
import { TribeLegend } from './TribeLegend';
import type { TribeLegendLabels } from './TribeLegend';
import { cx } from './util';

export interface GenealogyExplorerLabels {
  tabs: string;
  line: string;
  family: string;
  tribes: string;
  highlight: string;
  showDisputed: string;
  view: Partial<GenealogyViewLabels>;
  card: Partial<PersonCardLabels>;
  search: Partial<PersonSearchLabels>;
  legend: Partial<TribeLegendLabels>;
}

export const DEFAULT_GENEALOGY_EXPLORER_LABELS: GenealogyExplorerLabels = {
  tabs: 'Genealogy views',
  line: 'Line to Christ',
  family: 'Family',
  tribes: 'Tribes',
  highlight: 'Highlight the line to Christ',
  showDisputed: 'Show disputed links',
  view: {},
  card: {},
  search: {},
  legend: {},
};

export interface GenealogyExplorerProps {
  graph: GenealogyGraph;
  store: GenealogyStore;
  computeLayout: (graph: GenealogyGraph, state: GenealogyState) => GraphLayout;
  formatVerse?: (verseId: number) => string;
  /** Called by the card's Read button and verse links. */
  onOpenVerse?: (verseId: number) => void;
  labels?: Partial<GenealogyExplorerLabels>;
  /** Force the bottom-sheet layout; when omitted it follows the container width (< 600px). */
  compact?: boolean;
}

const COMPACT_WIDTH = 600;
const TABS: GenealogyViewKind[] = ['line', 'family', 'tribes'];

export function GenealogyExplorer({ graph, store, computeLayout, formatVerse, onOpenVerse, labels: overrides, compact }: GenealogyExplorerProps) {
  const labels = { ...DEFAULT_GENEALOGY_EXPLORER_LABELS, ...overrides };
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);

  const effective = useMemo(
    () => GenealogyGraph.from(graph.dataset, { readings: state.readings, showDisputed: state.showDisputed }),
    [graph.dataset, state.readings, state.showDisputed],
  );

  // Selection changes must not re-layout (and refit): key the layout on the layout-relevant fields only.
  const { view, focusId, lineageIds, tribeList, highlightLineToChrist, showMothers, up, down, collapsed } = state;
  const stateRef = useRef(state);
  stateRef.current = state;
  const computeRef = useRef(computeLayout);
  computeRef.current = computeLayout;
  const layout = useMemo(
    () => computeRef.current(effective, stateRef.current),
    [effective, view, focusId, lineageIds, tribeList, highlightLineToChrist, showMothers, up, down, collapsed],
  );

  const rootRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = rootRef.current;
    if (compact !== undefined || !el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setNarrow(el.getBoundingClientRect().width < COMPACT_WIDTH));
    ro.observe(el);
    return () => ro.disconnect();
  }, [compact]);
  const isCompact = compact ?? narrow;

  const tabLabel: Record<GenealogyViewKind, string> = { line: labels.line, family: labels.family, tribes: labels.tribes };
  const select = (id: string) => store.setState((s) => ({ ...s, selectedId: id }));
  const selected = state.selectedId && effective.has(state.selectedId) ? state.selectedId : null;

  return (
    <div ref={rootRef} className={cx('kth-genealogy-explorer', isCompact && 'kth-genealogy-explorer--compact')}>
      <div className="kth-genealogy-explorer__bar">
        <div role="tablist" aria-label={labels.tabs} className="kth-genealogy-explorer__tabs">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={state.view === t}
              className={cx('kth-btn kth-btn--sm', state.view === t && 'kth-btn--primary')}
              onClick={() => store.setState((s) => ({ ...s, view: t }))}
            >
              {tabLabel[t]}
            </button>
          ))}
        </div>
        <label className="kth-genealogy-explorer__toggle">
          <input type="checkbox" checked={state.highlightLineToChrist}
            onChange={(e) => store.setState((s) => ({ ...s, highlightLineToChrist: e.currentTarget.checked }))} />{' '}
          {labels.highlight}
        </label>
        <label className="kth-genealogy-explorer__toggle">
          <input type="checkbox" checked={state.showDisputed}
            onChange={(e) => store.setState((s) => ({ ...s, showDisputed: e.currentTarget.checked }))} />{' '}
          {labels.showDisputed}
        </label>
        <PersonSearch
          graph={effective}
          formatVerse={formatVerse}
          labels={labels.search}
          onPick={(id) => (layout.nodes.some((n) => n.personId === id) ? select(id) : focusPerson(store, id))}
        />
      </div>
      <div className={cx('kth-genealogy-explorer__body', isCompact && 'kth-genealogy-explorer__body--compact')}>
        <div className="kth-genealogy-explorer__main">
          <GenealogyView
            layout={layout}
            selectedId={selected}
            highlight={state.highlightLineToChrist}
            labels={labels.view}
            onSelect={select}
            onFocusPerson={(id) => focusPerson(store, id)}
          />
          {state.view === 'tribes' && <TribeLegend labels={labels.legend} />}
        </div>
        {selected && (
          <PersonCard
            graph={effective}
            personId={selected}
            sheet={isCompact}
            formatVerse={formatVerse}
            labels={labels.card}
            onOpenVerse={onOpenVerse}
            onFocusPerson={(id) => focusPerson(store, id)}
            onSelectReading={(group, reading) => store.setState((s) => ({ ...s, readings: { ...s.readings, [group]: reading } }))}
            onClose={() => store.setState((s) => ({ ...s, selectedId: null }))}
          />
        )}
      </div>
    </div>
  );
}
