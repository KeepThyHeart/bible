/**
 * The popup view model: one occurrence in, final localized strings out.
 * Missing data never throws: an unknown unit (or one with nothing to convert)
 * yields `undefined`.
 */
import {
  convertToSystem, formatClock, formatConverted, formatConvertedRange, formatMetal, formatModernWage,
  formatSig2, formatTitleQuantity, formatWages, isPhysicalDimension, reckoningLine, secondaryApplies,
  shouldShowRange, sumApprox, type FormatContext,
} from './convert';
import { normalizeToken, tokenizePhrase } from '../KeywordMarks/matcher';
import { measurePackLanguage, noteFor, phrase, pluralPhrase, textUnitName, unitName } from './locale';
import type { MeasureRegistry } from './registry';
import type {
  Approx, MeasureLocalePack, MeasureOccurrence, MeasurePopupModel, MeasurePreferences, MeasureUnitDef,
} from './types';

export interface PopupContext {
  registry: MeasureRegistry;
  /** Pack in the UI language (English fallback already merged). */
  pack: MeasureLocalePack;
  /** UI locale for `Intl`. */
  locale: string;
  prefs: MeasurePreferences;
  /**
   * Language of the Bible text the reader is on (BCP 47). When it is the pack's language, units are titled
   * with the text's own words (`pack.textNames`: "mite", "penny") and the scholarly name goes to the subtitle.
   */
  textLanguage?: string;
  /**
   * The word the occurrence is anchored on in that text ("mites"). Text names are used only when it is one
   * of them, so a translation that says "denarius" or "small copper coins" keeps the scholarly title.
   */
  textWord?: string;
}

interface ResolvedPart {
  unit: MeasureUnitDef;
  quantity?: Approx;
  or?: number;
}

function resolveParts(occ: MeasureOccurrence, registry: MeasureRegistry): ResolvedPart[] {
  const out: ResolvedPart[] = [];
  occ.parts.forEach((p, i) => {
    const unit = registry.effectiveUnit(p.unit, i === 0 ? occ.unitOverride : undefined);
    if (!unit) return;
    let quantity = p.quantity;
    if (quantity && p.or !== undefined) {
      // "five and twenty or thirty furlongs": the value is the first count, the range runs to the second.
      quantity = { value: quantity.value, low: quantity.low ?? quantity.value, high: Math.max(quantity.high ?? quantity.value, p.or) };
    }
    out.push({ unit, ...(quantity ? { quantity } : {}), ...(p.or !== undefined ? { or: p.or } : {}) });
  });
  return out;
}

function usesTextNames(ctx: PopupContext, unitId: string | undefined): boolean {
  if (!ctx.textLanguage || !ctx.pack.textNames || !unitId || !ctx.textWord) return false;
  if (measurePackLanguage(ctx.textLanguage) !== measurePackLanguage(ctx.pack.language)) return false;
  const forms = ctx.pack.textNames[unitId];
  if (!forms) return false;
  const word = normalizeToken(ctx.textWord);
  return Object.values(forms).some((f) => typeof f === 'string' && tokenizePhrase(f).includes(word));
}

/** A small count picks the singular ("½ shekel"); a pair of counts the larger one. */
function pluralCount(p: ResolvedPart): number | undefined {
  if (!p.quantity) return undefined;
  const v = p.or ?? p.quantity.value;
  return v > 0 && v < 1 ? 1 : v;
}

/** "Greek lepton (pl. lepta)": the unit's own name, with its plural when that is irregular. Qualifiers in parentheses are left to the note. */
function scholarlyName(unit: MeasureUnitDef, ctx: PopupContext): string {
  const bare = (t: string): string => t.replace(/\s*\([^)]*\)\s*$/, '');
  const forms = ctx.pack.names[unit.id];
  const one = bare(unitName(ctx.pack, unit.id, undefined, ctx.locale));
  const other = forms?.other ? bare(forms.other) : one;
  const regular = other === one || other === `${one}s` || other === `${one}es`;
  const name = regular ? one : phrase(ctx.pack, 'pluralNote', { name: one, plural: other });
  return phrase(ctx.pack, 'scholarlyName', { system: phrase(ctx.pack, `system.${unit.system}`), name });
}

function buildTitle(parts: ResolvedPart[], occ: MeasureOccurrence, ctx: PopupContext): { title: string; subtitle?: string } {
  const textMode = usesTextNames(ctx, parts[0]?.unit.id);
  const subtitles: string[] = [];
  const pieces = parts.map((p) => {
    const count = pluralCount(p);
    const own = textMode ? textUnitName(ctx.pack, p.unit.id, count, ctx.locale) : undefined;
    const name = own ?? unitName(ctx.pack, p.unit.id, count, ctx.locale);
    if (own !== undefined) {
      const scholar = unitName(ctx.pack, p.unit.id, count, ctx.locale);
      if (own.toLowerCase() !== scholar.toLowerCase()) subtitles.push(scholarlyName(p.unit, ctx));
    }
    if (p.unit.dimension === 'time' || !p.quantity) return name;
    const n = p.or !== undefined
      ? phrase(ctx.pack, 'quantityOr', { a: formatTitleQuantity(p.quantity.value, ctx.locale), b: formatTitleQuantity(p.or, ctx.locale) })
      : formatTitleQuantity(p.quantity.value, ctx.locale);
    return phrase(ctx.pack, 'quantityName', { n, name });
  });
  let title = pieces.join(phrase(ctx.pack, 'and'));
  const per = occ.per ? phrase(ctx.pack, `per.${occ.per}`) : '';
  if (per) title = phrase(ctx.pack, 'withPer', { text: title, per });
  return { title, ...(subtitles.length ? { subtitle: subtitles.join(', ') } : {}) };
}

function buildRelation(first: MeasureUnitDef, ctx: PopupContext): string | undefined {
  const items: string[] = [];
  let cur = first;
  let factor = 1;
  for (let level = 0; level < 2; level++) {
    if (!cur.relation) break;
    const next = ctx.registry.unit(cur.relation.unit);
    if (!next) break;
    factor *= cur.relation.factor;
    items.push(phrase(ctx.pack, 'quantityName', {
      n: formatTitleQuantity(factor, ctx.locale), name: unitName(ctx.pack, next.id, factor, ctx.locale),
    }));
    cur = next;
  }
  if (!items.length) return undefined;
  return phrase(ctx.pack, 'relation', { unit: unitName(ctx.pack, first.id, undefined, ctx.locale), list: items.join(' = ') });
}

export function buildMeasurePopup(occ: MeasureOccurrence, ctx: PopupContext): MeasurePopupModel | undefined {
  const parts = resolveParts(occ, ctx.registry);
  if (!parts.length) return undefined;
  const first = parts[0].unit;
  const fmt: FormatContext = { locale: ctx.locale, pack: ctx.pack };
  const { prefs } = ctx;
  const per = occ.per ? phrase(ctx.pack, `per.${occ.per}`) : '';
  /** The rate goes on lengths, metal weights and the like; wages lines are already per unit of time. */
  const withPer = (s: string): string => (per ? phrase(ctx.pack, 'withPer', { text: s, per }) : s);

  let valueText: string | undefined; // primary without the approx sign
  let approximate = true;
  let secondary: string | undefined;
  let range: string | undefined;
  const extra: string[] = [];

  const dim = first.dimension;
  if (isPhysicalDimension(dim)) {
    const same = parts.filter((p) => p.unit.dimension === dim && p.unit.base);
    if (!same.length) return undefined;
    const si = sumApprox(same.map((p) => ({ amount: p.unit.base as Approx, quantity: p.quantity })));
    const cv = convertToSystem(dim, si, prefs.system);
    if (!cv) return undefined;
    valueText = withPer(formatConverted(cv, fmt));
    if (shouldShowRange(prefs.ranges, cv)) range = formatConvertedRange(cv, fmt);
    if (secondaryApplies(dim, prefs.secondary, prefs.system)) {
      const cv2 = convertToSystem(dim, si, prefs.secondary);
      if (cv2) secondary = withPer(formatConverted(cv2, fmt));
    }
  } else if (dim === 'money') {
    const wageParts = parts.filter((p) => p.unit.money?.wages);
    const days = wageParts.length
      ? sumApprox(wageParts.map((p) => ({ amount: p.unit.money!.wages as Approx, quantity: p.quantity }))).value
      : undefined;
    const metal = first.money?.metal?.metal;
    const metalParts = parts.filter((p) => p.unit.money?.metal && p.unit.money.metal.metal === metal);
    const kg = metalParts.length
      ? sumApprox(metalParts.map((p) => {
          const g = p.unit.money!.metal!.grams;
          return { amount: { value: g.value / 1000, ...(g.low !== undefined ? { low: g.low / 1000 } : {}), ...(g.high !== undefined ? { high: g.high / 1000 } : {}) }, quantity: p.quantity };
        }))
      : undefined;
    const metalLine = kg && metal ? formatMetal(kg, metal, prefs.system, fmt)?.text : undefined;
    const wagesLine = days !== undefined ? formatWages(days, fmt) : undefined;

    const metalFirst = prefs.money === 'metal' && metalLine;
    if (metalFirst) {
      valueText = withPer(metalLine);
      if (wagesLine) extra.push(wagesLine.text);
    } else if (wagesLine) {
      valueText = wagesLine.text; // "a penny a day" is 1 day's wages, not "1 day's wages a day"
      if (prefs.money === 'both' && metalLine) extra.push(withPer(metalLine));
    } else if (metalLine) {
      valueText = withPer(metalLine);
    } else {
      return undefined;
    }
    if (days !== undefined && wagesLine && (wagesLine.scale === 'month' || wagesLine.scale === 'year')) {
      extra.push(pluralPhrase(ctx.pack, 'wages.day', days, ctx.locale, { n: formatSig2(days, ctx.locale) }));
    }
    if (days !== undefined && prefs.modernDailyWage) {
      const line = formatModernWage(days, prefs.modernDailyWage, fmt);
      if (line) extra.push(line);
    }
  } else {
    const clock = formatClock(first, prefs, fmt);
    if (!clock) return undefined;
    valueText = clock;
    approximate = false;
    const reckoning = reckoningLine(first, ctx.pack);
    if (reckoning) extra.push(reckoning);
  }

  const seen = new Set<string>();
  const sourceIds: string[] = [];
  for (const p of parts) for (const s of p.unit.sources) if (!seen.has(s)) { seen.add(s); sourceIds.push(s); }

  const { title, subtitle } = buildTitle(parts, occ, ctx);
  const model: MeasurePopupModel = {
    occurrenceId: occ.id,
    verseId: occ.verseId,
    title,
    primary: approximate ? phrase(ctx.pack, 'approx', { value: valueText }) : valueText,
    badge: valueText,
    extra,
    usage: occ.usage,
    review: occ.review.status,
    sources: ctx.registry.sources(sourceIds),
    parts: occ.parts.length,
  };
  if (subtitle) model.subtitle = subtitle;
  if (secondary) model.secondary = secondary;
  if (range) model.range = range;
  const relation = buildRelation(first, ctx);
  if (relation) model.relation = relation;
  const unitNote = noteFor(ctx.pack, first.noteKey ?? first.id);
  if (unitNote) model.unitNote = unitNote;
  const verseNote = noteFor(ctx.pack, occ.noteKey);
  if (verseNote) model.verseNote = verseNote;
  return model;
}
