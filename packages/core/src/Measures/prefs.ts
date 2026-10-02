/**
 * Reader preferences: the setting definitions core declares (apps store them)
 * and the resolver that turns raw values plus the UI locale into a
 * `MeasurePreferences` with no 'auto' left.
 */
import { defineSettings, type SettingDef } from '../Settings/SettingsRegistry';
import type { MeasurePreferences, MeasureSystem } from './types';

const g = { scope: 'device', group: 'measures' } as const;

export const MEASURE_SETTINGS: SettingDef[] = [
  { ...g, key: 'measuresEnabled', type: 'boolean', default: true, order: 10,
    labelKey: 'settings.measures.enabled', label: 'Weights, measures and money notes',
    descriptionKey: 'settings.measures.enabled.description', description: 'Mark ancient units in the text and show their modern equivalents.' },
  { ...g, key: 'measuresDisplay', type: 'enum', values: ['marker', 'inline', 'off'], default: 'off', order: 20,
    labelKey: 'settings.measures.display', label: 'Show in the text',
    descriptionKey: 'settings.measures.display.description', description: 'Off keeps the text clean (the conversions are in the Study panel). Otherwise: a dotted underline with a popup, or an underline with the conversion in [brackets] after the phrase.',
    valueLabelKeys: { marker: 'settings.measures.display.marker', inline: 'settings.measures.display.inline', off: 'settings.measures.display.off' },
    dependsOn: { measuresEnabled: true } },
  { ...g, key: 'measuresShowInReading', type: 'boolean', default: false, order: 30,
    labelKey: 'settings.measures.showInReading', label: 'Show in Reading mode',
    descriptionKey: 'settings.measures.showInReading.description', description: 'Reading mode stays clean text unless you turn this on.',
    dependsOn: { measuresEnabled: true } },
  { ...g, key: 'measuresSystem', type: 'enum', values: ['auto', 'metric', 'us', 'imperial'], default: 'auto', order: 40,
    labelKey: 'settings.measures.system', label: 'Unit system',
    descriptionKey: 'settings.measures.system.description', description: 'Auto follows your language and region.',
    valueLabelKeys: { auto: 'settings.measures.system.auto', metric: 'settings.measures.system.metric', us: 'settings.measures.system.us', imperial: 'settings.measures.system.imperial' } },
  { ...g, key: 'measuresSecondary', type: 'enum', values: ['auto', 'none', 'metric', 'us', 'imperial'], default: 'auto', order: 50,
    labelKey: 'settings.measures.secondary', label: 'Second unit system',
    descriptionKey: 'settings.measures.secondary.description', description: 'Also show the value in another system (imperial: length and weight only).',
    valueLabelKeys: { auto: 'settings.measures.system.auto', none: 'settings.measures.secondary.none', metric: 'settings.measures.system.metric', us: 'settings.measures.system.us', imperial: 'settings.measures.system.imperial' } },
  { ...g, key: 'measuresMoney', type: 'enum', values: ['wages', 'metal', 'both'], default: 'wages', order: 60,
    labelKey: 'settings.measures.money', label: 'Money',
    descriptionKey: 'settings.measures.money.description', description: "Days' wages (default), the weight of metal, or both.",
    valueLabelKeys: { wages: 'settings.measures.money.wages', metal: 'settings.measures.money.metal', both: 'settings.measures.money.both' } },
  { ...g, key: 'measuresDailyWage', type: 'number', default: 0, min: 0, order: 70,
    labelKey: 'settings.measures.dailyWage', label: 'Your daily wage',
    descriptionKey: 'settings.measures.dailyWage.description', description: "Optional: shows a modern estimate of a sum from days' wages. 0 = off." },
  { ...g, key: 'measuresWageCurrency', type: 'string', default: 'USD', order: 80,
    labelKey: 'settings.measures.wageCurrency', label: 'Currency of your daily wage',
    descriptionKey: 'settings.measures.wageCurrency.description', description: 'A currency code such as USD, EUR or GBP.' },
  { ...g, key: 'measuresClock', type: 'enum', values: ['auto', 'h12', 'h23'], default: 'auto', order: 90,
    labelKey: 'settings.measures.clock', label: 'Clock times',
    descriptionKey: 'settings.measures.clock.description', description: 'Auto follows your language and region.',
    valueLabelKeys: { auto: 'settings.measures.system.auto', h12: 'settings.measures.clock.h12', h23: 'settings.measures.clock.h23' } },
  { ...g, key: 'measuresRanges', type: 'enum', values: ['auto', 'always', 'never'], default: 'auto', order: 100,
    labelKey: 'settings.measures.ranges', label: 'Ranges',
    descriptionKey: 'settings.measures.ranges.description', description: 'Show the uncertainty range of a value: when it is wide (auto), always, or never.',
    valueLabelKeys: { auto: 'settings.measures.system.auto', always: 'settings.measures.ranges.always', never: 'settings.measures.ranges.never' } },
];

/** The measure settings as a registry (convenience for apps). */
export const measureSettingsRegistry = defineSettings(MEASURE_SETTINGS);

export interface DefaultMeasureSystems {
  system: MeasureSystem;
  secondary: MeasureSystem | 'none';
}

function regionOf(locale: string): string | undefined {
  try {
    return new Intl.Locale(locale).maximize().region;
  } catch {
    return undefined;
  }
}

/** Region defaults: US, LR, MM -> us + metric; GB -> metric + imperial; else metric + none. */
export function defaultMeasureSystems(locale: string): DefaultMeasureSystems {
  const region = regionOf(locale);
  if (region === 'US' || region === 'LR' || region === 'MM') return { system: 'us', secondary: 'metric' };
  if (region === 'GB') return { system: 'metric', secondary: 'imperial' };
  return { system: 'metric', secondary: 'none' };
}

/** 'h12' or 'h23' for a locale (`Intl` hour cycle). */
export function defaultClock(locale: string): 'h12' | 'h23' {
  try {
    const hc = (new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions() as { hourCycle?: string }).hourCycle;
    return hc === 'h11' || hc === 'h12' ? 'h12' : 'h23';
  } catch {
    return 'h23';
  }
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

export function resolveMeasurePreferences(
  values: Record<string, unknown> | undefined,
  uiLocale: string,
  opts: { includeDrafts?: boolean } = {},
): MeasurePreferences {
  const v = values ?? {};
  const defaults = defaultMeasureSystems(uiLocale);

  const sysChoice = oneOf(v.measuresSystem, ['auto', 'metric', 'us', 'imperial'] as const) ?? 'auto';
  const system: MeasureSystem = sysChoice === 'auto' ? defaults.system : sysChoice;

  const secChoice = oneOf(v.measuresSecondary, ['auto', 'none', 'metric', 'us', 'imperial'] as const) ?? 'auto';
  let secondary: MeasureSystem | 'none';
  if (secChoice === 'auto') {
    if (system === defaults.system) secondary = defaults.secondary;
    else if (system !== 'metric') secondary = 'metric';
    else secondary = defaults.system !== 'metric' ? defaults.system : 'none';
  } else {
    secondary = secChoice;
  }
  if (secondary === system) secondary = 'none';

  const clockChoice = oneOf(v.measuresClock, ['auto', 'h12', 'h23'] as const) ?? 'auto';
  const wage = typeof v.measuresDailyWage === 'number' && v.measuresDailyWage > 0 ? v.measuresDailyWage : undefined;
  const currency = typeof v.measuresWageCurrency === 'string' && v.measuresWageCurrency.trim() ? v.measuresWageCurrency.trim().toUpperCase() : 'USD';

  return {
    enabled: typeof v.measuresEnabled === 'boolean' ? v.measuresEnabled : true,
    display: oneOf(v.measuresDisplay, ['marker', 'inline', 'off'] as const) ?? 'off',
    showInReading: typeof v.measuresShowInReading === 'boolean' ? v.measuresShowInReading : false,
    system,
    secondary,
    money: oneOf(v.measuresMoney, ['wages', 'metal', 'both'] as const) ?? 'wages',
    ...(wage !== undefined ? { modernDailyWage: { amount: wage, currency } } : {}),
    clock: clockChoice === 'auto' ? defaultClock(uiLocale) : clockChoice,
    ranges: oneOf(v.measuresRanges, ['auto', 'always', 'never'] as const) ?? 'auto',
    includeDrafts: opts.includeDrafts ?? false,
  };
}
