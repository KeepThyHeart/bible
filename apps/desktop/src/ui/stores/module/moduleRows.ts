import type { ModuleType, ModuleMetadata, CatalogModule } from './types';
import { MODULE_TYPES } from '@bible/core';

/**
 * A merged view of a module: catalog and/or installed, with computed flags.
 * Keyed by abbreviation (the join key between catalog and installed).
 */
export interface ModuleRow {
  /** Module abbreviation - the join key */
  abbreviation: string;
  module_type: ModuleType;
  name: string;
  language_code: string;
  /** Whether this module is currently installed */
  installed: boolean;
  /** Whether an update is available for this module */
  updateAvailable: boolean;
  /** The catalog entry, if available */
  catalogModule: CatalogModule | undefined;
  /** The installed entry, if available */
  installedModule: ModuleMetadata | undefined;
  /** Module ID for joining to download progress; prefer number if installed, else string */
  module_id: string | number;
}

/**
 * Merge catalog and installed modules into a single row per abbreviation.
 * Rows are grouped by module_type and sorted within each group:
 * - Recommended modules first, alphabetically by name
 * - Then remaining modules, alphabetically by name
 * Uses locale-aware Intl.Collator for sorting.
 *
 * @param catalogModules - Modules available in the catalog
 * @param installedModules - Currently installed modules
 * @returns Flat array of ModuleRows, sorted per the above rules
 */
export function mergeAndSortModules(
  catalogModules: CatalogModule[],
  installedModules: ModuleMetadata[]
): ModuleRow[] {
  // Create a map to deduplicate: key = abbreviation, value = { catalog, installed }
  const moduleMap = new Map<string, {
    catalog: CatalogModule | undefined;
    installed: ModuleMetadata | undefined;
  }>();

  // Add all catalog modules
  for (const catalogMod of catalogModules) {
    moduleMap.set(catalogMod.abbreviation, {
      catalog: catalogMod,
      installed: undefined
    });
  }

  // Add/merge all installed modules
  for (const installedMod of installedModules) {
    const existing = moduleMap.get(installedMod.abbreviation) || {
      catalog: undefined,
      installed: undefined
    };
    existing.installed = installedMod;
    moduleMap.set(installedMod.abbreviation, existing);
  }

  // Convert map to array of ModuleRows
  const rows: ModuleRow[] = [];
  moduleMap.forEach(({ catalog, installed }, abbreviation) => {
    // Determine name, type, language from whichever source is available
    const name = catalog?.name ?? installed?.name ?? abbreviation;
    const type = (catalog?.module_type ?? installed?.module_type) as ModuleType;
    const language = catalog?.language_code ?? installed?.language_code ?? '';

    // module_id: prefer installed (number) over catalog (string) for download progress lookup
    const module_id = installed?.module_id ?? catalog?.module_id ?? '';

    rows.push({
      abbreviation,
      module_type: type,
      name,
      language_code: language,
      installed: !!installed,
      updateAvailable: installed?.update_available ?? false,
      catalogModule: catalog,
      installedModule: installed,
      module_id
    });
  });

  // Sort within groups by module_type
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  rows.sort((a, b) => {
    // First, compare by module_type (maintaining MODULE_TYPES order)
    const typeIndexA = MODULE_TYPES.indexOf(a.module_type);
    const typeIndexB = MODULE_TYPES.indexOf(b.module_type);
    if (typeIndexA !== typeIndexB) {
      return typeIndexA - typeIndexB;
    }

    // Within the same type, sort by recommended (true first), then alphabetically by name
    const recommendedA = a.catalogModule?.recommended ?? false;
    const recommendedB = b.catalogModule?.recommended ?? false;

    if (recommendedA !== recommendedB) {
      return recommendedA ? -1 : 1;
    }

    // Both have same recommended status, sort alphabetically by name
    return collator.compare(a.name, b.name);
  });

  return rows;
}

/**
 * The module kinds a reader can install, each of which always has a tab.
 *
 * The set of types is fixed by the app (`MODULE_TYPES`); an unrecognised type
 * cannot be installed anyway. Showing a tab only once it held a module meant
 * that, offline on a fresh install, the dialog offered Bibles alone and gave no
 * hint that commentaries, dictionaries, books and the rest exist.
 *
 * `lexicon` and `tag_graph` are left out of this list: no catalog publishes
 * them (lexicons ship as dictionaries; tag graphs are internal), so a permanent
 * tab for each would only ever be empty. They still appear when a module of that
 * type is present.
 */
const ALWAYS_SHOWN_TYPES: ReadonlySet<ModuleType> = new Set<ModuleType>([
  'bible',
  'commentary',
  'dictionary',
  'book',
  'devotional',
  'topical_index',
  'cross_reference',
]);

/**
 * Return the list of module types to show as tabs, in `MODULE_TYPES` order
 * (Bible first): every installable kind, plus any other type that has at least
 * one catalog or installed module.
 *
 * @param catalogModules - Available catalog modules
 * @param installedModules - Currently installed modules
 */
export function getTabTypes(
  catalogModules: CatalogModule[],
  installedModules: ModuleMetadata[]
): ModuleType[] {
  const present = new Set<ModuleType>(ALWAYS_SHOWN_TYPES);
  for (const mod of catalogModules) present.add(mod.module_type);
  for (const mod of installedModules) present.add(mod.module_type);

  return MODULE_TYPES.filter(type => present.has(type));
}
