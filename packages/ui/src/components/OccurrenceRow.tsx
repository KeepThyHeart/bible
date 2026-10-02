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

export function OccurrenceRow({ item, reference, onOpen, renderVerse }: OccurrenceRowProps) {
  return (
    <button type="button" className="kth-ws-occ" onClick={() => onOpen(item)}>
      <span className="kth-ws-occ__head">
        <span className="kth-ws-occ__ref">{reference}</span>
        <span className="kth-ws-chip">{item.form}</span>
        {item.morph && <span className="kth-ws-occ__morph">{item.morph}</span>}
      </span>
      {renderVerse ? (
        <span className="kth-ws-occ__text">{renderVerse(item)}</span>
      ) : item.text ? (
        <span className="kth-ws-occ__text">{highlightWords(item.text, item.start, item.end)}</span>
      ) : null}
    </button>
  );
}
