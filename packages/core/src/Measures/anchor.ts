/**
 * Anchoring: where in one translation's words does each occurrence of a verse
 * land? Strong's first (when interlinear spans exist), then the unit's words
 * ("terms"), then modern-unit words after a number, then the whole verse.
 * Pure; indices are the shared word-index space (`extractWordsWithFormatting`).
 */
import { normalizeStrongs, primaryLanguage } from '../KeywordMarks/connectives';
import { normalizeToken, tokenizePhrase } from '../KeywordMarks/matcher';
import type { InterlinearSpan } from '../KeywordMarks/types';
import type { MeasureRegistry } from './registry';
import type { MeasureLocalePack, MeasureOccurrence, MeasureVerseInput, ResolvedMeasureAnchor } from './types';

export interface AnchorContext {
  /** Language of the Bible module (BCP 47). */
  language: string;
  /** Interlinear spans of this verse, when the module has them. */
  interlinear?: InterlinearSpan[];
  /** Locale pack in the module's language. */
  pack: MeasureLocalePack;
  registry: MeasureRegistry;
}

interface Range { start: number; end: number }

const ENGLISH_NUMBER_WORDS = [
  'a', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty',
  'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand', 'half',
];
// 'a' alone ("a foot") is not a number for our purposes; handled below.
const NUMBER_RE = /^\d[\d,]*(\.\d+)?$/;

function ordinalOf(id: string): number {
  const n = Number(id.slice(id.lastIndexOf('.') + 1));
  return Number.isFinite(n) ? n : 0;
}

function overlaps(r: Range, claimed: Set<number>): boolean {
  for (let i = r.start; i <= r.end; i++) if (claimed.has(i)) return true;
  return false;
}

function claim(r: Range, claimed: Set<number>): void {
  for (let i = r.start; i <= r.end; i++) claimed.add(i);
}

/** All matches of any term (token sequences) in the verse; longest wins at a start. Sorted by start. */
function findTermMatches(tokens: string[], terms: string[][]): Range[] {
  const out: Range[] = [];
  for (let i = 0; i < tokens.length; i++) {
    let best = 0;
    for (const t of terms) {
      if (t.length <= best || i + t.length > tokens.length) continue;
      let ok = true;
      for (let k = 0; k < t.length; k++) if (tokens[i + k] !== t[k]) { ok = false; break; }
      if (ok) best = t.length;
    }
    if (best) {
      out.push({ start: i, end: i + best - 1 });
      i += best - 1;
    }
  }
  return out;
}

function termsFor(key: string, occ: MeasureOccurrence | undefined, ctx: AnchorContext): string[][] {
  const list = [...(ctx.pack.terms[key] ?? [])];
  if (occ && !key.endsWith('#modern')) list.push(...(occ.anchor?.terms?.[primaryLanguage(ctx.language)] ?? []));
  return list.map((t) => tokenizePhrase(t)).filter((t) => t.length > 0);
}

function isNumberToken(tok: string | undefined, words: Set<string>): boolean {
  if (!tok) return false;
  return NUMBER_RE.test(tok) || words.has(tok);
}

function pickNth(cands: Range[], n: number, claimed: Set<number>): Range | undefined {
  const nth = cands[n - 1];
  if (!nth) return undefined;
  if (!overlaps(nth, claimed)) return nth;
  return cands.slice(n).find((c) => !overlaps(c, claimed));
}

export function resolveMeasureAnchors(
  occs: readonly MeasureOccurrence[],
  verse: MeasureVerseInput,
  ctx: AnchorContext,
): ResolvedMeasureAnchor[] {
  const tokens = verse.words.map((w) => normalizeToken(w.text));
  const ordered = [...occs].sort((a, b) => ordinalOf(a.id) - ordinalOf(b.id));
  const claimed = new Set<number>();
  const spans = (ctx.interlinear ?? []).filter((s) => s.verseId === verse.verseId);
  const numberWords = new Set<string>(
    (ctx.pack.numberWords ?? (primaryLanguage(ctx.language) === 'en' ? ENGLISH_NUMBER_WORDS.filter((w) => w !== 'a') : [])).map((w) => normalizeToken(w)),
  );
  const rankByUnit = new Map<string, number>();
  const results: ResolvedMeasureAnchor[] = [];

  for (const occ of ordered) {
    const unitId = occ.parts[0]?.unit;
    const unit = unitId ? ctx.registry.unit(unitId) : undefined;
    const rank = (rankByUnit.get(unitId ?? '') ?? 0) + 1;
    rankByUnit.set(unitId ?? '', rank);
    const make = (r: Range, via: 'strongs' | 'terms' | 'modern'): ResolvedMeasureAnchor => {
      claim(r, claimed);
      return { occId: occ.id, verseId: verse.verseId, target: { kind: 'tokens', start: r.start, end: r.end }, via };
    };

    const unitTerms = unitId ? termsFor(unitId, occ, ctx) : [];

    // 1. Strong's
    const target = occ.anchor?.textOnly ? undefined : normalizeStrongs(occ.anchor?.strongs ?? unit?.strongs?.[0])[0];
    if (spans.length && target) {
      const seen = new Set<string>();
      const cands: Range[] = [];
      for (const s of spans) {
        if (!normalizeStrongs(s.strongs).includes(target)) continue;
        let r: Range = { start: s.start, end: s.end };
        const inside = findTermMatches(tokens.slice(r.start, r.end + 1), unitTerms);
        if (inside.length) r = { start: r.start + inside[0].start, end: r.start + inside[0].end };
        else if (r.end - r.start + 1 > 2) r = { start: r.end, end: r.end };
        const k = `${r.start}-${r.end}`;
        if (!seen.has(k)) { seen.add(k); cands.push(r); }
      }
      cands.sort((a, b) => a.start - b.start || a.end - b.end);
      const hit = pickNth(cands, occ.anchor?.n ?? 1, claimed);
      if (hit) { results.push(make(hit, 'strongs')); continue; }
    }

    // 2. the unit's words
    if (unitTerms.length) {
      const hit = pickNth(findTermMatches(tokens, unitTerms), rank, claimed);
      if (hit) { results.push(make(hit, 'terms')); continue; }
    }

    // 3. modern-unit words directly after a number
    const modern = unitId ? termsFor(`${unitId}#modern`, undefined, ctx) : [];
    if (modern.length) {
      const matches = findTermMatches(tokens, modern).filter((m) => isNumberToken(tokens[m.start - 1], numberWords));
      const hit = pickNth(matches, rank, claimed);
      if (hit) { results.push(make(hit, 'modern')); continue; }
    }

    // 4. the verse
    results.push({ occId: occ.id, verseId: verse.verseId, target: { kind: 'verse' }, via: 'verse' });
  }
  return results;
}
