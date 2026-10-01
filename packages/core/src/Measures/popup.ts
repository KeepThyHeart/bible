/**
 * The popup view model: one occurrence in, final localized strings out.
 * Missing data never throws: an unknown unit (or one with nothing to convert)
 * yields `undefined`.
 */
import {
  convertToSystem, formatClock, formatConverted, formatConvertedRange, formatMetal, formatModernWage,
  formatQuantity, formatSig2, formatWages, isPhysicalDimension, reckoningLine, secondaryApplies,
  shouldShowRange, sumApprox, type FormatContext,
} from './convert';
import { noteFor, phrase, pluralPhrase, unitName } from './locale';
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
}

interface ResolvedPart {
  unit: MeasureUnitDef;
  quantity?: Approx;
}

function resolveParts(occ: MeasureOccurrence, registry: MeasureRegistry): ResolvedPart[] {
  const out: ResolvedPart[] = [];
  occ.parts.forEach((p, i) => {
    const unit = registry.effectiveUnit(p.unit, i === 0 ? occ.unitOverride : undefined);
    if (unit) out.push({ unit, ...(p.quantity ? { quantity: p.quantity } : {}) });
  });
  return out;
}

function buildTitle(parts: ResolvedPart[], occ: MeasureOccurrence, ctx: PopupContext): string {
  const pieces = parts.map((p) => {
    if (p.unit.dimension === 'time' || !p.quantity) return unitName(ctx.pack, p.unit.id, undefined, ctx.locale);
    return `${formatQuantity(p.quantity.value, ctx.locale)} ${unitName(ctx.pack, p.unit.id, p.quantity.value, ctx.locale)}`;
  });
  let title = pieces.join(phrase(ctx.pack, 'and'));
  const per = occ.per ? phrase(ctx.pack, `per.${occ.per}`) : '';
  if (per) title += ` ${per}`;
  return title;
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
    items.push(`${formatQuantity(factor, ctx.locale)} ${unitName(ctx.pack, next.id, factor, ctx.locale)}`);
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
  const withPer = (s: string): string => (per ? `${s} ${per}` : s);

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
      valueText = withPer(wagesLine.text);
      if (prefs.money === 'both' && metalLine) extra.push(metalLine);
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

  const model: MeasurePopupModel = {
    occurrenceId: occ.id,
    verseId: occ.verseId,
    title: buildTitle(parts, occ, ctx),
    primary: approximate ? phrase(ctx.pack, 'approx', { value: valueText }) : valueText,
    badge: valueText,
    extra,
    usage: occ.usage,
    review: occ.review.status,
    sources: ctx.registry.sources(sourceIds),
    parts: occ.parts.length,
  };
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
