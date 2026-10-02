import { describe, it, expect } from 'vitest';
import { resolveMeasureAnchors } from './anchor';
import { computeChapterMeasures, computeVerseMeasures } from './chapter';
import { buildMeasureLayer, isFallbackOnly, MEASURE_LAYER_KEY } from './layer';
import { formatModernWage, formatTitleQuantity } from './convert';
import { createLocalePack, getMeasureLocalePack, measurePackLanguage, phrase } from './locale';
import { buildMeasurePopup } from './popup';
import { defaultMeasureSystems, MEASURE_SETTINGS, resolveMeasurePreferences } from './prefs';
import { loadChapterOccurrences, type IMeasureDataSource } from './data';
import { getMeasureRegistry, MeasureRegistry } from './registry';
import { FIXTURE_EN_PACK, FIXTURE_ES_PACK, FIXTURE_UNITS, fixtureRegistry, occ, prefs, words } from '../__tests__/measuresFixtures';
import { FEATURE_FLAGS } from '../Settings/FeatureFlags';
import type { MeasureOccurrence } from './types';

const GEN_6_15 = 'And this is the fashion which thou shalt make it of: The length of the ark shall be three hundred cubits, the breadth of it fifty cubits, and the height of it thirty cubits.';
const GEN_ID = 1006015;
const registry = fixtureRegistry();
const genVerse = { verseId: GEN_ID, words: words(GEN_6_15) };
const genRows = [
  { verseId: GEN_ID, start: 16, end: 20, strongs: 'H0520' },
  { verseId: GEN_ID, start: 20, end: 20, strongs: 'H0520' },
  { verseId: GEN_ID, start: 26, end: 26, strongs: 'H0520' },
  { verseId: GEN_ID, start: 33, end: 33, strongs: 'H0520' },
  { verseId: GEN_ID, start: 12, end: 12, strongs: 'H0753' },
];
const ctx = (over: object = {}) => ({ language: 'en', pack: FIXTURE_EN_PACK, registry, ...over });
const popupCtx = (p = prefs(), locale = 'en-US') => ({ registry, pack: FIXTURE_EN_PACK, locale, prefs: p });
const tok = (a: { target: unknown }) => a.target as { kind: string; start: number; end: number };

describe('anchors', () => {
  const cubits = (n: number): MeasureOccurrence =>
    occ(`${GEN_ID}.${n}`, [{ unit: 'cubit', quantity: { value: [300, 50, 30][n - 1] } }], { anchor: { strongs: 'H520', n } });

  it('uses Strong\'s (zero-padded data), narrows wide spans and dedupes', () => {
    const res = resolveMeasureAnchors([cubits(1), cubits(2), cubits(3)], genVerse, ctx({ interlinear: genRows }));
    expect(res.map((a) => [tok(a).start, tok(a).end, a.via])).toEqual([
      [20, 20, 'strongs'], [26, 26, 'strongs'], [33, 33, 'strongs'],
    ]);
  });

  it('uses the last token of a wide span with no term match (empty pack)', () => {
    const res = resolveMeasureAnchors([cubits(1)], genVerse, ctx({ pack: createLocalePack({}), interlinear: genRows }));
    expect(tok(res[0])).toMatchObject({ start: 20, end: 20 });
  });

  it('falls back to terms when there is no interlinear (rank by same unit)', () => {
    const res = resolveMeasureAnchors([cubits(1), cubits(2), cubits(3)], genVerse, ctx());
    expect(res.map((a) => [tok(a).start, a.via])).toEqual([[20, 'terms'], [26, 'terms'], [33, 'terms']]);
  });

  it('anchors two different units in one verse', () => {
    const v = { verseId: 1002001, words: words('it was six cubits and a span and one span') };
    const res = resolveMeasureAnchors(
      [occ('1002001.1', [{ unit: 'cubit', quantity: { value: 6 } }, { unit: 'span' }]),
       occ('1002001.2', [{ unit: 'span' }])], v, ctx());
    expect(tok(res[0]).start).toBe(3);
    expect(tok(res[1]).start).toBe(9); // the compound's own span is not claimed twice
  });

  it('matches multi-word terms, longest first', () => {
    const v = { verseId: 1002002, words: words('a hand breadth wide') };
    const res = resolveMeasureAnchors([occ('1002002.1', [{ unit: 'handbreadth' }])], v, ctx());
    expect(tok(res[0])).toMatchObject({ start: 1, end: 2 });
  });

  it('modern path needs a number before the word', () => {
    const o = occ('1003001.1', [{ unit: 'cubit', quantity: { value: 300 } }]);
    const hit = resolveMeasureAnchors([o], { verseId: 1003001, words: words('The ark was 450 feet long') }, ctx());
    expect(hit[0]).toMatchObject({ via: 'modern' });
    expect(tok(hit[0]).start).toBe(4);
    const word = resolveMeasureAnchors([o], { verseId: 1003001, words: words('He fell at his feet') }, ctx());
    expect(word[0].target).toEqual({ kind: 'verse' });
    const spelled = resolveMeasureAnchors([o], { verseId: 1003001, words: words('it was three hundred feet') }, ctx());
    expect(spelled[0].via).toBe('modern');
  });

  it('falls back to the verse', () => {
    const res = resolveMeasureAnchors([cubits(1)], { verseId: GEN_ID, words: words('no unit here') }, ctx());
    expect(res[0]).toMatchObject({ via: 'verse', target: { kind: 'verse' } });
  });

  it('does not reuse claimed tokens', () => {
    const v = { verseId: 1004001, words: words('one cubit') };
    const res = resolveMeasureAnchors([occ('1004001.1', [{ unit: 'cubit' }]), occ('1004001.2', [{ unit: 'cubit' }])], v, ctx());
    expect(res[0].via).toBe('terms');
    expect(res[1].via).toBe('verse');
  });

  it('adds per-occurrence anchor terms', () => {
    const o = occ('1004002.1', [{ unit: 'ephah' }], { anchor: { terms: { en: ['bushel'] } } });
    const res = resolveMeasureAnchors([o], { verseId: 1004002, words: words('a bushel of flour') }, ctx({ pack: createLocalePack({}) }));
    expect(tok(res[0]).start).toBe(1);
  });
});

describe('popup model and conversion', () => {
  const m = (parts: MeasureOccurrence['parts'], p = prefs(), extra: Partial<MeasureOccurrence> = {}) =>
    buildMeasurePopup(occ('1001001.1', parts, extra), popupCtx(p))!;

  it('300 cubits, metric primary with 2 significant figures, US secondary', () => {
    const r = m([{ unit: 'cubit', quantity: { value: 300 } }]);
    expect(r.title).toBe('300 cubits');
    expect(r.primary).toBe('≈ 140 m');
    expect(r.badge).toBe('140 m');
    expect(r.secondary).toMatch(/^450 ft$/);
    expect(r.parts).toBe(1);
    expect(r.relation).toBe('1 cubit = 2 spans = 6 handbreadths');
    expect(r.unitNote).toBe('A cubit is the forearm.');
    expect(r.sources).toHaveLength(1);
  });

  it('US primary gives feet', () => {
    expect(m([{ unit: 'cubit', quantity: { value: 300 } }], prefs({ system: 'us', secondary: 'metric' })).primary).toBe('≈ 450 ft');
  });

  it('ranges: auto threshold, always, never', () => {
    const q = [{ unit: 'cubit', quantity: { value: 300, low: 288, high: 312 } }];
    // fixture unit has a 44-52 cm spread (>10 %)
    expect(m([{ unit: 'cubit', quantity: { value: 300 } }]).range).toBe('130–160 m');
    expect(m(q, prefs({ ranges: 'never' })).range).toBeUndefined();
    // exact unit: no range even when "always"
    expect(m([{ unit: 'span', quantity: { value: 3 } }], prefs({ ranges: 'always' })).range).toBeUndefined();
    // a narrow spread is hidden under 'auto' but shown under 'always'
    const narrow = new MeasureRegistry([{ ...FIXTURE_UNITS[0], id: 'narrow', base: { value: 0.457, low: 0.45, high: 0.46 } }]);
    const mk = (r: 'auto' | 'always') => buildMeasurePopup(occ('1001001.1', [{ unit: 'narrow' }]), { ...popupCtx(prefs({ ranges: r })), registry: narrow })!;
    expect(mk('auto').range).toBeUndefined();
    expect(mk('always').range).toBeDefined();
  });

  it('sums several parts: six cubits and a span', () => {
    const r = m([{ unit: 'cubit', quantity: { value: 6 } }, { unit: 'span' }]);
    expect(r.title).toBe('6 cubits and span');
    expect(r.parts).toBe(2);
    expect(r.primary).toBe('≈ 3 m'); // 2.742 + 0.2286 = 2.97 m
  });

  it('fractions are exact in the title', () => {
    expect(m([{ unit: 'cubit', quantity: { value: 2.5 } }]).title).toBe('2½ cubits');
    expect(m([{ unit: 'shekel', quantity: { value: 0.5 } }]).title).toBe('½ shekel');
    expect(m([{ unit: 'shekel', quantity: { value: 1 / 3 } }]).title).toBe('⅓ shekel');
    expect(m([{ unit: 'cubit', quantity: { value: 1.75 } }]).title).toBe('1¾ cubits');
    expect(m([{ unit: 'cubit', quantity: { value: 1.125 } }]).title).toBe('1.125 cubits');
    expect(m([{ unit: 'cubit', quantity: { value: 5000 } }]).title).toBe('5,000 cubits');
    expect(formatTitleQuantity(1 / 6, 'en')).toBe('⅙');
    expect(formatTitleQuantity(0.1, 'en')).toBe('⅒');
    expect(formatTitleQuantity(2 / 3, 'en')).toBe('⅔');
    expect(m([{ unit: 'cubit', quantity: { value: 1 } }]).title).toBe('1 cubit');
    expect(m([{ unit: 'cubit' }]).title).toBe('cubit');
  });

  it('mass, dry and liquid volume', () => {
    expect(m([{ unit: 'shekel', quantity: { value: 2 } }]).primary).toBe('≈ 23 g');
    expect(m([{ unit: 'talent', quantity: { value: 3 } }]).primary).toBe('≈ 100 kg');
    expect(m([{ unit: 'ephah' }], prefs({ system: 'us', secondary: 'none' })).primary).toBe('≈ 2.5 pecks');
    expect(m([{ unit: 'hin' }], prefs({ system: 'us', secondary: 'none' })).primary).toBe('≈ 3.9 quarts');
    expect(m([{ unit: 'ephah' }], prefs()).primary).toBe('≈ 22 L');
  });

  it('imperial secondary only for length and mass', () => {
    expect(m([{ unit: 'cubit' }], prefs({ secondary: 'imperial' })).secondary).toBeDefined();
    expect(m([{ unit: 'ephah' }], prefs({ secondary: 'imperial' })).secondary).toBeUndefined();
  });

  it('rate adds the per phrase', () => {
    const r = m([{ unit: 'denarius' }], prefs(), { per: 'day' });
    expect(r.title).toBe('denarius a day');
    // the rate is on the title and on metal lines, not on wages ("≈ 1 day's wages a day" would read wrongly)
    expect(r.primary).toBe("≈ 1 day's wage");
    expect(m([{ unit: 'denarius' }], prefs({ money: 'metal' }), { per: 'day' }).primary).toBe('≈ 3.9 g of silver a day');
    expect(m([{ unit: 'denarius' }], prefs({ money: 'both' }), { per: 'day' }).extra).toContain('3.9 g of silver a day');
  });

  it('money: days, minutes and years', () => {
    expect(m([{ unit: 'denarius' }]).primary).toBe("≈ 1 day's wage");
    expect(m([{ unit: 'denarius', quantity: { value: 200 } }]).primary).toBe("≈ 8 months' wages");
    expect(m([{ unit: 'denarius', quantity: { value: 200 } }]).extra).toContain("200 days' wages");
    const big = m([{ unit: 'talent.money', quantity: { value: 10000 } }]);
    expect(big.primary).toBe("≈ 200,000 years' wages");
    expect(big.extra.some((e) => e.includes("days' wages"))).toBe(true);
    expect(m([{ unit: 'lepton' }]).primary).toBe("≈ 5.6 minutes' wages");
    expect(m([{ unit: 'lepton', quantity: { value: 16 } }]).primary).toBe("≈ 1.5 hours' wages");
  });

  it('money: metal and modern wage', () => {
    expect(m([{ unit: 'denarius' }], prefs({ money: 'metal' })).primary).toBe('≈ 3.9 g of silver');
    const both = m([{ unit: 'denarius' }], prefs({ money: 'both' }));
    expect(both.primary).toBe("≈ 1 day's wage");
    expect(both.extra).toContain('3.9 g of silver');
    const wage = m([{ unit: 'denarius', quantity: { value: 2 } }], prefs({ modernDailyWage: { amount: 100, currency: 'USD' } }));
    expect(wage.extra.join(' ')).toContain('$200.00');
    expect(formatModernWage(2, { amount: 10000, currency: 'JPY' }, { locale: 'en-US', pack: FIXTURE_EN_PACK })).toContain('¥20,000');
  });

  it('clock: h12 and h23, point and range', () => {
    const watch = m([{ unit: 'watch.roman.4' }]);
    expect(watch.primary).toBe('about 3–6 AM');
    expect(watch.title).toBe('the fourth watch');
    expect(watch.extra).toContain('Roman reckoning, watches of the night from 6 p.m.');
    expect(m([{ unit: 'watch.roman.4' }], prefs({ clock: 'h23' })).primary).toBe('about 03:00–06:00');
    expect(m([{ unit: 'hour.9' }]).primary).toBe('about 3 PM');
    expect(m([{ unit: 'hour.9' }], prefs({ clock: 'h23' })).primary).toBe('about 15:00');
    expect(m([{ unit: 'hour.9' }]).extra).toContain('Jewish reckoning, hours counted from sunrise (about 6 a.m.)');
  });

  it('usage and review pass through; unit override applies', () => {
    const r = m([{ unit: 'cubit', quantity: { value: 1 } }], prefs(), { usage: 'illustrative', review: { status: 'approved' } });
    expect(r.usage).toBe('illustrative');
    expect(r.review).toBe('approved');
    const long = m([{ unit: 'cubit', quantity: { value: 100 } }], prefs(), { unitOverride: { base: { value: 0.52 } } });
    expect(long.primary).toBe('≈ 52 m');
  });

  it('verse note from the pack; unknown unit yields nothing', () => {
    expect(m([{ unit: 'cubit' }], prefs(), { noteKey: 'v.1' }).verseNote).toBe('A verse note.');
    expect(buildMeasurePopup(occ('1001001.1', [{ unit: 'nope' }]), popupCtx())).toBeUndefined();
  });

  it('"or": a pair of counts titles as "25 or 30 furlongs" and converts to a range', () => {
    const r = m([{ unit: 'furlong', quantity: { value: 25 }, or: 30 }]);
    expect(r.title).toBe('25 or 30 furlongs');
    expect(r.primary).toBe('≈ 4.6 km'); // 25 furlongs, not a midpoint
    expect(r.range).toBe('4.4–5.8 km'); // 25 x 177 m .. 30 x 192 m
  });

  it('titles in the text\'s words, with the scholarly name as the subtitle', () => {
    // The word each occurrence is anchored on in a KJV-like text.
    const WORD: Record<string, string> = { lepton: 'mites', denarius: 'penny', cubit: 'cubits', span: 'span' };
    const text = (parts: MeasureOccurrence['parts'], extra: Partial<MeasureOccurrence> = {}, lang = 'en', textWord = WORD[parts[0].unit]) =>
      buildMeasurePopup(occ('1001001.1', parts, extra), { ...popupCtx(), textLanguage: lang, textWord })!;
    const lepton = text([{ unit: 'lepton', quantity: { value: 2 } }]);
    expect(lepton.title).toBe('2 mites');
    expect(lepton.subtitle).toBe('Greek lepton (pl. lepta)');
    expect(text([{ unit: 'denarius' }], { per: 'day' }).title).toBe('penny a day');
    expect(text([{ unit: 'denarius' }]).subtitle).toBe('Roman denarius (pl. denarii)');
    // same word: no subtitle; no text names for the unit: scholarly title
    expect(text([{ unit: 'cubit', quantity: { value: 2 } }]).subtitle).toBeUndefined();
    expect(text([{ unit: 'span' }]).title).toBe('span');
    // a different text language, or none: the scholarly names
    expect(text([{ unit: 'lepton' }], {}, 'es').title).toBe('lepton');
    expect(text([{ unit: 'lepton' }], {}, 'es').subtitle).toBeUndefined();
    expect(m([{ unit: 'lepton' }]).title).toBe('lepton');
    // an English translation that says "denarius" (or a verse fallback, no word) keeps the scholarly title
    expect(text([{ unit: 'denarius' }], {}, 'en', 'denarius').title).toBe('denarius');
    expect(text([{ unit: 'lepton' }], {}, 'en', '').title).toBe('lepton');
    // the Spanish pack never borrows English text names
    const es = buildMeasurePopup(occ('1001001.1', [{ unit: 'lepton' }]), { ...popupCtx(), pack: FIXTURE_ES_PACK, textLanguage: 'es' })!;
    expect(es.title).toBe('lepton');
    expect(buildMeasurePopup(occ('1001001.1', [{ unit: 'lepton' }]), { ...popupCtx(), pack: FIXTURE_ES_PACK, textLanguage: 'en' })!.title).toBe('lepton');
  });

  it('shipped packs: the text\'s words for coins in English; Spanish names are already the RV words', () => {
    const registry2 = getMeasureRegistry();
    const en = getMeasureLocalePack('en');
    const row = (unit: string, q?: number) => occ('1001001.1', [{ unit, ...(q ? { quantity: { value: q } } : {}) }]);
    const WORD: Record<string, string> = { lepton: 'mites', 'mina.money': 'pound', metretes: 'firkins' };
    const popup = (o: MeasureOccurrence, pack = en, locale = 'en-US', textLanguage = 'en') =>
      buildMeasurePopup(o, {
        registry: registry2, pack, locale, prefs: prefs({ includeDrafts: true }), textLanguage, textWord: WORD[o.parts[0].unit],
      })!;
    expect(popup(row('lepton', 2)).title).toBe('2 mites');
    expect(popup(row('mina.money')).subtitle).toBe('Greek mina');
    expect(popup(row('metretes', 2)).title).toBe('2 firkins');
    const es = popup(row('lepton', 2), getMeasureLocalePack('es'), 'es', 'es');
    expect(es.title).toBe('2 blancas');
    // the Spanish unit names already are the Reina-Valera words, so there are no text names and no subtitle
    expect(es.subtitle).toBeUndefined();
    expect(getMeasureLocalePack('es').textNames).toBeUndefined();
    expect(popup(row('mina.money'), getMeasureLocalePack('es'), 'es', 'es').title).toBe('mina');
  });

  it('jewish-night reckoning for Old Testament watches', () => {
    const r = m([{ unit: 'watch.hebrew.2' }]);
    expect(r.primary).toBe('about 10 PM–2 AM');
    expect(r.extra).toContain('Jewish reckoning, hours of darkness counted from sunset (about 6 p.m.)');
    expect(getMeasureLocalePack('en').phrases['reckoning.jewish-night']).toMatch(/darkness counted from sunset/);
    expect(getMeasureLocalePack('es').phrases['reckoning.jewish-night']).toMatch(/oscuridad/);
    expect(getMeasureLocalePack('zh-Hans').phrases['reckoning.jewish-night']).toMatch(/日落/);
  });

  it('zh joins have no stray spaces', () => {
    const zh = getMeasureLocalePack('zh-Hans');
    const r = buildMeasurePopup(occ('1001001.1', [{ unit: 'cubit', quantity: { value: 300 } }, { unit: 'span', quantity: { value: 1 } }], { per: 'day' }), { registry: getMeasureRegistry(), pack: zh, locale: 'zh-Hans-CN', prefs: prefs({ includeDrafts: true }) })!;
    expect(r.title).toBe('300肘零1虎口每天');
    expect(buildMeasurePopup(occ('1001001.1', [{ unit: 'furlong', quantity: { value: 25 }, or: 30 }]), { registry: getMeasureRegistry(), pack: zh, locale: 'zh-Hans-CN', prefs: prefs({ includeDrafts: true }) })!.title).toMatch(/^25或30/);
  });

  it('uses the UI language pack with English fallback', () => {
    const r = buildMeasurePopup(occ('1001001.1', [{ unit: 'cubit', quantity: { value: 2 } }, { unit: 'span' }]), { ...popupCtx(), pack: FIXTURE_ES_PACK })!;
    expect(r.title).toBe('2 codos and span');
    expect(r.unitNote).toBe('A cubit is the forearm.');
  });

  it('works with an empty pack (English built-ins)', () => {
    const r = buildMeasurePopup(occ('1001001.1', [{ unit: 'denarius' }]), { ...popupCtx(), pack: createLocalePack({}) })!;
    expect(r.primary).toBe("≈ 1 day's wage");
    expect(phrase(createLocalePack({ phrases: { approx: '~ {value}' } }), 'approx', { value: 1 })).toBe('~ 1');
  });
});

describe('layer and index', () => {
  const o1 = occ(`${GEN_ID}.1`, [{ unit: 'cubit', quantity: { value: 300 } }], { anchor: { strongs: 'H520', n: 1 } });
  const o2 = occ('1001002.1', [{ unit: 'cubit' }]);
  const verses = [genVerse, { verseId: 1001002, words: words('no unit in these four words') }];
  const run = (p = prefs(), surface: 'standard' | 'study' | 'reading' = 'standard') =>
    computeChapterMeasures({
      occurrences: [o1, o2], verses, moduleLanguage: 'en', interlinear: genRows, uiLocale: 'en-US',
      prefs: p, surface, registry, modulePack: FIXTURE_EN_PACK, uiPack: FIXTURE_EN_PACK,
    });

  it('underlines marked tokens, badges the verse fallback and indexes both', () => {
    const r = run();
    expect(r.layer.layerKey).toBe(MEASURE_LAYER_KEY);
    expect(r.layer.extensionId).toBe('core');
    const under = r.layer.decorations.filter((d) => d.appearance.kind === 'underline');
    expect(under).toHaveLength(1);
    expect(under[0].order).toBe(40);
    expect(under[0].appearance).toMatchObject({ style: 'dotted', thickness: 'thin' });
    const badge = r.layer.decorations.filter((d) => d.appearance.kind === 'badge');
    expect(badge).toHaveLength(1);
    expect(badge[0].appearance).toMatchObject({ label: '⚖' });
    expect(r.index.at(GEN_ID, 20)).toEqual([o1.id]);
    expect(r.index.at(GEN_ID, 19)).toEqual([]);
    expect(r.index.at(1001002, 5)).toEqual([o2.id]);
    expect(r.index.forVerse(1001002)).toEqual([o2.id]);
    expect(r.index.occurrence(o1.id)?.model.title).toBe('300 cubits');
    expect(r.models.size).toBe(2);
  });

  it('one fallback badge per verse, however many unanchored measures it has', () => {
    const rows = [occ('1001002.1', [{ unit: 'cubit' }]), occ('1001002.2', [{ unit: 'span' }])];
    const r = computeChapterMeasures({
      occurrences: rows, verses, moduleLanguage: 'en', uiLocale: 'en-US', prefs: prefs(), surface: 'standard',
      registry, modulePack: FIXTURE_EN_PACK, uiPack: FIXTURE_EN_PACK,
    });
    expect(r.layer.decorations.filter((d) => d.appearance.kind === 'badge')).toHaveLength(1);
    expect(r.index.at(1001002, 5)).toEqual(['1001002.1', '1001002.2']);
    expect(r.index.occurrence('1001002.2')?.anchor.target.kind).toBe('verse');
  });

  it('isFallbackOnly: true only when every occurrence at the word is a verse fallback', () => {
    const lastWord = words(GEN_6_15).length - 1;
    const verses2 = [{ verseId: GEN_ID, words: words(GEN_6_15) }];
    // one measure marked on a word ('thirty') plus an unanchored one, which sits on the last word's badge
    const rows = [occ(`${GEN_ID}.1`, [{ unit: 'cubit' }], { anchor: { terms: { en: ['thirty'] } } }), occ(`${GEN_ID}.2`, [{ unit: 'ephah' }])];
    const r = computeChapterMeasures({
      occurrences: rows, verses: verses2, moduleLanguage: 'en', uiLocale: 'en-US', prefs: prefs(), surface: 'standard',
      registry, modulePack: FIXTURE_EN_PACK, uiPack: FIXTURE_EN_PACK,
    });
    expect(isFallbackOnly(r.index, GEN_ID, lastWord)).toBe(true); // only the badge sits here
    expect(isFallbackOnly(r.index, GEN_ID, 20)).toBe(false); // a marked word
    expect(isFallbackOnly(r.index, GEN_ID, 3)).toBe(false); // nothing here
    const mixed = run();
    expect(isFallbackOnly(mixed.index, 1001002, 5)).toBe(true);
    expect(isFallbackOnly(mixed.index, GEN_ID, 20)).toBe(false);
  });

  it('inline display adds a value badge after the word', () => {
    const r = run(prefs({ display: 'inline' }));
    const labels = r.layer.decorations.filter((d) => d.appearance.kind === 'badge').map((d) => (d.appearance as { label: string }).label);
    expect(labels).toContain('[about 140 m]');
  });

  it('inline conversion goes after the whole phrase in brackets', () => {
    const v = { verseId: 1002001, words: words('The ark was two cubits and a half long.') };
    const o = occ('1002001.1', [{ unit: 'cubit', quantity: { value: 2.5 } }]);
    const [a] = resolveMeasureAnchors([o], v, ctx());
    expect(a.phraseEnd).toBe(7);
    const model = buildMeasurePopup(o, popupCtx())!;
    expect(model.inline).toMatch(/^\[about .+\]$/);
    const { layer } = buildMeasureLayer([a], new Map([[o.id, model]]), prefs({ display: 'inline' }), 'standard', [v]);
    const badge = layer.decorations.find((d) => d.appearance.kind === 'badge')!;
    expect(badge.target).toMatchObject({ startTokenIndex: 7 });
    expect((badge.appearance as { label: string }).label).toBe(model.inline);
  });

  it('a phrase that does not match its parts falls back to the unit word', () => {
    const v = { verseId: 1002001, words: words('it was six cubits and the span') };
    const [a] = resolveMeasureAnchors([occ('1002001.1', [{ unit: 'cubit', quantity: { value: 6 } }, { unit: 'span' }])], v, ctx({ pack: createLocalePack({ ...FIXTURE_EN_PACK }) }));
    expect(a.phraseEnd).toBeUndefined();
    const noGrammar = resolveMeasureAnchors([occ('1002001.1', [{ unit: 'cubit', quantity: { value: 2.5 } }])],
      { verseId: 1002001, words: words('two cubits and a half') }, ctx({ pack: { ...FIXTURE_EN_PACK, grammar: undefined } }));
    expect(noGrammar[0].phraseEnd).toBeUndefined();
  });

  it('display off (default) paints nothing but still yields the per-verse models for the Study panel', () => {
    const r = run(prefs({ display: 'off' }));
    expect(r.layer.decorations).toEqual([]);
    expect(r.index.size).toBe(0);
    expect(r.byVerse.get(GEN_ID)?.length).toBeGreaterThan(0);
  });

  it('computeVerseMeasures lists one verse in the reader\'s unit system', () => {
    const us = computeVerseMeasures({ occurrences: [o1], verseId: o1.verseId, uiLocale: 'en-US', prefs: prefs({ system: 'us', secondary: 'none' }), registry, uiPack: FIXTURE_EN_PACK });
    const metric = computeVerseMeasures({ occurrences: [o1], verseId: o1.verseId, uiLocale: 'en-US', prefs: prefs({ system: 'metric', secondary: 'none' }), registry, uiPack: FIXTURE_EN_PACK });
    expect(us[0].primary).toMatch(/ft/);
    expect(metric[0].primary).toMatch(/ m/);
    expect(computeVerseMeasures({ occurrences: [o1], verseId: 999, uiLocale: 'en', prefs: prefs(), registry, uiPack: FIXTURE_EN_PACK })).toEqual([]);
  });

  it('study keeps the fallback badge; reading is clean unless opted in, and has no fallback badge', () => {
    expect(run(prefs(), 'study').layer.decorations.length).toBe(2);
    expect(run(prefs(), 'reading').layer.decorations).toEqual([]);
    const opted = run(prefs({ showInReading: true }), 'reading');
    expect(opted.layer.decorations.filter((d) => d.appearance.kind === 'underline')).toHaveLength(1);
    expect(opted.layer.decorations.filter((d) => d.appearance.kind === 'badge')).toHaveLength(0);
    expect(opted.index.at(1001002, 5)).toEqual([]);
  });

  it('is empty when disabled or display off', () => {
    expect(run(prefs({ enabled: false })).layer.decorations).toEqual([]);
    const off = run(prefs({ display: 'off' }));
    expect(off.layer.decorations).toEqual([]);
    expect(off.index.size).toBe(0);
  });

  it('filters drafts unless includeDrafts', () => {
    const draft = { ...o1, review: { status: 'draft' as const } };
    const base = { occurrences: [draft], verses, moduleLanguage: 'en', interlinear: genRows, uiLocale: 'en', surface: 'standard' as const, registry, modulePack: FIXTURE_EN_PACK, uiPack: FIXTURE_EN_PACK };
    expect(computeChapterMeasures({ ...base, prefs: prefs() }).models.size).toBe(0);
    expect(computeChapterMeasures({ ...base, prefs: prefs({ includeDrafts: true }) }).models.size).toBe(1);
  });

  it('chunks 64 targets per decoration and skips anchors without a model', () => {
    const anchors = Array.from({ length: 70 }, (_, i) => ({ occId: `x.${i}`, verseId: 1, target: { kind: 'tokens' as const, start: i, end: i }, via: 'terms' as const }));
    const models = new Map(anchors.map((a) => [a.occId, { occurrenceId: a.occId } as never]));
    const r = buildMeasureLayer([...anchors, { ...anchors[0], occId: 'ghost' }], models, prefs(), 'standard', []);
    expect(r.layer.decorations.map((d) => (d.target as unknown[]).length)).toEqual([64, 6]);
  });
});

describe('data loading', () => {
  const rows = [
    occ('1001002.1', [{ unit: 'cubit' }], { review: { status: 'draft' } }),
    occ('1001001.2', [{ unit: 'cubit' }]),
    occ('1001001.1', [{ unit: 'cubit' }]),
    occ('1002001.1', [{ unit: 'cubit' }]),
    occ('43001001.1', [{ unit: 'denarius' }]),
  ];
  const calls: string[] = [];
  const source: IMeasureDataSource = { load: async (t) => { calls.push(t); return rows; } };

  it('filters by chapter and review status, sorted', async () => {
    const live = await loadChapterOccurrences(1, 1, { source });
    expect(live.map((o) => o.id)).toEqual(['1001001.1', '1001001.2']);
    const all = await loadChapterOccurrences(1, 1, { source, includeDrafts: true });
    expect(all.map((o) => o.id)).toEqual(['1001001.1', '1001001.2', '1001002.1']);
  });

  it('picks the testament', async () => {
    calls.length = 0;
    await loadChapterOccurrences(43, 1, { source });
    expect(calls).toEqual(['nt']);
  });

  it('loads the bundled data without throwing', async () => {
    const list = await loadChapterOccurrences(1, 1, { includeDrafts: true });
    expect(Array.isArray(list)).toBe(true);
  });
});

describe('preferences and locale', () => {
  it('region defaults', () => {
    expect(defaultMeasureSystems('en-US')).toEqual({ system: 'us', secondary: 'metric' });
    expect(defaultMeasureSystems('en-GB')).toEqual({ system: 'metric', secondary: 'imperial' });
    expect(defaultMeasureSystems('de-DE')).toEqual({ system: 'metric', secondary: 'none' });
    expect(defaultMeasureSystems('es')).toEqual({ system: 'metric', secondary: 'none' });
  });

  it('resolves defaults and auto values', () => {
    const p = resolveMeasurePreferences({}, 'en-US');
    expect(p).toMatchObject({ enabled: true, display: 'off', showInReading: false, system: 'us', secondary: 'metric', money: 'wages', ranges: 'auto', clock: 'h12', includeDrafts: false });
    expect(p.modernDailyWage).toBeUndefined();
    expect(resolveMeasurePreferences({}, 'de-DE').clock).toBe('h23');
    expect(resolveMeasurePreferences({ measuresSystem: 'metric' }, 'en-US')).toMatchObject({ system: 'metric', secondary: 'us' });
    expect(resolveMeasurePreferences({ measuresSystem: 'us' }, 'de-DE')).toMatchObject({ system: 'us', secondary: 'metric' });
    expect(resolveMeasurePreferences({ measuresSystem: 'us', measuresSecondary: 'us' }, 'en-US').secondary).toBe('none');
    const w = resolveMeasurePreferences({ measuresDailyWage: 120, measuresWageCurrency: 'eur', measuresDisplay: 'bogus' }, 'en', { includeDrafts: true });
    expect(w.modernDailyWage).toEqual({ amount: 120, currency: 'EUR' });
    expect(w.display).toBe('off');
    expect(w.includeDrafts).toBe(true);
  });

  it('declares settings and the feature flag', () => {
    expect(MEASURE_SETTINGS.map((s) => s.key)).toEqual([
      'measuresEnabled', 'measuresDisplay', 'measuresShowInReading', 'measuresSystem', 'measuresSecondary',
      'measuresMoney', 'measuresDailyWage', 'measuresWageCurrency', 'measuresClock', 'measuresRanges',
    ]);
    for (const s of MEASURE_SETTINGS) expect(s.group).toBe('measures');
    expect(FEATURE_FLAGS.measureDrafts.default).toBe(false);
  });

  it('maps languages to packs and merges with English', () => {
    expect(measurePackLanguage('zh-CN')).toBe('zh-Hans');
    expect(measurePackLanguage('zh')).toBe('zh-Hans');
    expect(measurePackLanguage('es-MX')).toBe('es');
    expect(measurePackLanguage('fr')).toBe('en');
    expect(getMeasureLocalePack('es-ES').language).toBe('es');
    const merged = createLocalePack({ notes: { a: 'own' } }, { fallback: createLocalePack({ notes: { a: 'en', b: 'en-b' }, terms: { x: ['y'] } }), verses: { notes: { c: 'verse' } } });
    expect(merged.notes).toEqual({ a: 'own', b: 'en-b', c: 'verse' });
    expect(merged.terms).toEqual({}); // terms never fall back
  });
});
