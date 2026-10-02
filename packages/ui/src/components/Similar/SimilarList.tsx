/**
 * SimilarList: a fully controlled list of passages similar to a source passage (task 0070). Each row shows the
 * reference, a 5-step similarity bar, badges, a text excerpt, "why" chips and a "More like this" action. No state
 * of its own; the app hydrates rows (reference, text) and handles the callbacks.
 */
import { useEffect, useRef } from 'react';
import type { MatchReason, SimilarPassage } from '@bible/core/browser';

export type SimilarListRow = SimilarPassage & { key: string; reference: string; text: string };

export interface SimilarListLabels {
  moreLikeThis: string;
  crossRef: string;
  otNtBadge: string;
  similarInMeaning: string;
  /** `{step}` and `{max}` are replaced. */
  barLabel: string;
  menu: string;
  empty: string;
}

export const DEFAULT_SIMILAR_LIST_LABELS: SimilarListLabels = {
  moreLikeThis: 'More like this',
  crossRef: 'Cross-reference',
  otNtBadge: 'OT ↔ NT',
  similarInMeaning: 'Similar in meaning',
  barLabel: 'Similarity {step} of {max}',
  menu: 'More actions',
  empty: 'No similar passages found.',
};

export interface SimilarListProps {
  rows: readonly SimilarListRow[];
  /** Lower end of the bar scale (the source's neighbour floor). Default 0. */
  floor?: number;
  labels?: Partial<SimilarListLabels>;
  onOpen: (row: SimilarListRow, e: { newTab: boolean }) => void;
  onMoreLike: (row: SimilarListRow) => void;
  onMenu?: (row: SimilarListRow, anchor: HTMLElement) => void;
  /** `undefined`: show no chips. An empty array: show the "Similar in meaning" fallback chip. */
  reasonsFor?: (row: SimilarListRow) => MatchReason[] | undefined;
  /** Fires once per row when it first becomes visible (immediately without IntersectionObserver). */
  onVisible?: (row: SimilarListRow) => void;
}

const STEPS = 5;

/** Bar step 1..5 from similarity normalised over [floor, top1]. Degenerate scales give 5 (or 1 below the floor). */
export function similarityStep(similarity: number, floor: number, top1: number): 1 | 2 | 3 | 4 | 5 {
  const span = top1 - floor;
  if (!(span > 0)) return similarity >= top1 ? 5 : 1;
  const t = (similarity - floor) / span;
  if (!Number.isFinite(t)) return 1;
  const step = Math.ceil(Math.min(1, Math.max(0, t)) * STEPS);
  return Math.max(1, Math.min(STEPS, step)) as 1 | 2 | 3 | 4 | 5;
}

function reasonChips(reasons: MatchReason[]): Array<{ id: string; kind: string; text: string }> {
  const out: Array<{ id: string; kind: string; text: string }> = [];
  reasons.forEach((r, i) => {
    if (r.kind === 'lemma') {
      const text = [r.strongs, r.lemma, r.gloss ? `"${r.gloss}"` : ''].filter(Boolean).join(' ');
      out.push({ id: `lemma-${i}`, kind: 'lemma', text });
    } else if (r.kind === 'topic') {
      // Topic tags are deliberately not shown: they are often one link of a longer chain and read as confusing.
      return;
    } else {
      out.push({ id: `words-${i}`, kind: 'words', text: r.words.join(', ') });
    }
  });
  return out;
}

function SimilarRow({
  row,
  step,
  reasons,
  l,
  onOpen,
  onMoreLike,
  onMenu,
  onVisible,
}: {
  row: SimilarListRow;
  step: number;
  reasons: MatchReason[] | undefined;
  l: SimilarListLabels;
  onOpen: SimilarListProps['onOpen'];
  onMoreLike: SimilarListProps['onMoreLike'];
  onMenu: SimilarListProps['onMenu'];
  onVisible: SimilarListProps['onVisible'];
}) {
  const ref = useRef<HTMLLIElement | null>(null);
  const fired = useRef(false);
  const cb = useRef(onVisible);
  cb.current = onVisible;

  useEffect(() => {
    if (fired.current) return;
    const fire = () => {
      if (fired.current) return;
      fired.current = true;
      cb.current?.(row);
    };
    const el = ref.current;
    if (typeof IntersectionObserver === 'undefined' || !el) {
      fire();
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        fire();
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [row.key]);

  const shown = reasons === undefined ? null : reasonChips(reasons);
  const chips = shown === null ? null : shown.length === 0 ? [{ id: 'fallback', kind: 'fallback', text: l.similarInMeaning }] : shown;

  return (
    <li ref={ref} className="kth-similar__row">
      <div className="kth-similar__head">
        <button
          type="button"
          className="kth-similar__ref"
          onClick={(e) => onOpen(row, { newTab: e.ctrlKey || e.metaKey })}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              onOpen(row, { newTab: true });
            }
          }}
        >
          {row.reference}
        </button>
        <span
          className="kth-similar__bar"
          role="img"
          aria-label={l.barLabel.replace('{step}', String(step)).replace('{max}', String(STEPS))}
          data-step={step}
        >
          {Array.from({ length: STEPS }, (_, i) => (
            <span key={i} className={`kth-similar__seg${i < step ? ' kth-similar__seg--on' : ''}`} />
          ))}
        </span>
        {row.isCrossReference ? <span className="kth-similar__badge kth-similar__badge--xref">{l.crossRef}</span> : null}
        {row.crossesTestament ? <span className="kth-similar__badge kth-similar__badge--testament">{l.otNtBadge}</span> : null}
      </div>
      <p className="kth-similar__text">{row.text}</p>
      {chips ? (
        <ul className="kth-similar__chips">
          {chips.map((c) => (
            <li key={c.id} className={`kth-similar__chip kth-similar__chip--${c.kind}`}>
              {c.text}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="kth-similar__actions">
        <button type="button" className="kth-btn kth-btn--sm" aria-label={`${l.moreLikeThis}: ${row.reference}`} onClick={() => onMoreLike(row)}>
          {l.moreLikeThis}
        </button>
        {onMenu ? (
          <button
            type="button"
            className="kth-btn kth-btn--sm kth-similar__menu"
            aria-label={`${l.menu}: ${row.reference}`}
            aria-haspopup="menu"
            onClick={(e) => onMenu(row, e.currentTarget)}
          >
            {'⋯'}
          </button>
        ) : null}
      </div>
    </li>
  );
}

export function SimilarList({ rows, floor = 0, labels, onOpen, onMoreLike, onMenu, reasonsFor, onVisible }: SimilarListProps) {
  const l: SimilarListLabels = { ...DEFAULT_SIMILAR_LIST_LABELS, ...labels };
  if (rows.length === 0) return <p className="kth-similar__empty">{l.empty}</p>;
  const top1 = rows.reduce((m, r) => Math.max(m, r.similarity), -Infinity);
  return (
    <ul className="kth-similar" role="list">
      {rows.map((r) => (
        <SimilarRow
          key={r.key}
          row={r}
          step={similarityStep(r.similarity, floor, top1)}
          reasons={reasonsFor?.(r)}
          l={l}
          onOpen={onOpen}
          onMoreLike={onMoreLike}
          onMenu={onMenu}
          onVisible={onVisible}
        />
      ))}
    </ul>
  );
}
