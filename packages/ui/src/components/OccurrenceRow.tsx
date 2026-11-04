import type { ReactNode } from 'react';
import type { WordOccurrenceItem } from '@bible/core/browser';

export interface OccurrenceRowProps {
  item: WordOccurrenceItem;
  /** Formatted reference ("John 3:16"). */
  reference: string;
  onOpen: (item: WordOccurrenceItem) => void;
  /** Replaces the default verse text (with `item.start..item.end` emphasised). */
  renderVerse?: (item: WordOccurrenceItem) => ReactNode;
}

/** Wrap whitespace-separated words start..end (0-based, inclusive) in `<mark>`. */
export function highlightWords(text: string, start: number, end: number): ReactNode[] {
  const parts = text.split(/(\s+)/).filter((p) => p !== '');
  let word = 0;
  let first = -1;
  let last = -1;
  parts.forEach((p, i) => {
    if (/^\s+$/.test(p)) return;
    if (word === start) first = i;
    if (word <= end) last = i;
    word++;
  });
  if (first < 0 || last < first) return [text];
  const out: ReactNode[] = [];
  if (first > 0) out.push(parts.slice(0, first).join(''));
  out.push(<mark key="hit" className="kth-ws-hit">{parts.slice(first, last + 1).join('')}</mark>);
  if (last + 1 < parts.length) out.push(parts.slice(last + 1).join(''));
  return out;
}

/**
 * Like {@link highlightWords}, with each character range of `divine` wrapped in
 * `<span class="divine-name">` (small caps, as in the reader). Split at every
 * boundary so the span nests cleanly inside the `<mark>`.
 */
export function highlightWithDivineName(text: string, start: number, end: number, divine: Array<{ start: number; end: number }>): ReactNode[] {
  const spans = [...text.matchAll(/\S+/g)];
  const first = spans[start];
  const last = spans[Math.min(end, spans.length - 1)];
  const hit = first && last && last.index! + last[0].length > first.index! ? { start: first.index!, end: last.index! + last[0].length } : null;
  const cuts = new Set<number>([0, text.length]);
  for (const r of [...divine, ...(hit ? [hit] : [])]) { cuts.add(Math.max(0, r.start)); cuts.add(Math.min(text.length, r.end)); }
  const points = [...cuts].sort((a, b) => a - b);
  const covers = (r: { start: number; end: number } | undefined, a: number, b: number) => !!r && r.start <= a && r.end >= b;
  const pieces = points.slice(0, -1).map((a, i) => {
    const b = points[i + 1];
    let node: ReactNode = text.slice(a, b);
    if (divine.some(r => covers(r, a, b))) node = <span key={`d${a}`} className="divine-name kth-ws-occ__divine">{node}</span>;
    return { a, b, node, inHit: covers(hit ?? undefined, a, b) };
  });
  const out: ReactNode[] = [];
  for (let i = 0; i < pieces.length;) {
    if (!pieces[i].inHit) { out.push(pieces[i].node); i++; continue; }
    const group: ReactNode[] = [];
    while (i < pieces.length && pieces[i].inHit) group.push(pieces[i++].node);
    out.push(<mark key={`h${out.length}`} className="kth-ws-hit">{group}</mark>);
  }
  return out;
}

export function OccurrenceRow({ item, reference, onOpen, renderVerse }: OccurrenceRowProps) {
  return (
    <button type="button" className="kth-ws-occ" onClick={() => onOpen(item)}>
      <span className="kth-ws-occ__head">
        <span className="kth-ws-occ__ref">{reference}</span>
        <span className="kth-ws-chip">{item.form}</span>
        {item.morph && <span className="kth-ws-occ__morph">{item.morph}</span>}
      </span>
      {renderVerse ? (
        <span className="kth-ws-occ__text" dir="auto">{renderVerse(item)}</span>
      ) : item.text ? (
        <span className="kth-ws-occ__text" dir="auto">
          {item.divine?.length ? highlightWithDivineName(item.text, item.start, item.end, item.divine) : highlightWords(item.text, item.start, item.end)}
        </span>
      ) : null}
    </button>
  );
}
