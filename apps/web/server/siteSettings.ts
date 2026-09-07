import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';

// ─── Types ───────────────────────────────────────────────────────────────

export interface ModuleEntry {
  active: boolean;
  shortName?: string;
  title?: string;
  description?: string;
  sortOrder?: number;
}

export interface ModuleSection {
  title: string;
  helpText?: string;
  modules: string[];
}

export interface ModuleTypeConfig {
  modules: Record<string, ModuleEntry>;
  sections: ModuleSection[];
}

export interface SiteSettings {
  about?: string;
  bibles?: ModuleTypeConfig;
  commentaries?: ModuleTypeConfig;
  dictionaries?: ModuleTypeConfig;
}

// ─── Loader ──────────────────────────────────────────────────────────────

/**
 * Load settings.json from the data directory.
 * Returns null if the file doesn't exist (fail-safe: no modules visible).
 *
 * @deprecated Prefer using SiteConfig which loads the unified site-config.json
 * and falls back to this loader for legacy compatibility. This function is
 * called internally by SiteConfig and should not be used directly.
 */
export function loadSiteSettings(dataDir: string): SiteSettings | null {
  const settingsPath = resolve(dataDir, 'settings.json');
  if (!existsSync(settingsPath)) {
    console.warn('[Server] No settings.json found — no modules will be visible (fail-safe).');
    return null;
  }
  try {
    const raw = readFileSync(settingsPath, 'utf-8');
    return JSON.parse(raw) as SiteSettings;
  } catch (err: any) {
    console.error(`[Server] Failed to load settings.json: ${err.message}`);
    return null;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Map module type strings to the settings key. Returns null for types not managed by settings. */
export function getSettingsKey(moduleType: string): keyof Pick<SiteSettings, 'bibles' | 'commentaries' | 'dictionaries'> | null {
  switch (moduleType) {
    case 'bible': return 'bibles';
    case 'commentary': return 'commentaries';
    case 'dictionary': return 'dictionaries';
    default: return null;
  }
}

/** Check if a module is active in settings (case-insensitive abbreviation lookup). */
export function isModuleActive(config: ModuleTypeConfig | undefined, abbreviation: string): boolean {
  if (!config) return false;
  // Case-insensitive lookup
  const key = Object.keys(config.modules).find(k => k.toLowerCase() === abbreviation.toLowerCase());
  if (!key) return false;
  return config.modules[key].active;
}

/** Get module entry from config (case-insensitive). */
export function getModuleEntry(config: ModuleTypeConfig | undefined, abbreviation: string): ModuleEntry | undefined {
  if (!config) return undefined;
  const key = Object.keys(config.modules).find(k => k.toLowerCase() === abbreviation.toLowerCase());
  return key ? config.modules[key] : undefined;
}

/** Build sort order map from a module type config. Only includes modules with explicit sortOrder. */
export function buildSortOrders(config: ModuleTypeConfig | undefined): Record<string, number> {
  if (!config) return {};
  const result: Record<string, number> = {};
  for (const [abbr, entry] of Object.entries(config.modules)) {
    if (typeof entry.sortOrder === 'number') {
      result[abbr] = entry.sortOrder;
    }
  }
  return result;
}

/** Build description overrides from a module type config. */
export function buildDescriptions(config: ModuleTypeConfig | undefined): Record<string, { title?: string; description?: string }> {
  if (!config) return {};
  const result: Record<string, { title?: string; description?: string }> = {};
  for (const [abbr, entry] of Object.entries(config.modules)) {
    if (entry.title || entry.description) {
      result[abbr] = {};
      if (entry.title) result[abbr].title = entry.title;
      if (entry.description) result[abbr].description = entry.description;
    }
  }
  return result;
}
