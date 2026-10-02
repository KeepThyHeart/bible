/**
 * Asset store contracts (task 0090) -> packages/core/src/assets/types.ts
 *
 * One download/cache manager for large optional assets: TTS runtimes and voices,
 * STT models, precomputed data files, offline packs. Framework-free and
 * platform-free (browser barrel): the platform supplies three ports.
 *
 *   IAssetTransport       HTTP GET with Range/If-Range, streaming body (web: fetch; desktop: NetworkGateway)
 *   IAssetStore           where file bytes live, incl. resumable partials (web: Cache Storage; desktop: userData fs)
 *   IAssetRegistryStore   one small JSON document: what is installed (web: a Cache entry; desktop: registry.json)
 *
 * `AssetManager` (AssetManager.ts) owns everything else: the queue (2 at a time),
 * resume, retries, streaming SHA-256 verification, atomic commit, the registry,
 * usage, eviction and update diffs. No DB table, nothing for the backup Registry:
 * installed assets are a re-downloadable device cache, not user data.
 *
 * Pure TypeScript, lib ES2020 (+ the AbortSignal/Blob globals core already uses).
 */

// ---------------------------------------------------------------------------
// Manifest (what can be installed)
// ---------------------------------------------------------------------------

/** Schema tag of `/assets/v1/index.json`. */
export const ASSET_INDEX_SCHEMA = 'kth-asset-index/1';

/**
 * Well-known kinds. Open-ended: a new consumer may use a new kind string.
 * The kind is part of the hosting path (`/assets/v1/<kind>/<id>/<version>/<file>`)
 * and the web store maps `tts-*` kinds to the legacy `tts-models-v1` cache.
 */
export type AssetKind =
  | 'tts-runtime'   // a speech engine's runtime (Piper: ONNX Runtime + phonemizer)
  | 'tts-voice'     // one TTS voice (0059)
  | 'stt-model'     // a speech-recognition model (0071)
  | 'data'          // a precomputed data file (0070 neighbour table, 0074 quiz data)
  | 'offline-pack'  // a bundle planned by 0075
  | (string & {});

export interface AssetFile {
  /** Relative POSIX path inside the asset (`voice.onnx`, `data/n.bin`). Never `..`, never absolute. */
  path: string;
  /** Absolute URL to GET. Parsers resolve index-relative URLs; the manager never sees a relative one. */
  url: string;
  /**
   * Exact byte length as served (no Content-Encoding). Parsers require > 0.
   * 0 means "unknown" and is allowed only in in-app `allowUnverified` manifests (legacy
   * Piper fallback): the size checks then use Content-Length, and the registry records
   * the bytes actually received.
   */
  size: number;
  /**
   * Lowercase hex SHA-256 of the bytes as served. Required in `/assets/v1/index.json`.
   * Absent only in manifests an app synthesises itself (Piper from site config): the
   * manager then fetches the `<url>.sha256` sidecar (see design.md "Sidecars").
   */
  sha256?: string;
  /** Stored as `Content-Type` by the web store (SW range slicing, blob URLs). Default application/octet-stream. */
  contentType?: string;
}

export interface AssetManifest {
  /** Globally unique, `[a-z0-9][a-z0-9._-]{0,99}` (case-insensitive): `en_US-amy-medium`, `piper-runtime`. */
  id: string;
  kind: AssetKind;
  /** Opaque version label, `[A-Za-z0-9._-]{1,40}`. Ordering: `compareAssetVersions` (numeric-aware). */
  version: string;
  /** Display name (untranslated; apps may map by id). */
  title: string;
  description?: string;
  /** SPDX id or short licence name, shown in the list. */
  license: string;
  licenseUrl?: string;
  /** BCP-47 tags the asset serves, when language-specific. */
  languages?: string[];
  /** Sum of `files[].size`; parsers recompute and reject a mismatch. */
  size: number;
  files: AssetFile[];
  /** Free-form, consumer-specific (e.g. model parameters). Never interpreted by the manager. */
  meta?: Record<string, unknown>;
  /**
   * In-app manifests only (parsers ALWAYS drop it from network input): install even
   * when neither `sha256` nor a sidecar is available. Recorded as `verified: false`.
   * Exists so Piper voices of deployments without sidecars keep working.
   */
  allowUnverified?: boolean;
}

/** `/assets/v1/index.json`; `files[].url` there is relative to the index URL. */
export interface AssetIndex {
  schema: typeof ASSET_INDEX_SCHEMA;
  generatedAt?: string;
  assets: AssetManifest[];
}

// ---------------------------------------------------------------------------
// Registry (what is installed) - persisted as one JSON document
// ---------------------------------------------------------------------------

export const ASSET_REGISTRY_SCHEMA = 'kth-asset-registry/1';

export interface InstalledAsset {
  id: string;
  kind: AssetKind;
  version: string;
  title: string;
  license: string;
  size: number;
  /** Paths, urls, sizes and the digests actually verified (sha256 always set here, '' when unverified). */
  files: Array<Required<Pick<AssetFile, 'path' | 'url' | 'size' | 'sha256'>>>;
  /** False only for `allowUnverified` installs that had no digest. */
  verified: boolean;
  /** Installed by an explicit user action: never evicted automatically. */
  pinned: boolean;
  installedAt: number;
  lastUsedAt: number;
  meta?: Record<string, unknown>;
}

export interface AssetRegistrySnapshot {
  schema: typeof ASSET_REGISTRY_SCHEMA;
  assets: InstalledAsset[];
}

export interface IAssetRegistryStore {
  /** null: nothing stored yet, or unreadable (the manager starts empty and logs). */
  load(): Promise<AssetRegistrySnapshot | null>;
  /** Replace the whole document atomically (desktop: tmp + rename; web: one cache.put). */
  save(snapshot: AssetRegistrySnapshot): Promise<void>;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export interface TransportRequest {
  url: string;
  /** Resume: ask for `bytes=<start>-`. */
  rangeStart?: number;
  /** Sent as `If-Range` with `rangeStart`: a changed entity answers 200 (full) instead of 206. */
  ifRange?: string;
  signal: AbortSignal;
}

export interface TransportResponse {
  /** 200, 206, 304, 404, 416, 5xx ... Redirects are followed by the transport. */
  status: number;
  /** Lower-cased header subset. `contentRange` is the raw `Content-Range` value. */
  headers: { contentLength?: number; contentRange?: string; etag?: string; lastModified?: string; contentType?: string };
  /** The body. Must end (return) or throw; aborting `signal` must make it throw an `aborted` AssetError. */
  body: AsyncIterable<Uint8Array>;
}

export interface IAssetTransport {
  /**
   * Throws AssetError: `offline` (desktop switch off / navigator offline), `network`
   * (connection, DNS, TLS, stalled), `aborted`. Any HTTP status is RETURNED, not thrown.
   */
  get(req: TransportRequest): Promise<TransportResponse>;
  /** Small text GET for `.sha256` sidecars and index.json; null on 404. Same errors as `get`. */
  getText(url: string, signal: AbortSignal): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/** Everything a store needs to address one file. Web keys by `url`; desktop by kind/assetId/version/path. */
export interface AssetFileRef {
  assetId: string;
  kind: AssetKind;
  version: string;
  path: string;
  url: string;
  size: number;
  contentType?: string;
}

/** An in-progress download of one file. Survives reloads/restarts until committed or discarded. */
export interface IPartialFile {
  /** Bytes already held (after the last `append`). */
  readonly size: number;
  /** ETag (or Last-Modified) of the response the bytes came from; null when unknown. */
  readonly validator: string | null;
  /** The bytes held, in order, for re-hashing before a resume. */
  read(): AsyncIterable<Uint8Array>;
  append(chunk: Uint8Array): Promise<void>;
  /** Drop all bytes (restart from 0) and remember the new response's validator. */
  reset(validator: string | null): Promise<void>;
  /** Persist buffered bytes; keep them for a later resume. Idempotent. */
  close(): Promise<void>;
  /** Atomically make the bytes the committed file for this ref (replacing any old one). Ends the partial. */
  commit(): Promise<void>;
  /** Delete the partial. Idempotent. */
  discard(): Promise<void>;
}

export interface IAssetStore {
  /** A committed file exists for `ref`. */
  exists(ref: AssetFileRef): Promise<boolean>;
  /** Committed bytes, streamed; null when absent. */
  read(ref: AssetFileRef): Promise<AsyncIterable<Uint8Array> | null>;
  /** Open (creating if needed) the partial for `ref`. One open partial per ref at a time (the manager guarantees it). */
  openPartial(ref: AssetFileRef): Promise<IPartialFile>;
  /** Delete committed files and partials of these refs. Missing ones are ignored. */
  delete(refs: AssetFileRef[]): Promise<void>;
  /** Delete partials not touched for `olderThanMs`. Called by `init()`. */
  sweepPartials(olderThanMs: number): Promise<void>;
  /** Free bytes available to this store, or null when unknown (quota estimate / statfs). */
  freeBytes?(): Promise<number | null>;
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/** Incremental hasher. Default: the pure-TS `Sha256` (sha256.ts); desktop may inject node:crypto. */
export interface IHasher {
  update(chunk: Uint8Array): void;
  /** Lowercase hex; the hasher is finished afterwards. */
  digestHex(): string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type AssetErrorCode =
  | 'offline'            // network switched off / no connectivity; not retried
  | 'network'            // connection failed, reset or stalled; retried
  | 'http'               // unexpected status (5xx, 408, 429 are retried; other 4xx not)
  | 'not-found'          // 404/410 for a file or for the asset id
  | 'integrity'          // SHA-256 mismatch; partial discarded, never resumed
  | 'size-mismatch'      // more bytes than declared, or fewer at end; partial discarded
  | 'unverifiable'       // no sha256 and no sidecar, and !allowUnverified
  | 'quota'              // storage full after an eviction attempt
  | 'storage'            // any other store failure (I/O, Cache API)
  | 'invalid-manifest'   // parser or manager rejected a manifest
  | 'busy'               // another version of the same id is installing
  | 'aborted';           // cancelled; never shown to the user

export class AssetError extends Error {
  readonly name = 'AssetError';
  constructor(
    readonly code: AssetErrorCode,
    message: string,
    /** True when retrying the same request may succeed. */
    readonly retryable: boolean = false,
    /** HTTP status, when there was one. */
    readonly status?: number,
  ) {
    super(message);
  }
}

export function isAssetError(e: unknown): e is AssetError {
  return !!e && typeof e === 'object' && (e as { name?: unknown }).name === 'AssetError' && typeof (e as { code?: unknown }).code === 'string';
}

// ---------------------------------------------------------------------------
// Progress, list state and events
// ---------------------------------------------------------------------------

export type AssetJobPhase = 'queued' | 'downloading' | 'verifying' | 'committing';

export interface AssetProgress {
  id: string;
  version: string;
  phase: AssetJobPhase;
  /** Bytes of the whole asset held so far (resumed bytes included). */
  loaded: number;
  /** `manifest.size`. */
  total: number;
  /** 1-based file being worked on, and the file count. */
  file: number;
  files: number;
  /** Retry attempt of the current file, 0 on the first try. */
  attempt: number;
}

export type AssetStatus = 'available' | 'queued' | 'downloading' | 'installed' | 'update-available' | 'error';

/** One row of the "Downloads & storage" list: the join of catalog, registry and jobs. */
export interface AssetEntry {
  id: string;
  kind: AssetKind;
  title: string;
  license: string;
  status: AssetStatus;
  /** Catalog version, else installed. */
  version: string;
  /** Installed version, when installed. */
  installedVersion?: string;
  /** Download size of the catalog version (else installed size). */
  size: number;
  /** Bytes on device (installed size), 0 when not installed. */
  storedBytes: number;
  pinned: boolean;
  verified: boolean;
  progress?: AssetProgress;
  /** The last failure of this id since the manager started; cleared by a new install. */
  error?: { code: AssetErrorCode; message: string };
}

export interface AssetListSnapshot {
  /** Sorted by kind, then title. Same object identity until something changes (useSyncExternalStore). */
  entries: readonly AssetEntry[];
  /** Sum of installed sizes. */
  storedBytes: number;
  /** Jobs queued or running. */
  active: number;
}

export interface AssetUpdate {
  id: string;
  from: string;
  to: string;
  /** Download size of the new version. */
  size: number;
}

export interface EvictionResult {
  removed: string[];
  freedBytes: number;
}

// ---------------------------------------------------------------------------
// AssetManager construction and public API
// ---------------------------------------------------------------------------

export interface AssetManagerDeps {
  transport: IAssetTransport;
  store: IAssetStore;
  registry: IAssetRegistryStore;
  /** Default: `() => new Sha256()`. */
  createHasher?: () => IHasher;
  /** Max jobs downloading at once. Default 2. */
  maxConcurrent?: number;
  /** Retries per file for retryable failures. Default 3 (so up to 4 attempts). */
  maxRetries?: number;
  /** Backoff before retry n (1-based). Default [1000, 4000, 10000] ms, last value repeats. */
  retryDelaysMs?: number[];
  /** No body bytes for this long aborts the attempt as `network` (retryable). Default 30000. */
  stallTimeoutMs?: number;
  /** Soft cap on installed bytes; unpinned assets are evicted to make room. Default: none. */
  budgetBytes?: number;
  /** Test seams. */
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  log?: (message: string, detail?: unknown) => void;
}

export interface InstallOptions {
  /** Aborting detaches THIS caller; the job stops when no caller is left (partial kept for resume). */
  signal?: AbortSignal;
  onProgress?: (p: AssetProgress) => void;
  /** Explicit user install: never auto-evicted. Default false. A pinned install pins an already-installed entry. */
  pinned?: boolean;
}

/**
 * Public surface of `AssetManager` (the class in AssetManager.ts implements this).
 * All methods are safe to call before `init()` resolves only where noted.
 */
export interface IAssetManager {
  /** Load the registry, drop entries whose files are gone, sweep partials older than 7 days. Call once. */
  init(): Promise<void>;
  /**
   * Replace the catalog (what is offered). Sources are merged by the app:
   * web = index.json + Piper manifests; desktop = catalogs' `assets` + dev index.
   * Safe before init.
   */
  setCatalog(manifests: readonly AssetManifest[]): void;
  /** The list state; stable identity until a change. Safe before init (empty). */
  getSnapshot(): AssetListSnapshot;
  /** Called after every snapshot change (progress is throttled to ~10/s). Returns unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Installed record, or undefined. */
  installed(id: string): InstalledAsset | undefined;
  /**
   * Install (or join the in-flight install of) this manifest, or of the catalog entry `id`.
   * Resolves when downloaded, verified, committed and registered. Already installed at this
   * version: resolves immediately (and pins when `pinned`). Rejects with AssetError.
   */
  install(target: AssetManifest | string, opts?: InstallOptions): Promise<InstalledAsset>;
  /**
   * Register an asset whose files are ALREADY in the store (legacy caches, crash between
   * commit and registry save): hashes them, no network. Resolves false if any file is missing
   * or does not verify (those files are then deleted).
   */
  adopt(manifest: AssetManifest): Promise<boolean>;
  /** Abort the job for `id` for every caller; partial bytes are kept for resume. No-op when idle. */
  cancel(id: string): void;
  /** Cancel any job, delete files and partials, drop from the registry. No-op when absent. */
  remove(id: string): Promise<void>;
  /** Consumer read of one committed file (marks the asset used). Rejects `not-found` when absent. */
  readFile(id: string, path: string): Promise<Uint8Array>;
  /** Record a use for LRU eviction (debounced registry save). */
  markUsed(id: string): void;
  /** Evict unpinned, idle assets, least recently used first, until `needBytes` are freed. `protect` ids are skipped. */
  evict(needBytes: number, protect?: readonly string[]): Promise<EvictionResult>;
  /** Installed assets whose catalog entry has a different (newer or re-published) version. */
  diffForUpdate(): AssetUpdate[];
}
