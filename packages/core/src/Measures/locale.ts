/**
 * Locale packs: names, match terms, notes and phrase templates per language,
 * with per-key fallback to English and English built-ins in code, so every
 * helper works with an empty pack.
 */
import enJson from './data/locales/en.json';
import esJson from './data/locales/es.json';
import zhJson from './data/locales/zh-Hans.json';
import enVersesJson from './data/locales/en.verses.json';
import type { MeasureLocalePack, PluralForms } from './types';

export type MeasurePackLanguage = 'en' | 'es' | 'zh-Hans';

export interface MeasureVerseNotes {
  notes: Record<string, string>;
}

/** English phrase templates used when a pack lacks a key. Plural families use `<key>.<category>`. */
export const BUILTIN_PHRASES: Record<string, string> = {
  approx: '≈ {value}',
  range: '{low}–{high}',
  and: ' and ',
  'wages.minute.one': "{n} minute's wages",
  'wages.minute.other': "{n} minutes' wages",
  'wages.hour.one': "{n} hour's wages",
  'wages.hour.other': "{n} hours' wages",
  'wages.day.one': "{n} day's wages",
  'wages.day.other': "{n} days' wages",
  'wages.month.one': "{n} month's wages",
  'wages.month.other': "{n} months' wages",
  'wages.year.one': "{n} year's wages",
  'wages.year.other': "{n} years' wages",
  metal: '{mass} of {metal}',
  'metal.silver': 'silver',
  'metal.gold': 'gold',
  'metal.bronze': 'bronze',
  'metal.copper': 'copper',
  clock: 'about {start}–{end}',
  clockPoint: 'about {time}',
  'reckoning.jewish': 'Jewish reckoning, from sunrise',
  'reckoning.roman': 'Roman reckoning, from midnight',
  modernWage: '≈ {amount} at {wage} a day',
  relation: '1 {unit} = {list}',
  'per.day': 'a day',
  'per.week': 'a week',
  'per.month': 'a month',
  'per.year': 'a year',
};

/** English names of modern units that `Intl.NumberFormat` cannot format. */
export const BUILTIN_MODERN_NAMES: Record<string, PluralForms> = {
  quart: { one: 'quart', other: 'quarts' },
  'dry-quart': { one: 'dry quart', other: 'dry quarts' },
  peck: { one: 'peck', other: 'pecks' },
  bushel: { one: 'bushel', other: 'bushels' },
  pint: { one: 'pint', other: 'pints' },
  'imperial-gallon': { one: 'imperial gallon', other: 'imperial gallons' },
};

export function emptyLocalePack(language = 'en'): MeasureLocalePack {
  return { language, names: {}, terms: {}, notes: {}, modernNames: {}, phrases: {} };
}

/**
 * Build a pack. Names, notes, modern names and phrases fall back per key to
 * `fallback`; `terms` never do (English words must not match in other
 * languages' text). `verses.notes` (a `<lang>.verses.json`) are merged into
 * the notes and win over the fallback's but not over the pack's own.
 */
export function createLocalePack(
  base: Partial<MeasureLocalePack>,
  opts: { verses?: MeasureVerseNotes; fallback?: MeasureLocalePack } = {},
): MeasureLocalePack {
  const fb = opts.fallback;
  return {
    language: base.language ?? fb?.language ?? 'en',
    names: { ...fb?.names, ...base.names },
    terms: { ...base.terms },
    notes: { ...fb?.notes, ...opts.verses?.notes, ...base.notes },
    modernNames: { ...fb?.modernNames, ...base.modernNames },
    phrases: { ...fb?.phrases, ...base.phrases },
    ...(base.numberWords ? { numberWords: base.numberWords } : {}),
  };
}

/** 'zh', 'zh-CN', 'zh-Hans-CN' -> zh-Hans; 'es-MX' -> es; anything else -> en. */
export function measurePackLanguage(tag: string): MeasurePackLanguage {
  const t = (tag || '').toLowerCase().replace(/_/g, '-');
  if (t === 'zh' || t.startsWith('zh-')) return /(^|-)(hant|tw|hk|mo)(-|$)/.test(t) ? 'en' : 'zh-Hans';
  if (t === 'es' || t.startsWith('es-')) return 'es';
  return 'en';
}

const packCache = new Map<MeasurePackLanguage, MeasureLocalePack>();

/** The bundled pack for a language tag (own data merged with `<lang>.verses.json` notes, English fallback). */
export function getMeasureLocalePack(lang: string): MeasureLocalePack {
  const key = measurePackLanguage(lang);
  const hit = packCache.get(key);
  if (hit) return hit;
  const en = createLocalePack(enJson as unknown as Partial<MeasureLocalePack>, {
    verses: enVersesJson as unknown as MeasureVerseNotes,
  });
  let pack = en;
  if (key === 'es') pack = createLocalePack(esJson as unknown as Partial<MeasureLocalePack>, { fallback: en });
  else if (key === 'zh-Hans') pack = createLocalePack(zhJson as unknown as Partial<MeasureLocalePack>, { fallback: en });
  packCache.set(key, pack);
  return pack;
}

// --- helpers ------------------------------------------------------------------

const pluralRules = new Map<string, Intl.PluralRules>();

export function pluralCategory(n: number, locale: string): Intl.LDMLPluralRule {
  let r = pluralRules.get(locale);
  if (!r) {
    try { r = new Intl.PluralRules(locale); } catch { r = new Intl.PluralRules('en'); }
    pluralRules.set(locale, r);
  }
  return r.select(n);
}

export function pickPlural(forms: PluralForms, n: number, locale: string): string {
  return forms[pluralCategory(n, locale) as keyof PluralForms] ?? forms.other;
}

export function fillTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** A phrase template, filled; pack first, then the English built-in, then ''. */
export function phrase(pack: MeasureLocalePack, key: string, vars: Record<string, string | number> = {}): string {
  const t = pack.phrases[key] ?? BUILTIN_PHRASES[key];
  return t === undefined ? '' : fillTemplate(t, vars);
}

/** A plural-family phrase (`<base>.<category>` then `<base>.other` then `<base>`). */
export function pluralPhrase(
  pack: MeasureLocalePack, base: string, n: number, locale: string, vars: Record<string, string | number> = {},
): string {
  const cat = pluralCategory(n, locale);
  for (const k of [`${base}.${cat}`, `${base}.other`, base]) {
    const t = pack.phrases[k] ?? BUILTIN_PHRASES[k];
    if (t !== undefined) return fillTemplate(t, { n, ...vars });
  }
  return '';
}

function humanizeId(id: string): string {
  return id.replace(/\./g, ' ');
}

/** Name of an ancient unit for a count (`undefined` = no quantity: the singular form). */
export function unitName(pack: MeasureLocalePack, unitId: string, count: number | undefined, locale: string): string {
  const forms = pack.names[unitId];
  if (!forms) return humanizeId(unitId);
  if (count === undefined) return forms.one ?? forms.other;
  return pickPlural(forms, count, locale);
}

/** Name of a modern unit that `Intl` cannot format. */
export function modernUnitName(pack: MeasureLocalePack, unit: string, count: number, locale: string): string {
  const forms = pack.modernNames?.[unit] ?? BUILTIN_MODERN_NAMES[unit];
  return forms ? pickPlural(forms, count, locale) : unit;
}

export function noteFor(pack: MeasureLocalePack, key: string | undefined): string | undefined {
  return key ? pack.notes[key] : undefined;
}
