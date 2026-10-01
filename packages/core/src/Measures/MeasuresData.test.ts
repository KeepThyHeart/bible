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
});
