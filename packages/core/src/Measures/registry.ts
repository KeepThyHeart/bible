/**
 * The unit registry: units and sources, indexed by id. Pure; the bundled
 * instance is built lazily from `data/units.json` and `data/sources.json`,
 * and tests build their own from fixtures.
 */
import unitsJson from './data/units.json';
import sourcesJson from './data/sources.json';
import type { MeasureOccurrence, MeasureSource, MeasureUnitDef } from './types';

export class MeasureRegistry {
  private readonly byId = new Map<string, MeasureUnitDef>();
  private readonly sourceById = new Map<string, MeasureSource>();

  constructor(units: readonly MeasureUnitDef[], sources: readonly MeasureSource[] = []) {
    for (const u of units) this.byId.set(u.id, u);
    for (const s of sources) this.sourceById.set(s.id, s);
  }

  unit(id: string): MeasureUnitDef | undefined {
    return this.byId.get(id);
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  allUnits(): MeasureUnitDef[] {
    return [...this.byId.values()];
  }

  /** Sources by id, skipping unknown ids. */
  sources(ids: readonly string[]): MeasureSource[] {
    const out: MeasureSource[] = [];
    for (const id of ids) {
      const s = this.sourceById.get(id);
      if (s && !out.includes(s)) out.push(s);
    }
    return out;
  }

  /**
   * The unit as it applies to one occurrence: the registry definition with the
   * occurrence's `unitOverride` laid over it (the override replaces whole
   * `base` / `clock` / `money` values).
   */
  effectiveUnit(unitId: string, override?: MeasureOccurrence['unitOverride']): MeasureUnitDef | undefined {
    const unit = this.byId.get(unitId);
    if (!unit) return undefined;
    if (!override) return unit;
    return { ...unit, ...(override.base ? { base: override.base } : {}), ...(override.clock ? { clock: override.clock } : {}), ...(override.money ? { money: override.money } : {}) };
  }
}

let bundled: MeasureRegistry | undefined;

/** The registry built from the bundled JSON (cached). */
export function getMeasureRegistry(): MeasureRegistry {
  if (!bundled) {
    bundled = new MeasureRegistry(
      unitsJson as unknown as MeasureUnitDef[],
      sourcesJson as unknown as MeasureSource[],
    );
  }
  return bundled;
}
