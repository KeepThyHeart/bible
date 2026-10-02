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

/** Longest term (token sequence) that starts exactly at `at`; its length, or 0. */
function termLengthAt(tokens: string[], at: number, terms: string[][]): number {
  let best = 0;
  for (const t of terms) {
    if (t.length <= best || at + t.length > tokens.length) continue;
    if (t.every((w, k) => tokens[at + k] === w)) best = t.length;
  }
  return best;
}

/**
 * The last token of the whole measurement phrase that ends in the unit word at `end`: the other parts of
 * "a cubit and a span" and a closing fraction ("two cubits and a half"). Driven by the module language's
 * `pack.grammar`; undefined (the conversion then follows the unit word) when the pack has none, the
 * phrase does not run past the unit word, or the following words do not match the occurrence's parts.
 */
function findPhraseEnd(
  occ: MeasureOccurrence, end: number, tokens: string[], ctx: AnchorContext, numberWords: Set<string>,
): number | undefined {
  const g = ctx.pack.grammar;
  if (!g) return undefined;
  const norm = (list: string[]): Set<string> => new Set(list.map((w) => normalizeToken(w)));
  const connectors = norm(g.connectors);
  const articles = norm(g.articles);
  const fractions = norm(g.fractions);
  const filler = (t: string): boolean => connectors.has(t) || articles.has(t) || fractions.has(t) || numberWords.has(t) || NUMBER_RE.test(t);
  const MAX_GAP = 6;

  let last = end;
  for (let pi = 1; pi < occ.parts.length; pi++) {
    const terms = termsFor(occ.parts[pi].unit, undefined, ctx);
    let i = last + 1;
    const from = i;
    while (i < tokens.length && i - from < MAX_GAP && filler(tokens[i]) && !termLengthAt(tokens, i, terms)) i++;
    const len = termLengthAt(tokens, i, terms);
    if (!len) return undefined; // the second unit is not where the data says: not confident
    last = i + len - 1;
  }

  const lastQty = occ.parts[occ.parts.length - 1]?.quantity?.value;
  if (lastQty !== undefined && !Number.isInteger(lastQty)) {
    let i = last + 1;
    while (i < tokens.length && i - last <= 2 && (connectors.has(tokens[i]) || articles.has(tokens[i]))) i++;
    if (i < tokens.length && fractions.has(tokens[i]) && i > last) last = i;
  }
  return last > end ? last : undefined;
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
  // Number words come from the module-language pack (an article such as "a" is not one: "a foot" is no count).
  const numberWords = new Set<string>((ctx.pack.numberWords ?? []).map((w) => normalizeToken(w)));
  const rankByUnit = new Map<string, number>();
  const results: ResolvedMeasureAnchor[] = [];

  for (const occ of ordered) {
    const unitId = occ.parts[0]?.unit;
    const unit = unitId ? ctx.registry.unit(unitId) : undefined;
    const rank = (rankByUnit.get(unitId ?? '') ?? 0) + 1;
    rankByUnit.set(unitId ?? '', rank);
    const make = (r: Range, via: 'strongs' | 'terms' | 'modern'): ResolvedMeasureAnchor => {
      claim(r, claimed);
      const phraseEnd = findPhraseEnd(occ, r.end, tokens, ctx, numberWords);
      return {
        occId: occ.id, verseId: verse.verseId, target: { kind: 'tokens', start: r.start, end: r.end }, via,
        ...(phraseEnd !== undefined ? { phraseEnd } : {}),
      };
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
