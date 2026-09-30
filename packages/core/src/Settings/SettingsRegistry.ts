/**
 * Settings registry: declarative setting definitions (key, type, default, scope,
 * validation, label keys, UI group) so a feature declares its settings once
 * instead of hand-wiring a store field, a save/load line and a settings tab row.
 *
 * Pure and platform-free (safe in `@bible/core/browser`). Persistence is a
 * separate concern: see `SettingsStore` and its `SettingsStoragePort`.
 *
 * ```ts
 * const registry = defineSettings([
 *   { key: 'swipeChaptersEnabled', type: 'boolean', default: true, scope: 'device',
 *     group: 'gestures', labelKey: 'settings.gestures.swipeChaptersEnabled',
 *     label: 'Swipe to change chapters' },
 * ]);
 * ```
 *
 * Scopes:
 *  - `device`: this device only (layout, gestures, font sizes).
 *  - `synced`: follows the user across devices where a synced user-data store
 *    exists (web 0084); on apps without one it behaves like `device`.
 *
 * Labels: each definition carries a catalog key (`labelKey`, `descriptionKey`) and
 * an English default (`label`, `description`). `toFields` resolves them through an
 * optional `translate(key, fallback)` so both apps and `@bible/ui` (which has no
 * i18n library) render the same fields.
 */

import type { FeatureFlagName } from './FeatureFlags';
import {
  isFieldVisible,
  validateSettingValue,
  type SettingsField,
} from './settingsFields';

export type SettingScope = 'device' | 'synced';

interface SettingBase {
  /** Unique key, stored as-is. Avoid dots: they are path separators in the field model. */
  key: string;
  scope: SettingScope;
  /** UI group (a settings tab or section id). */
  group: string;
  /** Ordering inside the group (ascending; ties keep declaration order). */
  order?: number;
  labelKey: string;
  /** English default shown when no translation resolves. */
  label?: string;
  descriptionKey?: string;
  description?: string;
  /** Show only when sibling settings hold these values (same rule as extension settings). */
  dependsOn?: Record<string, unknown>;
  /** Show only when this feature flag is enabled (see `FeatureFlags`). */
  flag?: FeatureFlagName;
  /** Extra validation on top of the type check. Return false to reject. */
  validate?: (value: never) => boolean;
}

export interface BooleanSetting extends SettingBase {
  type: 'boolean';
  default: boolean;
}
export interface StringSetting extends SettingBase {
  type: 'string';
  default: string;
}
export interface EnumSetting extends SettingBase {
  type: 'enum';
  values: readonly string[];
  default: string;
  /** Catalog keys per value, for hosts that translate option labels. */
  valueLabelKeys?: Readonly<Record<string, string>>;
}
export interface NumberSetting extends SettingBase {
  type: 'number' | 'integer';
  default: number;
  min?: number;
  max?: number;
  step?: number;
  /** Render as a slider (needs `min` and `max`). */
  widget?: 'slider';
}
export interface StringArraySetting extends SettingBase {
  type: 'string-array';
  default: readonly string[];
}

export type SettingDef =
  | BooleanSetting
  | StringSetting
  | EnumSetting
  | NumberSetting
  | StringArraySetting;

export type SettingValue = boolean | string | number | string[];

export type ValidateResult =
  | { ok: true; value: SettingValue }
  | { ok: false; error: string };

export interface SettingGroup {
  id: string;
  settings: SettingDef[];
}

export interface ToFieldsOptions {
  /** Resolve a catalog key; return the fallback (English default) when unknown. */
  translate?: (key: string, fallback: string) => string;
  /** Feature flag check for definitions with `flag`; omitted means all flags on. */
  isEnabled?: (flag: FeatureFlagName) => boolean;
  /** Current values, for `dependsOn` filtering. Omitted keeps every field. */
  values?: Record<string, unknown>;
}

export class SettingsRegistry {
  private readonly byKey = new Map<string, SettingDef>();
  private readonly ordered: SettingDef[];

  constructor(defs: readonly SettingDef[]) {
    for (const def of defs) {
      if (this.byKey.has(def.key)) throw new Error(`Duplicate setting key '${def.key}'`);
      const problem = definitionProblem(def);
      if (problem) throw new Error(`Setting '${def.key}': ${problem}`);
      this.byKey.set(def.key, def);
    }
    // Stable sort: order ascending, declaration order on ties.
    this.ordered = defs
      .map((def, index) => ({ def, index }))
      .sort((a, b) => (a.def.order ?? 0) - (b.def.order ?? 0) || a.index - b.index)
      .map((e) => e.def);
  }

  get definitions(): readonly SettingDef[] {
    return this.ordered;
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  get(key: string): SettingDef | undefined {
    return this.byKey.get(key);
  }

  /** Every default, keyed by setting key. Arrays are copies. */
  defaults(): Record<string, SettingValue> {
    const out: Record<string, SettingValue> = {};
    for (const def of this.ordered) out[def.key] = cloneValue(def.default);
    return out;
  }

  defaultFor(key: string): SettingValue | undefined {
    const def = this.byKey.get(key);
    return def ? cloneValue(def.default) : undefined;
  }

  keysForScope(scope: SettingScope): string[] {
    return this.ordered.filter((d) => d.scope === scope).map((d) => d.key);
  }

  groups(): SettingGroup[] {
    const groups = new Map<string, SettingDef[]>();
    for (const def of this.ordered) {
      const list = groups.get(def.group) ?? [];
      list.push(def);
      groups.set(def.group, list);
    }
    return [...groups].map(([id, settings]) => ({ id, settings }));
  }

  /**
   * Check a value for `key`. Numbers are clamped into `min`/`max` (integers are
   * rounded first) rather than rejected, matching how the apps' sliders have always
   * behaved. Everything else is rejected when it has the wrong type, is outside an
   * enum, or fails the definition's own `validate`.
   */
  validate(key: string, value: unknown): ValidateResult {
    const def = this.byKey.get(key);
    if (!def) return { ok: false, error: `Unknown setting '${key}'` };
    let next: unknown = value;
    if (def.type === 'number' || def.type === 'integer') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { ok: false, error: `'${key}' must be a ${def.type}` };
      }
      next = clampNumber(def, value);
    }
    const checked = validateSettingValue(toField(def), next);
    if (!checked.ok) return checked;
    if (def.validate && !(def.validate as (v: unknown) => boolean)(next)) {
      return { ok: false, error: `'${key}' failed validation` };
    }
    return { ok: true, value: cloneValue(next as SettingValue) };
  }

  /**
   * Read a raw stored object defensively: each known key is validated on its own and
   * falls back to its default, and unknown keys are dropped, so one bad field never
   * discards the rest.
   */
  sanitize(raw: unknown): Record<string, SettingValue> {
    const source = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const out = this.defaults();
    for (const def of this.ordered) {
      if (!(def.key in source)) continue;
      const result = this.validate(def.key, source[def.key]);
      if (result.ok) out[def.key] = result.value;
    }
    return out;
  }

  /**
   * The registry's settings for one group as the flat field model the shared
   * `SettingsForm` (and the desktop extension renderer) renders. Definitions whose
   * `flag` is off, or whose `dependsOn` does not match `values`, are left out.
   */
  toFields(groupId: string, options: ToFieldsOptions = {}): SettingsField[] {
    const translate = options.translate ?? ((_key: string, fallback: string) => fallback);
    const fields: SettingsField[] = [];
    for (const def of this.ordered) {
      if (def.group !== groupId) continue;
      if (def.flag && options.isEnabled && !options.isEnabled(def.flag)) continue;
      const field = toField(def);
      field.title = translate(def.labelKey, def.label ?? def.key);
      if (def.descriptionKey || def.description) {
        field.description = translate(def.descriptionKey ?? '', def.description ?? '');
      }
      if (def.type === 'enum' && def.valueLabelKeys) {
        field.enumLabels = {};
        for (const value of def.values) {
          const key = def.valueLabelKeys[value];
          field.enumLabels[value] = key ? translate(key, value) : value;
        }
      }
      if (options.values && !isFieldVisible(field, options.values)) continue;
      fields.push(field);
    }
    return fields;
  }
}

/** Create a registry, throwing on duplicate keys or malformed definitions. */
export function defineSettings(defs: readonly SettingDef[]): SettingsRegistry {
  return new SettingsRegistry(defs);
}

/** Combine registries (each feature declares its own; the app merges them). */
export function mergeSettings(...registries: SettingsRegistry[]): SettingsRegistry {
  return new SettingsRegistry(registries.flatMap((r) => [...r.definitions]));
}

// --- internals --------------------------------------------------------------

function toField(def: SettingDef): SettingsField {
  const field: SettingsField = {
    key: def.key,
    propertyName: def.key,
    kind: def.type === 'string-array' ? 'string-array' : def.type,
    required: false,
    defaultValue: cloneValue(def.default),
    labelKey: def.labelKey,
  };
  if (def.descriptionKey) field.descriptionKey = def.descriptionKey;
  if (def.dependsOn) field.dependsOn = def.dependsOn;
  if (def.type === 'enum') field.enumValues = [...def.values];
  if (def.type === 'number' || def.type === 'integer') {
    const c: NonNullable<SettingsField['numberConstraints']> = {};
    if (def.min !== undefined) c.minimum = def.min;
    if (def.max !== undefined) c.maximum = def.max;
    if (def.step !== undefined) c.multipleOf = def.step;
    field.numberConstraints = c;
    if (def.widget) field.widget = def.widget;
  }
  return field;
}

function clampNumber(def: NumberSetting, value: number): number {
  let n = def.type === 'integer' ? Math.round(value) : value;
  if (def.min !== undefined) n = Math.max(def.min, n);
  if (def.max !== undefined) n = Math.min(def.max, n);
  if (def.step !== undefined && def.type === 'number') {
    // Snap to the step grid, rounding away float noise (1.7999999 -> 1.8).
    const base = def.min ?? 0;
    const snapped = base + Math.round((n - base) / def.step) * def.step;
    n = Math.round(snapped * 1e6) / 1e6;
    if (def.min !== undefined) n = Math.max(def.min, n);
    if (def.max !== undefined) n = Math.min(def.max, n);
  }
  return n;
}

function cloneValue(value: SettingValue | readonly string[]): SettingValue {
  return (Array.isArray(value) ? [...value] : value) as SettingValue;
}

/** Definition-time sanity checks, so a typo fails at startup and not in a settings dialog. */
function definitionProblem(def: SettingDef): string | null {
  if (!def.key) return 'empty key';
  if (def.key.includes('.')) return 'key must not contain dots';
  if (!def.group) return 'missing group';
  if (!def.labelKey) return 'missing labelKey';
  if (def.type === 'enum') {
    if (def.values.length === 0) return 'enum needs values';
    if (!def.values.includes(def.default)) return 'default is not one of the enum values';
  }
  if (def.type === 'number' || def.type === 'integer') {
    if (typeof def.default !== 'number' || !Number.isFinite(def.default)) return 'default must be a number';
    if (def.min !== undefined && def.max !== undefined && def.min > def.max) return 'min is above max';
    if (def.min !== undefined && def.default < def.min) return 'default is below min';
    if (def.max !== undefined && def.default > def.max) return 'default is above max';
    if (def.widget === 'slider' && (def.min === undefined || def.max === undefined)) {
      return 'slider needs min and max';
    }
  }
  return null;
}
