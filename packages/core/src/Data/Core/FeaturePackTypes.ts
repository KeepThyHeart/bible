/**
 * Feature packs - optional, downloadable *capabilities* rather than content.
 *
 * ## Why this is not a `ModuleType`
 *
 * `Types.ts` states the rule explicitly: `semantic_*.db` and `enrichments_*.db`
 * are "app-private caches that sit outside the published module contract - they
 * carry no `module_info`, are never registered in `module_metadata`, and must
 * not be validated as modules." A feature pack is the delivery vehicle for
 * exactly those artifacts, so it gets its own catalog section, its own install
 * path, and its own validator. Nothing here flows through
 * `InstallationService`, whose versification gate is meaningless for an
 * embedding model and would reject every pack outright.
 *
 * ## What a pack is
 *
 * A pack is a flat list of artifacts, each with its own URL and SHA-256. There
 * is no archive format: an embedding model is a handful of files (config,
 * tokenizer, ONNX weights) and the index is a single database, so per-file
 * download keeps resume/verification granular and adds no dependency. The
 * price is one request per file, which is nothing next to a multi-hundred-MB
 * payload.
 *
 * ## Trust model
 *
 * Everything in a catalog is attacker-controlled input until proven otherwise.
 * `parseFeaturePack` is the only way this data should enter the app. It is
 * fail-closed: an unrecognised `pack_type`, a bad digest format, or a path that
 * could escape the pack directory rejects the whole pack rather than the one
 * bad artifact - a partially-installed capability is worse than an absent one.
 *
 * The digest proves the bytes match what the catalog *said*; it says nothing
 * about whether the catalog should be believed. Provenance is a separate
 * question, decided by which repositories the user has enabled.
 */

/** Pack kinds the app knows how to install. Unknown kinds are rejected. */
export const FEATURE_PACK_TYPES = ['semantic_search'] as const;

export type FeaturePackType = (typeof FEATURE_PACK_TYPES)[number];

/**
 * Role of a single file within a pack.
 *
 * - `index`  - a prebuilt SQLite database (the semantic embedding index).
 * - `model`  - one file of the embedding model tree, laid out exactly as
 *              `@huggingface/transformers` expects to find it under its
 *              `localModelPath` (e.g. `Xenova/nomic-embed-text-v1/config.json`).
 */
export const FEATURE_PACK_ARTIFACT_KINDS = ['index', 'model'] as const;

export type FeaturePackArtifactKind = (typeof FEATURE_PACK_ARTIFACT_KINDS)[number];

export interface FeaturePackArtifact {
  kind: FeaturePackArtifactKind;
  /**
   * Install location, relative to the pack root. Validated to be a genuinely
   * relative POSIX path that cannot escape the root - see `isSafeArtifactPath`.
   */
  path: string;
  download_url: string;
  /** Size of the file as served (i.e. compressed size when `gzipped`). */
  download_size_bytes: number;
  /** Lowercase hex SHA-256 of the bytes as served, before any decompression. */
  sha256: string;
  /** When true the payload is gzip-encoded and is gunzipped after verification. */
  gzipped?: boolean;
}

export interface FeaturePack {
  pack_id: string;
  pack_type: FeaturePackType;
  name: string;
  version: string;
  description: string;
  license: string;
  license_url?: string | null;
  download_size_bytes: number;
  installed_size_bytes: number;
  artifacts: FeaturePackArtifact[];
  /**
   * Free-form pack-specific fields. For `semantic_search` this is where the
   * embedding model id and index build parameters are recorded, so a future
   * version can tell an index apart from the model that must query it.
   */
  metadata?: Record<string, unknown> | null;
}

// --- Sideloaded packages ---------------------------------------------------

/**
 * Format tag every package manifest must carry.
 *
 * Versioned in the value rather than a separate field so that a future,
 * incompatible layout simply fails to match - an old build will refuse a new
 * package outright instead of installing part of it.
 */
export const FEATURE_PACK_FILE_FORMAT = 'bible-feature-pack@1';

/** Name of the manifest at the root of a package folder or archive. */
export const FEATURE_PACK_MANIFEST_FILENAME = 'feature-pack.json';

export interface LocalFeaturePackArtifact {
  kind: FeaturePackArtifactKind;
  /** Install location relative to the pack root. Same rules as `FeaturePackArtifact.path`. */
  path: string;
  /** Size of the file as it sits in the package (compressed when `gzipped`). */
  size_bytes: number;
  /** Lowercase hex SHA-256 of the packaged bytes, before any decompression. */
  sha256: string;
  gzipped?: boolean;
}

/**
 * A pack delivered as a file or folder rather than fetched from a catalog.
 *
 * Deliberately not a `FeaturePack` with the URLs made optional: a type whose
 * `download_url` is sometimes absent invites a caller to fetch `undefined`, and
 * the install paths for the two are genuinely different code. Keeping them
 * separate makes "this pack came from the user, not from a catalog" a fact the
 * type system carries rather than a comment.
 */
export interface LocalFeaturePack {
  format: typeof FEATURE_PACK_FILE_FORMAT;
  pack_id: string;
  pack_type: FeaturePackType;
  name: string;
  version: string;
  description: string;
  license: string;
  license_url?: string | null;
  installed_size_bytes: number;
  artifacts: LocalFeaturePackArtifact[];
  metadata?: Record<string, unknown> | null;
}

export type LocalFeaturePackParseResult =
  | { ok: true; pack: LocalFeaturePack }
  | { ok: false; errors: string[] };

/**
 * Name a packaged artifact carries inside the package.
 *
 * Derived from the install path rather than declared separately, so a package
 * cannot name one file and install it as another - and so there is only one
 * path per artifact for `isSafeArtifactPath` to have to vet.
 */
export function packagedFileName(artifact: { path: string; gzipped?: boolean }): string {
  return artifact.gzipped ? `${artifact.path}.gz` : artifact.path;
}

/** Hard ceilings. Declared sizes beyond these are refused before any egress. */
export const MAX_FEATURE_PACK_ARTIFACTS = 64;
/** No single artifact may claim more than this. */
export const MAX_FEATURE_PACK_ARTIFACT_BYTES = 4 * 1024 * 1024 * 1024;
/** Nor may a pack in total. */
export const MAX_FEATURE_PACK_TOTAL_BYTES = 8 * 1024 * 1024 * 1024;
/** Longest permitted artifact path, to stay clear of Windows path limits. */
export const MAX_ARTIFACT_PATH_LENGTH = 180;

/**
 * File extensions a pack is allowed to contain. **A PACK MAY CARRY DATA; IT MAY
 * NEVER CARRY CODE.**
 *
 * This is the invariant that keeps packs from becoming a second software
 * distribution channel. Everything executable - the ONNX runtime, the
 * transformers layer, the search logic - ships inside the signed, attested
 * installer and nowhere else (see `docs/ReleaseVerification.md`). A pack is
 * bounded *input* to code the user already has. If a `.dll`, `.so` or `.node`
 * could arrive inside a downloaded pack, then code signing, build provenance
 * and the renderer sandbox would all be reasoning about a binary that is no
 * longer the whole program, and the pack download would become the softest way
 * in.
 *
 * ALLOWLIST, NOT A DENYLIST - deliberately, and for the same reason the
 * `data/` entry in `electron-builder*.yml` is an allowlist. A denylist of
 * dangerous extensions fails OPEN: it has to anticipate `.dylib`, versioned
 * `.so.1.27.0`, `.wasm`, `.pyc`, `.jar`, `.scr`, and whatever the next loader
 * format turns out to be. Enumerating what a semantic pack legitimately needs
 * is a short, checkable list that fails CLOSED on everything else.
 *
 *   .db    the embedding index (SQLite)
 *   .onnx  the model graph
 *   .json  config.json / tokenizer.json / tokenizer_config.json / ...
 *   .txt   vocab files, and model LICENSE.txt
 *   .md    model licence / model card
 *
 * Note what is NOT here: `.bin` and `.pt`/`.pth`/`.pkl`/`.ckpt`. Those are the
 * PyTorch/pickle formats, which execute arbitrary code *by design* on load.
 * This app only ever loads ONNX. Extensionless files are also rejected - on
 * Linux an executable commonly has no extension at all.
 *
 * Shared by the installer (which enforces it before a byte is fetched) and the
 * pack build script (which refuses to produce a pack the installer would
 * reject), so the two cannot drift apart.
 *
 * Adding an entry here widens what a hostile or compromised catalog can put on
 * a user's disk. Do not add one without saying, in the commit message, what
 * loads that file type and why it cannot execute.
 */
export const FEATURE_PACK_ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
  '.db',
  '.onnx',
  '.json',
  '.txt',
  '.md',
]);

const PACK_ID_RE = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const SHA256_RE = /^[0-9a-f]{64}$/i;
const PATH_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Windows treats these as device names in *any* directory and with any
 * extension, so `models/con.json` is not a file you can create. Rejecting them
 * turns a confusing mid-install failure into a clean catalog rejection.
 */
const WINDOWS_RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

/**
 * Is `candidate` safe to join onto the pack root?
 *
 * This is the single most security-relevant function in the feature-pack path:
 * it is what stands between a catalog entry and an arbitrary file write. It is
 * an allowlist by construction - each segment must match `PATH_SEGMENT_RE` -
 * rather than a blocklist of known-bad sequences, because the blocklist form of
 * this check is exactly the one that keeps getting bypassed (`....//`, UTF-8
 * overlong encodings, backslash-vs-slash on Windows, NTFS alternate data
 * streams).
 *
 * Rejects: absolute paths, drive letters, UNC prefixes, backslashes, `.`/`..`
 * segments, empty segments, leading/trailing separators, control characters,
 * colons, trailing dots or spaces, and Windows reserved device names.
 */
export function isSafeArtifactPath(candidate: string): boolean {
  if (typeof candidate !== 'string') return false;
  if (candidate.length === 0 || candidate.length > MAX_ARTIFACT_PATH_LENGTH) return false;

  // Any backslash is treated as a separator by Windows, so a path containing
  // one is not the path it appears to be. Refuse rather than normalise.
  if (candidate.includes('\\')) return false;
  // A colon is both the drive separator and the NTFS alternate-data-stream
  // marker (`file.txt:hidden`). Neither belongs in a relative artifact path.
  if (candidate.includes(':')) return false;
  if (candidate.startsWith('/')) return false;
  if (candidate.endsWith('/')) return false;

  // Control characters and DEL: never legitimate in a filename, and a NUL in
  // particular can truncate the path inside a native fs call.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(candidate)) return false;

  const segments = candidate.split('/');
  for (const segment of segments) {
    if (segment.length === 0) return false;           // '' from '//' or leading '/'
    if (segment === '.' || segment === '..') return false;
    if (segment.length > 255) return false;
    if (!PATH_SEGMENT_RE.test(segment)) return false;
    // Windows silently strips these, so `foo.` and `foo` collide on disk.
    if (segment.endsWith('.') || segment.endsWith(' ')) return false;

    const stem = segment.split('.')[0].toLowerCase();
    if (WINDOWS_RESERVED_NAMES.has(stem)) return false;
  }

  return true;
}

export type FeaturePackParseResult =
  | { ok: true; pack: FeaturePack }
  | { ok: false; errors: string[] };

// --- Shared parser ---------------------------------------------------------

/**
 * The two ways a pack can reach the app.
 *
 * - `catalog` - advertised over the network; every artifact carries a URL and
 *   the transferred size is what the catalog declares.
 * - `package` - a local file or folder the user chose themselves; the bytes are
 *   already on the machine, so there are no URLs, and the manifest carries a
 *   `format` tag so an unrelated `feature-pack.json` cannot be mistaken for one.
 *
 * Both go through the same validation for one reason: this is the code that
 * decides which paths get written and which digests must match. Two copies of
 * that logic would be two places to fix a hole in, and the sideload copy - the
 * one handling files that never touched a catalog - is the one that would rot.
 */
type PackFlavor = 'catalog' | 'package';

interface FlavorSpec {
  /** Human noun used in top-level error messages. */
  noun: string;
  /** Field carrying each artifact's transferred/stored size. */
  artifactSizeField: string;
  /** Top-level size fields that must be present and within the ceiling. */
  packSizeFields: readonly string[];
  requireDownloadUrl: boolean;
  requireFormat: boolean;
}

const FLAVORS: Record<PackFlavor, FlavorSpec> = {
  catalog: {
    noun: 'Feature pack entry',
    artifactSizeField: 'download_size_bytes',
    packSizeFields: ['download_size_bytes', 'installed_size_bytes'],
    requireDownloadUrl: true,
    requireFormat: false,
  },
  package: {
    noun: 'Feature pack manifest',
    artifactSizeField: 'size_bytes',
    packSizeFields: ['installed_size_bytes'],
    requireDownloadUrl: false,
    requireFormat: true,
  },
};

/** Flavor-neutral artifact, mapped to the public shape by each entry point. */
interface CommonArtifact {
  kind: FeaturePackArtifactKind;
  path: string;
  sizeBytes: number;
  sha256: string;
  gzipped: boolean;
  downloadUrl: string | null;
}

interface CommonPack {
  packId: string;
  packType: FeaturePackType;
  name: string;
  version: string;
  description: string;
  license: string;
  licenseUrl: string | null;
  installedSizeBytes: number;
  downloadSizeBytes: number;
  artifacts: CommonArtifact[];
  metadata: Record<string, unknown> | null;
}

function parsePackCommon(
  raw: unknown,
  flavor: PackFlavor
): { ok: true; pack: CommonPack } | { ok: false; errors: string[] } {
  const spec = FLAVORS[flavor];
  const errors: string[] = [];

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: [`${spec.noun} is not an object.`] };
  }

  const entry = raw as Record<string, unknown>;

  if (spec.requireFormat && entry.format !== FEATURE_PACK_FILE_FORMAT) {
    // Checked before anything else is reported: a file that is not a feature
    // pack at all should say so, rather than produce a list of missing fields.
    return {
      ok: false,
      errors: [`\`format\` must be "${FEATURE_PACK_FILE_FORMAT}".`],
    };
  }

  const packId = entry.pack_id;
  if (typeof packId !== 'string' || !PACK_ID_RE.test(packId)) {
    errors.push('`pack_id` must be a lowercase slug of letters, digits, dot, dash or underscore.');
  }

  const packType = entry.pack_type;
  if (typeof packType !== 'string' || !(FEATURE_PACK_TYPES as readonly string[]).includes(packType)) {
    // Deliberately fatal rather than "ignore unknown packs": a newer catalog
    // advertising a pack type this build cannot install should surface as a
    // clear rejection, not as a silently missing entry.
    errors.push(`\`pack_type\` must be one of: ${FEATURE_PACK_TYPES.join(', ')}.`);
  }

  for (const field of ['name', 'version', 'description', 'license'] as const) {
    const value = entry[field];
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > 2000) {
      errors.push(`\`${field}\` must be a non-empty string.`);
    }
  }

  if (entry.license_url !== undefined && entry.license_url !== null) {
    if (typeof entry.license_url !== 'string' || !isHttpUrl(entry.license_url)) {
      errors.push('`license_url`, when present, must be an http(s) URL.');
    }
  }

  for (const field of spec.packSizeFields) {
    if (!isPositiveInt(entry[field]) || (entry[field] as number) > MAX_FEATURE_PACK_TOTAL_BYTES) {
      errors.push(`\`${field}\` must be a positive integer within the pack size ceiling.`);
    }
  }

  const rawArtifacts = entry.artifacts;
  if (!Array.isArray(rawArtifacts) || rawArtifacts.length === 0) {
    errors.push('`artifacts` must be a non-empty array.');
    return { ok: false, errors };
  }
  if (rawArtifacts.length > MAX_FEATURE_PACK_ARTIFACTS) {
    errors.push(`\`artifacts\` may contain at most ${MAX_FEATURE_PACK_ARTIFACTS} entries.`);
    return { ok: false, errors };
  }

  const artifacts: CommonArtifact[] = [];
  // Compared case-insensitively: two artifacts differing only in case are the
  // same file on Windows and macOS, and the second would overwrite the first.
  const seenPaths = new Set<string>();
  let declaredTotal = 0;

  rawArtifacts.forEach((rawArtifact, index) => {
    const label = `artifacts[${index}]`;
    if (typeof rawArtifact !== 'object' || rawArtifact === null || Array.isArray(rawArtifact)) {
      errors.push(`${label} is not an object.`);
      return;
    }
    const artifact = rawArtifact as Record<string, unknown>;

    const kind = artifact.kind;
    if (typeof kind !== 'string' || !(FEATURE_PACK_ARTIFACT_KINDS as readonly string[]).includes(kind)) {
      errors.push(`${label}.kind must be one of: ${FEATURE_PACK_ARTIFACT_KINDS.join(', ')}.`);
    }

    const path = artifact.path;
    if (typeof path !== 'string' || !isSafeArtifactPath(path)) {
      errors.push(`${label}.path is not a safe relative path.`);
    } else {
      const key = path.toLowerCase();
      if (seenPaths.has(key)) {
        errors.push(`${label}.path duplicates an earlier artifact path.`);
      }
      seenPaths.add(key);
    }

    if (spec.requireDownloadUrl
      && (typeof artifact.download_url !== 'string' || !isHttpUrl(artifact.download_url))) {
      errors.push(`${label}.download_url must be an http(s) URL.`);
    }

    if (typeof artifact.sha256 !== 'string' || !SHA256_RE.test(artifact.sha256)) {
      errors.push(`${label}.sha256 must be a 64-character hex digest.`);
    }

    const sizeField = spec.artifactSizeField;
    if (!isPositiveInt(artifact[sizeField])
      || (artifact[sizeField] as number) > MAX_FEATURE_PACK_ARTIFACT_BYTES) {
      errors.push(`${label}.${sizeField} must be a positive integer within the artifact ceiling.`);
    } else {
      declaredTotal += artifact[sizeField] as number;
    }

    if (artifact.gzipped !== undefined && typeof artifact.gzipped !== 'boolean') {
      errors.push(`${label}.gzipped must be a boolean when present.`);
    }

    if (errors.length === 0) {
      artifacts.push({
        kind: kind as FeaturePackArtifactKind,
        path: path as string,
        sizeBytes: artifact[sizeField] as number,
        sha256: (artifact.sha256 as string).toLowerCase(),
        gzipped: artifact.gzipped === true,
        downloadUrl: spec.requireDownloadUrl ? (artifact.download_url as string) : null,
      });
    }
  });

  if (declaredTotal > MAX_FEATURE_PACK_TOTAL_BYTES) {
    errors.push('Declared artifact sizes exceed the total feature-pack ceiling.');
  }

  // Shape requirements that only make sense once the artifact list is known.
  if (errors.length === 0 && packType === 'semantic_search') {
    const indexCount = artifacts.filter(a => a.kind === 'index').length;
    const modelCount = artifacts.filter(a => a.kind === 'model').length;
    if (indexCount !== 1) {
      errors.push('A semantic_search pack must contain exactly one `index` artifact.');
    }
    if (modelCount === 0) {
      errors.push('A semantic_search pack must contain at least one `model` artifact.');
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    pack: {
      packId: packId as string,
      packType: packType as FeaturePackType,
      name: entry.name as string,
      version: entry.version as string,
      description: entry.description as string,
      license: entry.license as string,
      licenseUrl: typeof entry.license_url === 'string' ? entry.license_url : null,
      installedSizeBytes: entry.installed_size_bytes as number,
      // A package declares no transfer total - every byte is already local -
      // so the artifact sum stands in for it.
      downloadSizeBytes: isPositiveInt(entry.download_size_bytes)
        ? (entry.download_size_bytes as number)
        : declaredTotal,
      artifacts,
      metadata:
        typeof entry.metadata === 'object' && entry.metadata !== null && !Array.isArray(entry.metadata)
          ? (entry.metadata as Record<string, unknown>)
          : null,
    },
  };
}

/**
 * Validate one raw catalog entry into a `FeaturePack`.
 *
 * Fail-closed and total: every field is checked, and the result is either a
 * fully-validated pack or a list of reasons. Callers must never fall back to
 * the raw object on failure.
 */
export function parseFeaturePack(raw: unknown): FeaturePackParseResult {
  const result = parsePackCommon(raw, 'catalog');
  if (!result.ok) return result;

  const common = result.pack;
  return {
    ok: true,
    pack: {
      pack_id: common.packId,
      pack_type: common.packType,
      name: common.name,
      version: common.version,
      description: common.description,
      license: common.license,
      license_url: common.licenseUrl,
      download_size_bytes: common.downloadSizeBytes,
      installed_size_bytes: common.installedSizeBytes,
      artifacts: common.artifacts.map(a => ({
        kind: a.kind,
        path: a.path,
        download_url: a.downloadUrl as string,
        download_size_bytes: a.sizeBytes,
        sha256: a.sha256,
        ...(a.gzipped ? { gzipped: true as const } : {}),
      })),
      metadata: common.metadata,
    },
  };
}

/**
 * Validate the `feature-pack.json` inside a sideloaded package.
 *
 * Same rules as a catalog entry minus the URLs, which a local package has no
 * use for. The digests are *not* redundant here: they are what makes a package
 * self-verifying, so a truncated copy off a USB stick or a half-finished file
 * transfer is rejected instead of installing an index the search code will
 * later fail to open. What they cannot tell you is who made the package -
 * sideloading is an explicit act of trust in whoever handed you the file, in
 * exactly the way installing from an enabled repository is not.
 */
export function parseLocalFeaturePack(raw: unknown): LocalFeaturePackParseResult {
  const result = parsePackCommon(raw, 'package');
  if (!result.ok) return result;

  const common = result.pack;
  return {
    ok: true,
    pack: {
      format: FEATURE_PACK_FILE_FORMAT,
      pack_id: common.packId,
      pack_type: common.packType,
      name: common.name,
      version: common.version,
      description: common.description,
      license: common.license,
      license_url: common.licenseUrl,
      installed_size_bytes: common.installedSizeBytes,
      artifacts: common.artifacts.map(a => ({
        kind: a.kind,
        path: a.path,
        size_bytes: a.sizeBytes,
        sha256: a.sha256,
        ...(a.gzipped ? { gzipped: true as const } : {}),
      })),
      metadata: common.metadata,
    },
  };
}

/**
 * Validate a catalog's whole `feature_packs` section, dropping entries that do
 * not validate. Unlike a single pack - where a bad field is fatal - one broken
 * listing must not hide every other pack in the catalog, so rejects are
 * reported alongside the survivors for the caller to log.
 */
export function parseFeaturePacks(raw: unknown): {
  packs: FeaturePack[];
  rejected: Array<{ index: number; errors: string[] }>;
} {
  if (!Array.isArray(raw)) {
    return { packs: [], rejected: [] };
  }

  const packs: FeaturePack[] = [];
  const rejected: Array<{ index: number; errors: string[] }> = [];
  const seenIds = new Set<string>();

  raw.slice(0, MAX_FEATURE_PACK_ARTIFACTS).forEach((entry, index) => {
    const result = parseFeaturePack(entry);
    if (!result.ok) {
      rejected.push({ index, errors: result.errors });
      return;
    }
    if (seenIds.has(result.pack.pack_id)) {
      rejected.push({ index, errors: ['Duplicate `pack_id` within the same catalog.'] });
      return;
    }
    seenIds.add(result.pack.pack_id);
    packs.push(result.pack);
  });

  return { packs, rejected };
}

function isPositiveInt(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
