/**
 * Feature flags: one typed `isEnabled('audio')` on the web server and in both apps.
 *
 * Resolution order for a flag:
 *   1. local dev override (`overrides`), when the host supplies one
 *   2. the site value (`site`, the `features` object of the site config)
 *   3. the flag's declared default
 * then `requires` (other flags that must also be on, e.g. genealogy needs tagGraph).
 *
 * Adding a flag: one entry in `FEATURE_FLAGS` below (name, default, description).
 * `FeatureFlagName` is derived from it, so a misspelt name fails to compile.
 *
 * Overrides are dev-only by design: hosts pass `parseFlagOverrides(...)` only in
 * development (Vite `DEV`, server `NODE_ENV !== 'production'`), never in production.
 *
 * Lazy loading: `lazyFeature(flags, name, loader)` is the helper behind the
 * `initAudio.ts` pattern: the feature's module is imported only when its flag is on,
 * at most once, and callers get `null` while it is off.
 */

export interface FeatureFlagDef {
  /** Value when neither override nor site config says anything. */
  default: boolean;
  description: string;
  /** Flags that must also be enabled for this one to count as on. */
  requires?: readonly string[];
}

/**
 * Every flag the product knows. `audio`, `timeline` and `genealogy` are declared here
 * ahead of their branches (0059, 0066, 0067) so those features can call
 * `isEnabled(...)` as soon as they merge.
 */
export const FEATURE_FLAGS = {
  tagGraph: { default: false, description: 'Tag graph (entities) visualization.' },
  semanticSearch: { default: false, description: 'Semantic (Ideas) search. Needs a search pipeline config.' },
  pwa: { default: true, description: 'PWA: manifest and service worker.' },
  offlineDownloads: { default: false, description: 'Let users mark modules for offline use.' },
  offlineAutoDownload: { default: true, description: 'Cache a lite copy of a translation on first read.' },
  audio: { default: false, description: 'Audio Bible playback and Settings > Audio.' },
  timeline: { default: false, description: 'Timeline view.' },
  genealogy: { default: false, description: 'Genealogy view.', requires: ['tagGraph'] },
} as const satisfies Record<string, FeatureFlagDef>;

export type FeatureFlagName = keyof typeof FEATURE_FLAGS;

export const FEATURE_FLAG_NAMES = Object.keys(FEATURE_FLAGS) as FeatureFlagName[];

export function isKnownFeatureFlag(name: string): name is FeatureFlagName {
  return Object.prototype.hasOwnProperty.call(FEATURE_FLAGS, name);
}

/** A (possibly partial) map of flag name to boolean, as found in config or an override. */
export type FlagValues = Partial<Record<string, unknown>>;

export interface FeatureFlagSources {
  /** Site config `features` object (or a getter, when it can change or loads late). */
  site?: FlagValues | (() => FlagValues | undefined);
  /** Dev override (or a getter). Booleans only; anything else is ignored. */
  overrides?: FlagValues | (() => FlagValues | undefined);
}

export interface FeatureFlags {
  isEnabled(name: FeatureFlagName): boolean;
  /** Every known flag, resolved. */
  all(): Record<FeatureFlagName, boolean>;
}

export function createFeatureFlags(sources: FeatureFlagSources = {}): FeatureFlags {
  const read = (source: FlagValues | (() => FlagValues | undefined) | undefined): FlagValues => {
    const value = typeof source === 'function' ? source() : source;
    return value && typeof value === 'object' ? value : {};
  };

  const resolve = (name: FeatureFlagName, seen: readonly string[]): boolean => {
    if (seen.includes(name)) return false; // a requires cycle is off, not an infinite loop
    const def: FeatureFlagDef = FEATURE_FLAGS[name];
    const override = read(sources.overrides)[name];
    const site = read(sources.site)[name];
    const own =
      typeof override === 'boolean' ? override : typeof site === 'boolean' ? site : def.default;
    if (!own) return false;
    return (def.requires ?? []).every(
      (req) => isKnownFeatureFlag(req) && resolve(req, [...seen, name]),
    );
  };

  return {
    isEnabled: (name) => resolve(name, []),
    all: () => {
      const out = {} as Record<FeatureFlagName, boolean>;
      for (const name of FEATURE_FLAG_NAMES) out[name] = resolve(name, []);
      return out;
    },
  };
}

/**
 * Parse a dev override string: comma or space separated names, `-name` (or `!name`)
 * turns one off. `"audio,-pwa"` gives `{ audio: true, pwa: false }`. Also accepts a JSON
 * object (`{"audio":true}`). Unknown names are dropped.
 */
export function parseFlagOverrides(input: string | null | undefined): Partial<Record<FeatureFlagName, boolean>> {
  const out: Partial<Record<FeatureFlagName, boolean>> = {};
  const text = (input ?? '').trim();
  if (!text) return out;
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      for (const [name, value] of Object.entries(parsed)) {
        if (isKnownFeatureFlag(name) && typeof value === 'boolean') out[name] = value;
      }
    } catch {
      // ignore malformed JSON
    }
    return out;
  }
  for (const token of text.split(/[\s,]+/)) {
    if (!token) continue;
    const off = token.startsWith('-') || token.startsWith('!');
    const name = off ? token.slice(1) : token;
    if (isKnownFeatureFlag(name)) out[name] = !off;
  }
  return out;
}

/**
 * Load a feature's module only when its flag is on, once. Returns `null` (without
 * calling `loader`) while the flag is off, so callers can write
 * `const audio = await loadAudio(); audio?.init()`.
 */
export function lazyFeature<T>(
  flags: Pick<FeatureFlags, 'isEnabled'>,
  name: FeatureFlagName,
  loader: () => Promise<T>,
): () => Promise<T | null> {
  let pending: Promise<T> | null = null;
  return async () => {
    if (!flags.isEnabled(name)) return null;
    if (!pending) {
      pending = loader();
      // A failed load may be retried on the next call.
      pending.catch(() => {
        pending = null;
      });
    }
    return pending;
  };
}
