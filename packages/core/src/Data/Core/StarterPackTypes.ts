/**
 * Starter packs - language-scoped bundles of recommended study content.
 *
 * A starter pack answers one question: *a user just told us they read Hindi;
 * what should we offer them?* `CatalogModule.recommended` cannot answer it -
 * it is a bare boolean with no language dimension, so "recommended" means
 * "recommended to everyone", which for study content is never true.
 *
 * ## A starter pack is a REFERENCE, not a payload
 *
 * A pack lists `module_ids` that must resolve against the **same catalog's**
 * `modules` array. It carries no download URLs of its own and adds no install
 * path: installing a pack means installing each referenced module through the
 * ordinary per-module download + `InstallationService` conformance gate, one
 * at a time. That is deliberate and worth defending:
 *
 *  - Each module keeps its own checksum, its own licence text, and its own
 *    per-module failure. A user declining one licence does not forfeit the
 *    other five.
 *  - A partial install resumes as five separate downloads rather than one
 *    2 GB archive restarting from zero.
 *  - Nothing here can bypass conformance, because nothing here installs.
 *
 * The optional `archive` field points at the same content packaged as a single
 * `.biblepack` for the OFFLINE route - a user who cannot reach the catalog
 * downloads it beside the installer and sideloads it through the existing
 * `ModulePackService`. Both routes deliver identical modules; they differ only
 * in how the bytes arrive. `scripts/build-module-pack.js` emits both from one
 * source of truth so they cannot drift.
 *
 * ## Trust
 *
 * Catalog JSON is untrusted network input. Everything here is validated
 * before any field is read, in the same shape as `FeaturePackTypes.ts`:
 * `RepositoryCatalog.starter_packs` is typed `unknown[]` so unvalidated data
 * cannot masquerade as a `StarterPack`.
 */

/**
 * UI locales for which we commit to offering study content.
 *
 * This is the *content* commitment, not the translation list - the UI ships
 * more locale catalogs than this (see `apps/desktop/locales/`), and the
 * language picker lists all of them. This narrower set is what the first-run
 * flow surfaces first and what starter packs are expected to exist for.
 *
 * Content reality per language, as recorded in each locale's `meta.json`
 * (read those notes before adding a pack - they carry the licence findings):
 *
 *  - `en`       - abundant public-domain material (KJV, Matthew Henry, ISBE, ...).
 *  - `es`       - Reina-Valera 1909 is public domain. RV1960/RV1995/NVI are NOT.
 *  - `zh-Hans`  - 和合本 (Chinese Union Version, 1919) is public domain in its
 *                 神版 form. CUVNP/RCUV/CNV are NOT.
 *  - `hi`       - **no** Hindi translation has been confirmed public domain.
 *                 The 19th-century BFBS text is probably clear but could not be
 *                 verified against a scanned pre-1928 edition, and every modern
 *                 edition checked is under active copyright. A Hindi starter
 *                 pack may therefore be empty or non-Bible content until a
 *                 specific edition is verified - that is expected, not a bug,
 *                 and the first-run UI must degrade gracefully when a language
 *                 has no pack.
 */
export const SUPPORTED_CONTENT_LANGUAGES = ['en', 'es', 'hi', 'zh-Hans'] as const;

export type SupportedContentLanguage = (typeof SUPPORTED_CONTENT_LANGUAGES)[number];

/** Narrowing helper. Accepts the exact BCP-47 tags above, case-sensitively. */
export function isSupportedContentLanguage(code: string): code is SupportedContentLanguage {
  return (SUPPORTED_CONTENT_LANGUAGES as readonly string[]).includes(code);
}

/**
 * Offline equivalent of a starter pack: the same modules, pre-packaged as one
 * `.biblepack` archive that `ModulePackService` can install with no network.
 */
export interface StarterPackArchive {
  download_url: string;
  /** Size of the archive as served. */
  download_size_bytes: number;
  /** Lowercase hex SHA-256 of the archive bytes as served. */
  sha256: string;
}

export interface StarterPack {
  pack_id: string;
  /**
   * BCP-47 codes this pack is offered for. A pack may serve several locales
   * (e.g. a Spanish pack for both `es` and `es-MX`); matching is exact first,
   * then by primary subtag - see `selectStarterPacksForLanguage`.
   */
  languages: string[];
  name: string;
  description: string;
  version: string;
  /**
   * `module_id` values that must resolve against the same catalog's `modules`
   * array. Unresolvable ids are dropped by the caller with a log line rather
   * than failing the pack, so a catalog that lists a module it later removes
   * degrades to a smaller pack instead of a broken one.
   */
  module_ids: string[];
  /**
   * Total download size of the referenced modules, for the first-run UI.
   * Advisory only: the authoritative sizes are on the modules themselves, and
   * the UI should prefer summing those when it has them.
   */
  download_size_bytes?: number | null;
  /** Optional single-archive offline route. Absent for online-only packs. */
  archive?: StarterPackArchive | null;
}

/** Upper bound on starter packs read from one catalog. */
export const MAX_STARTER_PACKS = 64;
/** Upper bound on modules one pack may reference. */
export const MAX_STARTER_PACK_MODULES = 200;
/** Upper bound on languages one pack may claim. */
export const MAX_STARTER_PACK_LANGUAGES = 32;
/** Ceiling on a declared archive size, matching the module-pack total ceiling. */
export const MAX_STARTER_PACK_ARCHIVE_BYTES = 8 * 1024 * 1024 * 1024;

const PACK_ID_RE = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const MODULE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
/**
 * BCP-47, restricted to the shapes we actually use: a 2-3 letter primary
 * subtag with optional script and region subtags (`en`, `pt-BR`, `zh-Hans`,
 * `zh-Hans-CN`). Deliberately not the full grammar - extensions and private
 * use tags have no place in a content-targeting field and would only widen
 * what has to be matched.
 */
const LANGUAGE_TAG_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z]{4})?(?:-(?:[A-Za-z]{2}|\d{3}))?$/;
const SHA256_RE = /^[0-9a-f]{64}$/i;

const MAX_TEXT_FIELD_LENGTH = 500;

export type StarterPackParseResult =
  | { ok: true; pack: StarterPack }
  | { ok: false; errors: string[] };

function isNonEmptyString(value: unknown, maxLength = MAX_TEXT_FIELD_LENGTH): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
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

/**
 * Validate one entry from a catalog's `starter_packs` array.
 *
 * Every field is checked before any is read. A pack that references zero
 * modules is rejected: an empty pack renders as an install button that does
 * nothing, which is worse than no pack at all (the first-run UI already has a
 * "no pack for this language" path, and that path is honest).
 */
export function parseStarterPack(raw: unknown): StarterPackParseResult {
  const errors: string[] = [];

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['Starter pack entry must be a JSON object.'] };
  }
  const entry = raw as Record<string, unknown>;

  if (!isNonEmptyString(entry.pack_id, 100) || !PACK_ID_RE.test(entry.pack_id)) {
    errors.push('`pack_id` must be a short lowercase slug ([a-z0-9._-], starting alphanumeric).');
  }

  for (const field of ['name', 'description', 'version'] as const) {
    if (!isNonEmptyString(entry[field])) {
      errors.push(`\`${field}\` must be a non-empty string of at most ${MAX_TEXT_FIELD_LENGTH} characters.`);
    }
  }

  // -- languages ----------------------------------------------------------
  const rawLanguages = entry.languages;
  const languages: string[] = [];
  if (!Array.isArray(rawLanguages) || rawLanguages.length === 0) {
    errors.push('`languages` must be a non-empty array of BCP-47 tags.');
  } else if (rawLanguages.length > MAX_STARTER_PACK_LANGUAGES) {
    errors.push(`\`languages\` may list at most ${MAX_STARTER_PACK_LANGUAGES} tags.`);
  } else {
    const seen = new Set<string>();
    rawLanguages.forEach((tag, index) => {
      if (typeof tag !== 'string' || !LANGUAGE_TAG_RE.test(tag)) {
        errors.push(`languages[${index}] is not a recognised BCP-47 tag.`);
        return;
      }
      // Case-insensitive dedupe: `en` and `EN` target the same locale, and a
      // duplicate would double-count the pack in the first-run list.
      const key = tag.toLowerCase();
      if (seen.has(key)) {
        errors.push(`languages[${index}] duplicates an earlier tag.`);
        return;
      }
      seen.add(key);
      languages.push(tag);
    });
  }

  // -- module_ids ---------------------------------------------------------
  const rawModuleIds = entry.module_ids;
  const moduleIds: string[] = [];
  if (!Array.isArray(rawModuleIds) || rawModuleIds.length === 0) {
    errors.push('`module_ids` must be a non-empty array - an empty pack has nothing to install.');
  } else if (rawModuleIds.length > MAX_STARTER_PACK_MODULES) {
    errors.push(`\`module_ids\` may reference at most ${MAX_STARTER_PACK_MODULES} modules.`);
  } else {
    const seen = new Set<string>();
    rawModuleIds.forEach((id, index) => {
      if (typeof id !== 'string' || !MODULE_ID_RE.test(id)) {
        errors.push(`module_ids[${index}] is not a valid module id.`);
        return;
      }
      if (seen.has(id)) {
        errors.push(`module_ids[${index}] duplicates an earlier id.`);
        return;
      }
      seen.add(id);
      moduleIds.push(id);
    });
  }

  // -- download_size_bytes (optional, advisory) ---------------------------
  let downloadSizeBytes: number | null = null;
  if (entry.download_size_bytes !== undefined && entry.download_size_bytes !== null) {
    if (!isPositiveInt(entry.download_size_bytes)
      || (entry.download_size_bytes as number) > MAX_STARTER_PACK_ARCHIVE_BYTES) {
      errors.push('`download_size_bytes`, when present, must be a positive integer within the pack ceiling.');
    } else {
      downloadSizeBytes = entry.download_size_bytes as number;
    }
  }

  // -- archive (optional offline route) -----------------------------------
  let archive: StarterPackArchive | null = null;
  if (entry.archive !== undefined && entry.archive !== null) {
    const rawArchive = entry.archive;
    if (typeof rawArchive !== 'object' || Array.isArray(rawArchive)) {
      errors.push('`archive`, when present, must be a JSON object.');
    } else {
      const a = rawArchive as Record<string, unknown>;
      const urlOk = isNonEmptyString(a.download_url, 2048) && isHttpUrl(a.download_url);
      if (!urlOk) {
        errors.push('`archive.download_url` must be an http(s) URL.');
      }
      const sizeOk = isPositiveInt(a.download_size_bytes)
        && (a.download_size_bytes as number) <= MAX_STARTER_PACK_ARCHIVE_BYTES;
      if (!sizeOk) {
        errors.push('`archive.download_size_bytes` must be a positive integer within the pack ceiling.');
      }
      const shaOk = typeof a.sha256 === 'string' && SHA256_RE.test(a.sha256);
      if (!shaOk) {
        errors.push('`archive.sha256` must be a 64-character hex SHA-256 digest.');
      }
      if (urlOk && sizeOk && shaOk) {
        archive = {
          download_url: a.download_url as string,
          download_size_bytes: a.download_size_bytes as number,
          // Normalised to lowercase so a digest comparison is a plain string
          // equality check at verify time.
          sha256: (a.sha256 as string).toLowerCase(),
        };
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    pack: {
      pack_id: entry.pack_id as string,
      languages,
      name: entry.name as string,
      description: entry.description as string,
      version: entry.version as string,
      module_ids: moduleIds,
      download_size_bytes: downloadSizeBytes,
      archive,
    },
  };
}

/**
 * Validate a catalog's whole `starter_packs` section.
 *
 * One malformed entry must not hide the rest, so rejects are reported
 * alongside the survivors for the caller to log - the same contract as
 * `parseFeaturePacks`.
 */
export function parseStarterPacks(raw: unknown): {
  packs: StarterPack[];
  rejected: Array<{ index: number; errors: string[] }>;
} {
  if (!Array.isArray(raw)) {
    return { packs: [], rejected: [] };
  }

  const packs: StarterPack[] = [];
  const rejected: Array<{ index: number; errors: string[] }> = [];
  const seenIds = new Set<string>();

  raw.slice(0, MAX_STARTER_PACKS).forEach((entry, index) => {
    const result = parseStarterPack(entry);
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

/**
 * Pick the packs offered for a UI locale, best match first.
 *
 * Matching is two-tier so that a user on `es-MX` still sees a pack tagged
 * plain `es`, and a user on `zh-Hans` is not offered a `zh-Hant` pack:
 *
 *  1. **Exact** tag match (case-insensitive) - `es-MX` <-> `es-MX`.
 *  2. **Primary-subtag** match where neither side declares a conflicting
 *     script - `es-MX` <-> `es`. A tag carrying a script subtag (`zh-Hans`)
 *     only falls back to another tag with the same script, because Simplified
 *     and Traditional Chinese are not interchangeable content.
 *
 * Returns `[]` when nothing matches, which is a normal outcome the first-run
 * UI must handle - see the `hi` note on `SUPPORTED_CONTENT_LANGUAGES`.
 */
export function selectStarterPacksForLanguage(
  packs: readonly StarterPack[],
  locale: string
): StarterPack[] {
  if (typeof locale !== 'string' || locale.length === 0) return [];

  const wanted = locale.toLowerCase();
  const wantedParts = wanted.split('-');
  const wantedPrimary = wantedParts[0] ?? '';
  // A 4-letter second subtag is a script (`hans`), not a region (`br`).
  const wantedScript = wantedParts[1]?.length === 4 ? wantedParts[1] : undefined;

  const exact: StarterPack[] = [];
  const primary: StarterPack[] = [];

  for (const pack of packs) {
    let matchedExact = false;
    let matchedPrimary = false;

    for (const tag of pack.languages) {
      const candidate = tag.toLowerCase();
      if (candidate === wanted) {
        matchedExact = true;
        break;
      }
      const parts = candidate.split('-');
      if (parts[0] !== wantedPrimary) continue;
      const candidateScript = parts[1]?.length === 4 ? parts[1] : undefined;
      // Only refuse when both sides name a script AND they disagree. An
      // unscripted tag is treated as compatible with either.
      if (wantedScript && candidateScript && wantedScript !== candidateScript) continue;
      matchedPrimary = true;
    }

    if (matchedExact) exact.push(pack);
    else if (matchedPrimary) primary.push(pack);
  }

  return [...exact, ...primary];
}
