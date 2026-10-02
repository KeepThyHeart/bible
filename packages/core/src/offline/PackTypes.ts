/**
 * Offline pack contracts (task 0075) -> packages/core/src/offline/PackTypes.ts
 *
 * A pack is what the user asked for (a list of item refs); a plan is what that
 * means on this device right now (steps in dependency order, sizes, fit).
 * The download/verify/cache core lives in `assets` (task 0090); this module only
 * decides WHAT to fetch and in which order, and runs the steps through per-kind
 * `IPackInstaller`s supplied by each app.
 *
 * Pure TypeScript, platform-free (browser barrel).
 *
 * Personal content rule: the web app never persists pack specs until accounts
 * exist. `IPackSpecStore` is the stand-in for the user-data layer (task 0084).
 */

/** Reserved for later: 'audio' | 'feature' | 'user-data'. */
export type PackItemKind = 'module' | 'asset';

export type PackItemRef =
  | { kind: 'module'; id: string } // web: server abbreviation key; desktop: catalog module_id
  | { kind: 'asset'; id: string }; // an AssetManager catalog id (tts-voice, data, ...)

/** Stable, case-insensitive key of a ref, e.g. `module:kjv`. */
export const packKey = (r: PackItemRef): string => `${r.kind}:${r.id.toLowerCase()}`;

export interface OfflinePackSpec {
  packId: string;
  name: string;
  items: PackItemRef[];
  fromPreset?: { id: string; version?: string };
  updatedAt: string;
}

export type PackGroup = 'bible' | 'commentary' | 'dictionary' | 'crossref' | 'topical' | 'other' | 'speech' | 'data';

export interface PackOffer {
  ref: PackItemRef;
  /** `packKey(ref)`. */
  key: string;
  title: string;
  group: PackGroup;
  language?: string;
  version: string;
  downloadBytes: number;
  storedBytes: number;
  /** Desktop requires_module; a Piper voice requires piper-runtime. */
  requires?: PackItemRef[];
  /** Web: false for non-Bible modules until the module worker exists. */
  offlineReadable: boolean;
  status: 'absent' | 'installed' | 'update-available' | 'installing';
  installedVersion?: string;
  installedStoredBytes?: number;
  /** Desktop catalog scoping (never shadow official ids). */
  catalogId?: number;
}

export interface PackPreset {
  id: string;
  name: string;
  description?: string;
  version?: string;
  items: PackItemRef[];
}

export interface IPackSource {
  listOffers(signal?: AbortSignal): Promise<PackOffer[]>;
  listPresets(): Promise<PackPreset[]>;
  /** Free bytes for downloads, or null when unknown. */
  freeBytes(): Promise<number | null>;
}

/** STAND-IN for the user-data pack specs of task 0084. Web must not back it with browser storage. */
export interface IPackSpecStore {
  list(): Promise<OfflinePackSpec[]>;
  save(s: OfflinePackSpec): Promise<void>;
  remove(id: string): Promise<void>;
}

export type PlanWarning =
  | { code: 'unavailable'; key: string }
  | { code: 'not-readable-offline'; key: string }
  | { code: 'dependency-added'; key: string; for: string }
  | { code: 'missing-dependency'; key: string; requires: string }
  | { code: 'cycle'; keys: string[] }
  | { code: 'over-quota'; shortfallBytes: number }
  | { code: 'quota-unknown' };

export interface PackPlanStep {
  key: string;
  offer: PackOffer;
  action: 'install' | 'update';
  /** Keys of steps that must succeed first. */
  after: string[];
}

export interface PackPlan {
  steps: PackPlanStep[];
  /** Keys already installed at the offered version (no step). */
  present: string[];
  /** Keys dropped (unavailable). */
  skipped: string[];
  downloadBytes: number;
  newStoredBytes: number;
  /** Worst-case bytes needed at once (old copies during updates, in-flight partials). */
  peakBytes: number;
  fit: 'fits' | 'tight' | 'no' | 'unknown';
  shortfallBytes: number;
  warnings: PlanWarning[];
}

/** One per item kind, supplied by the app. Must reject with AssetError('aborted') when `signal` aborts. */
export interface IPackInstaller {
  install(step: PackPlanStep, ctx: { signal: AbortSignal; onBytes(loaded: number, total: number): void }): Promise<void>;
}

export type PackRunState = 'idle' | 'running' | 'done' | 'partial' | 'failed' | 'cancelled';

export interface PackRunSnapshot {
  state: PackRunState;
  /** Step counts. */
  total: number;
  done: number;
  failed: number;
  skipped: number;
  loadedBytes: number;
  totalBytes: number;
  active: { key: string; loaded: number; total: number }[];
  errors: { key: string; code: string; message: string }[];
}
