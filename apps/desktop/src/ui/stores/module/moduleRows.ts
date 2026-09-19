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
 * Return the list of module types to show as tabs.
 * Only types with >=1 catalog or installed module.
 * 'bible' is always first and always present (even if no modules exist).
 * Other types follow in MODULE_TYPES order.
 *
 * @param catalogModules - Available catalog modules
 * @param installedModules - Currently installed modules
 * @returns Array of ModuleType in the order they should appear as tabs
 */
export function getTabTypes(
  catalogModules: CatalogModule[],
  installedModules: ModuleMetadata[]
): ModuleType[] {
  // Build set of types that have at least one module
  const presentTypes = new Set<ModuleType>();

  for (const mod of catalogModules) {
    presentTypes.add(mod.module_type);
  }

  for (const mod of installedModules) {
    presentTypes.add(mod.module_type);
  }

  // Always include 'bible' even if no modules of that type exist
  presentTypes.add('bible');

  // Filter MODULE_TYPES to only those present, maintaining MODULE_TYPES order
  const result: ModuleType[] = [];
  for (const type of MODULE_TYPES) {
    if (presentTypes.has(type)) {
      result.push(type);
    }
  }

  return result;
}
