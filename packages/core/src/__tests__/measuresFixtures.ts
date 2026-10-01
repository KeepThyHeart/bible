/** Test fixtures: a small unit registry and packs, independent of the shipped data. */
import { createLocalePack } from '../Measures/locale';
import { MeasureRegistry } from '../Measures/registry';
import type { MeasureLocalePack, MeasureOccurrence, MeasurePreferences, MeasureSource, MeasureUnitDef } from '../Measures/types';

const src = ['abd'];

export const FIXTURE_UNITS: MeasureUnitDef[] = [
  { id: 'cubit', dimension: 'length', system: 'hebrew', base: { value: 0.457, low: 0.44, high: 0.52 }, relation: { unit: 'span', factor: 2 }, strongs: ['H520', 'G4083'], sources: src },
  { id: 'cubit.long', dimension: 'length', system: 'hebrew', base: { value: 0.52, low: 0.5, high: 0.54 }, strongs: ['H520'], noteKey: 'cubit.long', sources: src },
  { id: 'span', dimension: 'length', system: 'hebrew', base: { value: 0.2286 }, relation: { unit: 'handbreadth', factor: 3 }, strongs: ['H2239'], sources: src },
  { id: 'handbreadth', dimension: 'length', system: 'hebrew', base: { value: 0.0762 }, strongs: ['H2947'], sources: src },
  { id: 'shekel', dimension: 'mass', system: 'hebrew', base: { value: 0.0114 }, strongs: ['H8255'], sources: src },
  { id: 'talent', dimension: 'mass', system: 'hebrew', base: { value: 34, low: 30, high: 38 }, strongs: ['H3603'], sources: src },
  { id: 'ephah', dimension: 'volume_dry', system: 'hebrew', base: { value: 22 }, strongs: ['H374'], sources: src },
  { id: 'hin', dimension: 'volume_liquid', system: 'hebrew', base: { value: 3.67 }, strongs: ['H1969'], sources: src },
  { id: 'denarius', dimension: 'money', system: 'roman', money: { wages: { value: 1 }, metal: { metal: 'silver', grams: { value: 3.9 } } }, strongs: ['G1220'], sources: src },
  { id: 'talent.money', dimension: 'money', system: 'greek', money: { wages: { value: 6000 } }, strongs: ['G5007'], sources: src },
  { id: 'lepton', dimension: 'money', system: 'greek', money: { wages: { value: 1 / 128 } }, strongs: ['G3016'], sources: src },
  { id: 'hour.9', dimension: 'time', system: 'roman', clock: { reckoning: 'jewish', start: '15:00', end: '15:00' }, strongs: ['G5610'], sources: src },
  { id: 'watch.roman.4', dimension: 'time', system: 'roman', clock: { reckoning: 'roman', start: '03:00', end: '06:00' }, strongs: ['G5438'], sources: src },
];

export const FIXTURE_SOURCES: MeasureSource[] = [{ id: 'abd', title: 'Anchor Bible Dictionary' }];

export const fixtureRegistry = (): MeasureRegistry => new MeasureRegistry(FIXTURE_UNITS, FIXTURE_SOURCES);

export const FIXTURE_EN_PACK: MeasureLocalePack = createLocalePack({
  language: 'en',
  names: {
    cubit: { one: 'cubit', other: 'cubits' },
    span: { one: 'span', other: 'spans' },
    handbreadth: { one: 'handbreadth', other: 'handbreadths' },
    shekel: { one: 'shekel', other: 'shekels' },
    talent: { one: 'talent', other: 'talents' },
    denarius: { one: 'denarius', other: 'denarii' },
    'talent.money': { one: 'talent', other: 'talents' },
    lepton: { one: 'lepton', other: 'lepta' },
    'hour.9': { one: 'the ninth hour', other: 'the ninth hour' },
    'watch.roman.4': { one: 'the fourth watch', other: 'the fourth watch' },
  },
  terms: {
    cubit: ['cubit', 'cubits'],
    'cubit#modern': ['feet', 'foot'],
    span: ['span'],
    handbreadth: ['handbreadth', 'hand breadth'],
    shekel: ['shekel', 'shekels'],
    denarius: ['penny', 'pence', 'pennyworth'],
    hin: ['hin'],
    ephah: ['ephah'],
    talent: ['talent', 'talents'],
  },
  notes: { cubit: 'A cubit is the forearm.', 'v.1': 'A verse note.' },
});

export const FIXTURE_ES_PACK: MeasureLocalePack = createLocalePack({
  language: 'es',
  names: { cubit: { one: 'codo', other: 'codos' } },
  terms: { cubit: ['codo', 'codos'] },
}, { fallback: FIXTURE_EN_PACK });

export function prefs(over: Partial<MeasurePreferences> = {}): MeasurePreferences {
  return {
    enabled: true, display: 'marker', showInReading: false, system: 'metric', secondary: 'us', money: 'wages',
    clock: 'h12', ranges: 'auto', includeDrafts: false, ...over,
  };
}

export function occ(
  id: string, parts: MeasureOccurrence['parts'], extra: Partial<MeasureOccurrence> = {},
): MeasureOccurrence {
  return {
    id, verseId: Number(id.split('.')[0]), parts, usage: 'literal', review: { status: 'reviewed' }, ...extra,
  };
}

export function words(text: string): { text: string }[] {
  return text.split(/\s+/).filter(Boolean).map((t) => ({ text: t }));
}
