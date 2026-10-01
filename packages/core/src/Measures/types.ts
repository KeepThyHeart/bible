/**
 * Weights, measures and money (task 0069): the data model.
 *
 * Two data layers, both translation-independent:
 *  - the unit registry (`data/units.json`): what a unit is and how it converts;
 *  - verse-keyed occurrences (`data/occurrences/{ot,nt}.json`): where a unit
 *    appears in the text (KJV numbering) and in what quantity, exactly as the
 *    KJV states it.
 * Localized names, match terms, notes and phrase templates live in locale packs
 * (`data/locales/<lang>.json`).
 *
 * Pure TypeScript; no DOM, no platform imports.
 */

export const MEASURE_DIMENSIONS = [
  'length', 'area', 'volume_dry', 'volume_liquid', 'mass', 'money', 'time',
] as const;
export type MeasureDimension = (typeof MEASURE_DIMENSIONS)[number];

export type MeasureUnitSystemOfOrigin = 'hebrew' | 'greek' | 'roman' | 'persian';

/** A value with an uncertainty range. `low`/`high` omitted = treat as exact. */
export interface Approx {
  value: number;
  low?: number;
  high?: number;
}

export interface MeasureUnitDef {
  /** 'cubit', 'cubit.long', 'shekel', 'denarius', 'watch.roman.4', 'hour.9'. */
  id: string;
  dimension: MeasureDimension;
  system: MeasureUnitSystemOfOrigin;
  /**
   * SI value of one unit: metres (length), square metres (area), litres
   * (volume_dry, volume_liquid), kilograms (mass). Money units may carry a
   * `base` mass (the coin's metal weight in kg) only through `money.metal`.
   * Time-of-day units have no `base`; they use `clock`.
   */
  base?: Approx;
  /** "1 talent = 60 mina": shown as a relation line; `factor` units of `unit` make one of this. */
  relation?: { unit: string; factor: number };
  money?: {
    /** Days' wages of a labourer (denarius = 1). */
    wages?: Approx;
    metal?: { metal: 'silver' | 'gold' | 'bronze' | 'copper'; grams: Approx };
  };
  /** Time-of-day units (an hour of the day, a watch of the night). */
  clock?: {
    /**
     * 'jewish': hours of the day counted from sunrise (about 06:00).
     * 'roman': the four Roman night watches (from about 18:00).
     * 'jewish-night': hours or watches of darkness counted from sunset (about 18:00).
     */
    reckoning: 'jewish' | 'roman' | 'jewish-night';
    /** 'HH:MM' 24-hour, sunrise assumed 06:00 for Jewish hours. */
    start: string;
    end: string;
  };
  /** Strong's numbers that denote this unit, normalized without leading zeros: ['H520'], ['G1220']. */
  strongs?: string[];
  /** Locale-pack key for the general note (defaults to the unit id). */
  noteKey?: string;
  /** Ids into `data/sources.json`. */
  sources: string[];
}

export interface MeasureSource {
  id: string;
  /** Full citation, e.g. "Anchor Bible Dictionary, 'Weights and Measures' (1992)". */
  title: string;
  url?: string;
  /** True when note text may be quoted from it (public domain). */
  publicDomain?: boolean;
}

/**
 * How the measure is used in its verse.
 *  - literal: a real quantity in narrative, law or description.
 *  - illustrative: a real measurement given as an example or in a story
 *    (Matt 6:27 "one cubit unto his stature", the talents of a parable);
 *    the exact amount is not the point (task 0069, 03-me).
 *  - figurative: a non-measuring use of a unit word (rare).
 */
export type MeasureUsage = 'literal' | 'illustrative' | 'figurative';

export type MeasureReviewStatus = 'draft' | 'reviewed' | 'approved';

export interface MeasurePart {
  unit: string;
  /** As the KJV states it ("three hundred" = 300, "two and a half" = 2.5). Omitted when the text gives none ("a cubit" = 1 is stated). */
  quantity?: Approx;
  /**
   * An alternative count the text offers: "five and twenty or thirty furlongs" is `quantity` 25, `or` 30.
   * The title reads "25 or 30 furlongs"; the conversion spans the two.
   */
  or?: number;
}

export interface MeasureOccurrence {
  /** Stable: '<verseId>.<ordinal in verse>', e.g. '1006015.1'. */
  id: string;
  /** KJV numbering, as everywhere else. */
  verseId: number;
  /** "six cubits and a span" = 2 parts. */
  parts: MeasurePart[];
  /** Rate: "a penny a day" -> per 'day'. Free-form key into the locale pack `per` table. */
  per?: string;
  anchor?: {
    /** Strong's number of the anchoring word (normalized, e.g. 'H520'). Defaults to the first part's unit's first Strong's. */
    strongs?: string;
    /** 1-based nth match of the unit (Strong's or terms) in this verse. Default 1. */
    n?: number;
    /**
     * No interlinear word underlies this unit word (the KJV supplies it: "an hundred cubits long"): skip the
     * Strong's step and anchor by the unit's words ("terms") alone. `n` is then not used.
     */
    textOnly?: boolean;
    /** Per-language extra match terms, rare. Keyed by primary language ('en'). */
    terms?: Record<string, string[]>;
  };
  /** Verse-specific changes to the unit, e.g. Ezek 40:5 long cubit, John's hours. */
  unitOverride?: Partial<Pick<MeasureUnitDef, 'base' | 'clock' | 'money'>>;
  usage: MeasureUsage;
  /** Locale-pack key for a verse-specific note. */
  noteKey?: string;
  review: { status: MeasureReviewStatus; by?: string; date?: string };
}

/** Plural forms keyed by `Intl.PluralRules` categories; `other` is required. */
export type PluralForms = Partial<Record<'zero' | 'one' | 'two' | 'few' | 'many', string>> & { other: string };

export interface MeasureLocalePack {
  /** BCP 47 tag of the pack ('en', 'es', 'zh-Hans'). */
  language: string;
  /** Display names of ancient units, by unit id. */
  names: Record<string, PluralForms>;
  /**
   * Words in Bible text that denote a unit, by unit id, in this language
   * (matched case-insensitively against verse tokens). Multi-word terms span
   * tokens. A key `<unitId>#modern` lists modern-unit words a translation
   * may have converted to ("feet").
   */
  terms: Record<string, string[]>;
  /**
   * The words the Bible text itself uses for a unit, by unit id ("mite", "penny", "firkin"). Never fall back
   * to English. Used for the popup title only when the pack's language is the module's language; the
   * scholarly name then moves to the subtitle.
   */
  textNames?: Record<string, PluralForms>;
  /** General unit notes (by noteKey / unit id) and verse notes (by occurrence noteKey). */
  notes: Record<string, string>;
  /** Names of modern units that `Intl.NumberFormat` cannot format ('quart', 'bushel', ...). */
  modernNames?: Record<string, PluralForms>;
  /**
   * Phrase templates with `{placeholders}`. Keys (all optional; English is the fallback):
   * 'approx' "≈ {value}", 'range' "{low}–{high}", 'wages.day' / 'wages.month' / 'wages.year'
   * (PluralForms-style via `wages.day.one` etc.), 'metal' "{mass} of {metal}", 'metal.silver',
   * 'clock' "about {start}–{end}", 'clockPoint' "about {time}", 'reckoning.jewish',
   * 'reckoning.roman', 'modernWage' "≈ {amount} at {wage} a day", 'relation' "1 {unit} = {list}",
   * 'per.day' "a day", 'withPer' "{text} {per}", 'quantityName' "{n} {name}", 'quantityOr' "{a} or {b}",
   * 'scholarlyName' "{system} {name}" (+ 'system.hebrew' etc.), 'pluralNote' "{name} (pl. {plural})",
   * 'reckoning.jewish-night'.
   */
  phrases: Record<string, string>;
  /** Words for small numbers ("three", "hundred") so the modern-term matcher can accept "three feet". Optional. */
  numberWords?: string[];
}

/** Modern display systems. */
export type MeasureSystem = 'metric' | 'us' | 'imperial';

/** Reader preferences, resolved (no 'auto' left). */
export interface MeasurePreferences {
  /** Master switch. Default true. */
  enabled: boolean;
  /** 'marker' = dotted underline only (default); 'inline' adds a value badge after the word; 'off' = no marks (popups unreachable). */
  display: 'marker' | 'inline' | 'off';
  /** Show marks in Reading mode too. Default false: Reading mode stays clean text unless opted in (task 0069, 03-me Q14). */
  showInReading: boolean;
  system: MeasureSystem;
  secondary: MeasureSystem | 'none';
  /** 'wages' (default), 'metal', or 'both'. */
  money: 'wages' | 'metal' | 'both';
  /** A user-entered modern daily wage, giving an extra money line. Unset by default. */
  modernDailyWage?: { amount: number; currency: string };
  clock: 'h12' | 'h23';
  /** 'auto': show the range when its spread exceeds 10 % of the value. */
  ranges: 'auto' | 'always' | 'never';
  /** Include unreviewed (draft) rows. Dev/review only (feature flag `measureDrafts`). */
  includeDrafts: boolean;
}

/** One modern-unit conversion result, before formatting. */
export interface ConvertedValue {
  /** Modern unit id: an `Intl` sanctioned unit ('meter', 'foot', 'liter', 'kilogram', ...) or a pack-named one ('quart', 'bushel', ...). */
  unit: string;
  value: number;
  low?: number;
  high?: number;
}

/** Where an occurrence lands in one translation's words. */
export type MeasureAnchorTarget =
  | { kind: 'tokens'; start: number; end: number }
  | { kind: 'verse' };

export interface ResolvedMeasureAnchor {
  occId: string;
  verseId: number;
  target: MeasureAnchorTarget;
  /** How it was found. */
  via: 'strongs' | 'terms' | 'modern' | 'verse';
}

/** Input words of one verse in the shared word-index space (`extractWordsWithFormatting`). */
export interface MeasureVerseInput {
  verseId: number;
  words: { text: string }[];
}

/** What a popup shows. Every string is already localized and formatted. */
export interface MeasurePopupModel {
  occurrenceId: string;
  verseId: number;
  /** In the UI language: "300 cubits", "the fourth watch", "a penny". */
  title: string;
  /** Primary conversion: "≈ 137 m", "≈ 1 day's wages", "about 3–6 a.m.". */
  primary: string;
  /** Secondary system: "450 ft". */
  secondary?: string;
  /** "132–156 m" (already formatted; the component adds the label). */
  range?: string;
  /** Further lines: metal weight, a modern-wage estimate, the reckoning used. */
  extra: string[];
  /** The scholarly name when the title uses the text's own word: "Greek lepton (pl. lepta)". */
  subtitle?: string;
  /** "1 cubit = 2 spans = 6 handbreadths". */
  relation?: string;
  /** The unit's general note. */
  unitNote?: string;
  /** This verse's own note. */
  verseNote?: string;
  usage: MeasureUsage;
  review: MeasureReviewStatus;
  sources: MeasureSource[];
  /** Short value for the inline badge ("140 m", "1 day's wages", "9 a.m."): the primary without the approx sign. */
  badge?: string;
  /** One row per part when the occurrence has several ("six cubits and a span"): already included in `primary`. */
  parts: number;
}
