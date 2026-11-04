/**
 * Divine-name markup for search results (B-167).
 *
 * Search text is the verse's plain text with `<strong><u>` around matches, so
 * "the LORD" (YHWH) and "O Lord" (Adonai) read the same. The verse's HTML
 * marks the former `<span class="divine-name">`; these helpers recover those
 * character ranges and lay them back over the plain text together with the
 * match highlights, always as well-formed HTML.
 */

import type { BibleVerse } from '../Data/Models/Bible/BibleVerse';
import { formatVerseText } from './VerseFormatter';

export interface TextRange { start: number; end: number }

const TAG = /<(\/?)(\w+)([^>]*)>/g;

/**
 * Character ranges (in the tag-stripped text) inside `<span class="divine-name">`.
 * Null when the stripped HTML is not exactly `plain` (entities, whitespace edits):
 * the offsets could not be trusted, so the caller keeps plain output.
 */
export function divineRangesFromHtml(html: string, plain: string): TextRange[] | null {
  if (!html || !html.includes('divine-name')) return [];
  const ranges: TextRange[] = [];
  const stack: boolean[] = []; // per open <span>: is it a divine-name span
  let divineDepth = 0;
  let out = 0;
  let cursor = 0;
  let open = -1;
  const advance = (chunk: string): void => { out += chunk.length; };
  for (const m of html.matchAll(TAG)) {
    advance(html.slice(cursor, m.index));
    cursor = m.index + m[0].length;
    if (m[2].toLowerCase() !== 'span') continue;
    if (m[1]) {
      const wasDivine = stack.pop();
      if (wasDivine && --divineDepth === 0 && open >= 0) {
        if (out > open) ranges.push({ start: open, end: out });
        open = -1;
      }
    } else {
      const isDivine = /class\s*=\s*"[^"]*\bdivine-name\b/.test(m[3]);
      stack.push(isDivine);
      if (isDivine && divineDepth++ === 0) open = out;
    }
  }
  advance(html.slice(cursor));
  return out === plain.length ? ranges : null;
}

/**
 * `text` with `<strong><u>` around each of `matches` and a divine-name span
 * around each of `divine`, clipped to [from, to) and shifted so offsets are
 * relative to `from`. Split at every boundary, so nesting is always valid.
 */
export function markUp(text: string, from: number, to: number, matches: TextRange[], divine: TextRange[]): string {
  const cuts = new Set<number>([from, to]);
  for (const r of [...matches, ...divine]) {
    if (r.end <= from || r.start >= to) continue;
    cuts.add(Math.max(r.start, from));
    cuts.add(Math.min(r.end, to));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const covers = (list: TextRange[], a: number, b: number): boolean => list.some(r => r.start <= a && r.end >= b);
  let result = '';
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    let piece = text.slice(a, b);
    if (covers(matches, a, b)) piece = `<strong><u>${piece}</u></strong>`;
    if (covers(divine, a, b)) piece = `<span class="divine-name">${piece}</span>`;
    result += piece;
  }
  return result;
}

/** Divine-name character ranges of `text` (the verse's plain text), from its formatted HTML; null/empty when it has none. */
export function divineRangesOfVerse(verse: BibleVerse, text: string): TextRange[] | null {
  const fd = verse.formattingData as { divineName?: unknown[]; divine_name?: unknown[] } | undefined;
  const marked = verse.text.includes('<divineName') || !!fd?.divineName?.length || !!fd?.divine_name?.length;
  if (!marked) return null;
  return divineRangesFromHtml(formatVerseText(verse).textHtml, text);
}
