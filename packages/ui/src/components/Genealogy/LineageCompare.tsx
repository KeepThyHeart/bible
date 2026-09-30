/**
 * LineageCompare: two (or more) lineages side by side as ordered names with their verse references, marking
 * people who appear in only one of them and names the text skips (gaps).
 */
import type { GenealogyGraph, LineageDto } from '@bible/core/browser';
import { fill } from './util';

export interface LineageCompareLabels {
  oneTextOnly: string;
  /** `{names}` (comma-joined) and `{count}` are replaced. */
  gap: string;
  openVerse: string;
}

export const DEFAULT_LINEAGE_COMPARE_LABELS: LineageCompareLabels = {
  oneTextOnly: 'in this text only',
  gap: '{count} not named here: {names}',
  openVerse: 'Open {verse}',
};

export interface LineageCompareProps {
  graph: GenealogyGraph;
  lineages: LineageDto[];
  formatVerse?: (verseId: number) => string;
  labels?: Partial<LineageCompareLabels>;
  onOpenVerse?: (verseId: number) => void;
  onPick?: (personId: string) => void;
}

export function LineageCompare({ graph, lineages, formatVerse = String, labels: overrides, onOpenVerse, onPick }: LineageCompareProps) {
  const labels = { ...DEFAULT_LINEAGE_COMPARE_LABELS, ...overrides };
  const memberOf = new Map<string, number>();
  for (const l of lineages) for (const id of new Set(l.steps.map((s) => s.personId))) memberOf.set(id, (memberOf.get(id) ?? 0) + 1);
  const nameOf = (id: string) => graph.person(id)?.name ?? id;

  return (
    <div className="kth-genealogy-compare">
      {lineages.map((l) => (
        <section key={l.id} className="kth-genealogy-compare__column" aria-label={l.name}>
          <h3 className="kth-genealogy-card__heading">{l.name}</h3>
          <ol className="kth-genealogy-compare__list">
            {l.steps.map((s, i) => {
              const only = lineages.length > 1 && memberOf.get(s.personId) === 1;
              return (
                <li key={`${s.personId}-${i}`} className="kth-genealogy-compare__step" data-one-text={only ? 'true' : undefined}>
                  {s.gapBefore && s.gapBefore.length > 0 && (
                    <p className="kth-genealogy-compare__gap">
                      {fill(labels.gap, { count: s.gapBefore.length, names: s.gapBefore.map(nameOf).join(', ') })}
                    </p>
                  )}
                  <button type="button" className="kth-btn kth-btn--ghost kth-btn--sm" onClick={() => onPick?.(s.personId)}>
                    {nameOf(s.personId)}
                  </button>
                  <button type="button" className="kth-btn kth-btn--ghost kth-btn--sm kth-genealogy-card__verse"
                    aria-label={fill(labels.openVerse, { verse: formatVerse(s.verseId) })} onClick={() => onOpenVerse?.(s.verseId)}>
                    {formatVerse(s.verseId)}
                  </button>
                  {only && <span className="kth-badge kth-genealogy-compare__marker">{labels.oneTextOnly}</span>}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
