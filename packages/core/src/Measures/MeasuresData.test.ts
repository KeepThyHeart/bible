/**
 * Validates the shipped measures data (task 0069): registry, locale packs and
 * occurrence rows agree with each other, and every row builds a popup.
 */
import { describe, it, expect } from 'vitest';
import units from './data/units.json';
import sources from './data/sources.json';
import ot from './data/occurrences/ot.json';
import nt from './data/occurrences/nt.json';
import { getMeasureRegistry } from './registry';
import { getMeasureLocalePack } from './locale';
import { buildMeasurePopup } from './popup';
import { resolveMeasurePreferences } from './prefs';
import type { MeasureOccurrence, MeasureSource, MeasureUnitDef } from './types';
import { MAX_CHAPTERS } from '../Data/Core/BookNames';
import { resolveMeasureAnchors } from './anchor';
import { normalizeToken, tokenizePhrase } from '../KeywordMarks/matcher';
import { extractWordsWithFormatting } from '../Services/WordIndexing';
import fixtureJson from './__fixtures__/kjv-measure-verses.json';

const UNITS = units as unknown as MeasureUnitDef[];
const SOURCES = sources as unknown as MeasureSource[];
const ROWS = [...(ot as unknown as MeasureOccurrence[]), ...(nt as unknown as MeasureOccurrence[])];

describe('measures data', () => {
  const unitIds = new Set(UNITS.map((u) => u.id));
  const en = getMeasureLocalePack('en');

  it('registry: unique ids, known relations and sources, sane ranges', () => {
    expect(unitIds.size).toBe(UNITS.length);
    const sourceIds = new Set(SOURCES.map((s) => s.id));
    for (const u of UNITS) {
      if (u.relation) expect(unitIds.has(u.relation.unit), `${u.id} relation`).toBe(true);
      for (const s of u.sources) expect(sourceIds.has(s), `${u.id} source ${s}`).toBe(true);
      for (const a of [u.base, u.money?.wages, u.money?.metal?.grams]) {
        if (!a) continue;
        expect(a.value, u.id).toBeGreaterThan(0);
        if (a.low !== undefined) expect(a.low, u.id).toBeLessThanOrEqual(a.value);
        if (a.high !== undefined) expect(a.high, u.id).toBeGreaterThanOrEqual(a.value);
      }
      expect(en.names[u.id], `en name ${u.id}`).toBeDefined();
      expect(en.notes[u.noteKey ?? u.id], `en note ${u.id}`).toBeTruthy();
    }
  });

  it('occurrences: valid verse ids, unique ids, known units and notes', () => {
    expect(ROWS.length).toBeGreaterThan(500);
    const ids = new Set<string>();
    for (const r of ROWS) {
      expect(ids.has(r.id), `duplicate ${r.id}`).toBe(false);
      ids.add(r.id);
      expect(r.id.startsWith(`${r.verseId}.`), r.id).toBe(true);
      const book = Math.floor(r.verseId / 1_000_000);
      const chapter = Math.floor((r.verseId % 1_000_000) / 1000);
      expect(book >= 1 && book <= 66, r.id).toBe(true);
      expect(chapter >= 1 && chapter <= MAX_CHAPTERS[book], r.id).toBe(true);
      expect(r.parts.length, r.id).toBeGreaterThan(0);
      for (const p of r.parts) {
        expect(unitIds.has(p.unit), `${r.id} unit ${p.unit}`).toBe(true);
        if (p.quantity) expect(p.quantity.value, r.id).toBeGreaterThan(0);
      }
      expect(['literal', 'illustrative', 'figurative']).toContain(r.usage);
      expect(['draft', 'reviewed', 'approved']).toContain(r.review.status);
      if (r.noteKey) expect(en.notes[r.noteKey], `${r.id} note ${r.noteKey}`).toBeTruthy();
    }
    // Sorted by verse, so the per-testament chunks stay diffable.
    const order = ROWS.map((r) => r.verseId);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('every row builds a popup in en, es and zh-Hans', () => {
    const registry = getMeasureRegistry();
    for (const locale of ['en-US', 'es-ES', 'zh-Hans-CN']) {
      const prefs = resolveMeasurePreferences({}, locale, { includeDrafts: true });
      const pack = getMeasureLocalePack(locale);
      for (const r of ROWS) {
        const model = buildMeasurePopup(r, { registry, pack, locale, prefs });
        expect(model, `${locale} ${r.id}`).toBeDefined();
        expect(model!.title.length, r.id).toBeGreaterThan(0);
        expect(model!.primary.length, r.id).toBeGreaterThan(0);
        expect(model!.primary, r.id).not.toMatch(/NaN|undefined|\{/);
      }
    }
  });

  it('Matthew 6:27 is illustrative, not figurative (03-me)', () => {
    const row = ROWS.find((r) => r.verseId === 40006027);
    expect(row?.usage).toBe('illustrative');
  });

  // Anchoring against the real KJV (a committed fixture made by bible-scripts/measures/export-fixture.mjs).
  it('every row anchors on KJV words (not the verse fallback) and the words are the unit\'s', () => {
    const fixture = fixtureJson as unknown as { v: number; t: string; s: [number, number, string][] }[];
    const registry = getMeasureRegistry();
    const byVerse = new Map<number, MeasureOccurrence[]>();
    for (const r of ROWS) byVerse.set(r.verseId, [...(byVerse.get(r.verseId) ?? []), r]);
    expect(fixture.map((f) => f.v)).toEqual([...byVerse.keys()]);
    const problems: string[] = [];
    const lastStart = new Map<number, number>();
    for (const f of fixture) {
      const words = extractWordsWithFormatting(f.t);
      const occs = byVerse.get(f.v)!;
      const interlinear = f.s.map(([start, end, strongs]) => ({ verseId: f.v, start, end, strongs }));
      const res = resolveMeasureAnchors(occs, { verseId: f.v, words }, { language: 'en', pack: en, registry, interlinear });
      for (const a of res) {
        const occ = occs.find((o) => o.id === a.occId)!;
        if (a.target.kind !== 'tokens' || a.via === 'verse') { problems.push(`${a.occId}: verse fallback`); continue; }
        const text = words.slice(a.target.start, a.target.end + 1).map((w) => normalizeToken(w.text)).join(' ');
        const unitId = occ.parts[0].unit;
        const terms = [...(en.terms[unitId] ?? []), ...(occ.anchor?.terms?.en ?? [])].map((t) => tokenizePhrase(t).join(' '));
        // a span wider than two words anchors on its last word ("third hour" -> "hour")
        const lastWords = terms.map((t) => t.split(' ').pop());
        if (!terms.includes(text) && !(a.via === 'strongs' && lastWords.includes(text))) problems.push(`${a.occId}: "${text}" is not a ${unitId} term`);
        // rows are in text order, so their words must be too (an n that picks the wrong word shows here)
        const prev = lastStart.get(f.v);
        if (prev !== undefined && a.target.start <= prev) problems.push(`${a.occId}: anchored out of text order`);
        lastStart.set(f.v, a.target.start);
      }
    }
    expect(problems).toEqual([]);
  });

  it('Ezekiel\'s "cubit and an hand breadth" is the common cubit plus a handbreadth, not cubit.long plus one', () => {
    for (const id of ['26040005.3', '26043013.3']) {
      const row = ROWS.find((r) => r.id === id)!;
      expect(row.parts.map((p) => p.unit), id).toEqual(['cubit', 'handbreadth']);
      expect(row.parts[1].quantity?.value).toBe(1);
      expect(row.noteKey ?? 'note.long-cubit').toBe('note.long-cubit');
    }
    expect(ROWS.filter((r) => r.parts.length > 1 && r.parts.some((p) => p.unit === 'cubit.long'))).toEqual([]);
  });

  it('John 6:19 gives 25 or 30 furlongs, with no midpoint', () => {
    const row = ROWS.find((r) => r.verseId === 43006019)!;
    expect(row.parts).toEqual([{ unit: 'furlong', quantity: { value: 25 }, or: 30 }]);
  });

  it('notes have no doubled periods and the stature note calls the cubit a real measure', () => {
    for (const [k, v] of Object.entries(en.notes)) expect(v, k).not.toMatch(/\.\./);
    expect(en.notes['note.stature-cubit']).toMatch(/real measure/);
    expect(en.notes['note.stature-cubit']).not.toMatch(/not a measurement/);
    expect(en.notes['v.40018024']).not.toMatch(/not a record/);
  });

  it('no anchor.n points past the Strong\'s hits (text-only rows say so instead)', () => {
    const fixture = fixtureJson as unknown as { v: number; t: string; s: [number, number, string][] }[];
    const spans = new Map(fixture.map((f) => [f.v, f.s]));
    const strongsOf = new Map(UNITS.map((u) => [u.id, u.strongs?.[0]]));
    const over: string[] = [];
    for (const r of ROWS) {
      if (r.anchor?.textOnly) continue;
      const target = r.anchor?.strongs ?? strongsOf.get(r.parts[0].unit);
      const hits = new Set((spans.get(r.verseId) ?? []).filter((s) => s[2] === target).map((s) => `${s[0]}-${s[1]}`)).size;
      if ((r.anchor?.n ?? 1) > hits) over.push(`${r.id} n=${r.anchor?.n ?? 1} hits=${hits}`);
    }
    expect(over).toEqual([]);
  });
});
