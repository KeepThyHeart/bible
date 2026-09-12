/**
 * The official catalog index: a signed list of the catalogs published under
 * the official domain.
 *
 * Why it exists
 * -------------
 * Splitting modules across several catalogs (one per language, say) keeps each
 * signing act small and auditable: adding one Spanish module means reviewing
 * and re-signing only the Spanish catalog. The index is how an installed app
 * learns those catalogs exist. It changes only when a catalog is added or
 * removed, so it is re-signed rarely, and its diff is a short list of URLs.
 *
 * Served at `<official prefix>index.json` and signed exactly like a catalog in
 * `index.json.sig` - same format, same pinned keys, same multi-signature and
 * vouch rules:
 *
 *   {
 *     "format": "kth-bible-catalog-index",
 *     "version": 1,
 *     "published": "2026-09-12T15:00:00Z",
 *     "catalogs": [
 *       { "url": "catalog.json",    "name": "English modules",    "abbreviation": "EN" },
 *       { "url": "es/catalog.json", "name": "Módulos en español", "abbreviation": "ES" }
 *     ]
 *   }
 *
 * Each `url` is resolved against the index's own URL and must stay under the
 * official prefix, so every listed catalog is itself pinned and must carry its
 * own valid signature. The index grants nothing a catalog would not already
 * need; it only says where to look. `published` is informational, like a
 * catalog's `repository.published`.
 *
 * The `format` marker keeps an index from being accepted as a catalog, or a
 * catalog as an index, even though both are signed the same way.
 */

export const CATALOG_INDEX_FILENAME = 'index.json';
export const CATALOG_INDEX_FORMAT = 'kth-bible-catalog-index';
export const CATALOG_INDEX_VERSION = 1;
/** An index listing more catalogs than this is refused outright. */
export const MAX_INDEX_CATALOGS = 64;

export interface CatalogIndexEntry {
  /** Absolute catalog URL, under the official prefix. */
  url: string;
  name: string;
  abbreviation?: string;
}

export interface ParsedCatalogIndex {
  entries: CatalogIndexEntry[];
  /** One message per listed catalog that was skipped. */
  rejected: string[];
}

/**
 * Parse an index document.
 *
 * Throws when the document itself is not an index. Individual entries that are
 * malformed, duplicated, or point outside `scope` are skipped and reported, so
 * one bad line cannot hide the rest.
 *
 * @param json     - The index document.
 * @param indexUrl - Where it was fetched from; relative URLs resolve against it.
 * @param scope    - The official URL prefix every catalog must fall under.
 */
export function parseCatalogIndex(json: string, indexUrl: string, scope: string): ParsedCatalogIndex {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    throw new Error('Catalog index is not valid JSON.');
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new Error('Catalog index must be a JSON object.');
  }

  const { format, version, catalogs } = doc as Record<string, unknown>;
  if (format !== CATALOG_INDEX_FORMAT || version !== CATALOG_INDEX_VERSION) {
    throw new Error(`Not a version ${CATALOG_INDEX_VERSION} "${CATALOG_INDEX_FORMAT}" document.`);
  }
  if (!Array.isArray(catalogs)) {
    throw new Error('Catalog index has no "catalogs" array.');
  }
  if (catalogs.length > MAX_INDEX_CATALOGS) {
    throw new Error(
      `Catalog index lists ${catalogs.length} catalogs; at most ${MAX_INDEX_CATALOGS} are read.`,
    );
  }

  const entries: CatalogIndexEntry[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>([indexUrl.toLowerCase()]);

  catalogs.forEach((raw: unknown, position: number) => {
    const problem = entryProblem(raw);
    if (problem) {
      rejected.push(`#${position}: ${problem}`);
      return;
    }
    const entry = raw as { url: string; name: string; abbreviation?: string };

    let url: string;
    try {
      url = new URL(entry.url, indexUrl).toString();
    } catch {
      rejected.push(`#${position}: "${entry.url}" is not a valid URL`);
      return;
    }
    // Only catalogs under the official prefix - they are then held to the same
    // pins. The URL parser has already folded any "../" segments.
    if (!url.toLowerCase().startsWith(scope.toLowerCase())) {
      rejected.push(`#${position}: ${url} is outside ${scope}`);
      return;
    }
    if (seen.has(url.toLowerCase())) {
      rejected.push(`#${position}: ${url} is the index itself or listed twice`);
      return;
    }

    seen.add(url.toLowerCase());
    entries.push({ url, name: entry.name.trim(), abbreviation: entry.abbreviation });
  });

  return { entries, rejected };
}

function entryProblem(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) return 'not an object';
  const entry = raw as Record<string, unknown>;
  if (typeof entry.url !== 'string' || entry.url.length === 0) return 'missing "url"';
  if (typeof entry.name !== 'string' || entry.name.trim() === '' || entry.name.length > 200) {
    return 'missing or overlong "name"';
  }
  if (
    entry.abbreviation !== undefined &&
    (typeof entry.abbreviation !== 'string' || entry.abbreviation.length > 20)
  ) {
    return '"abbreviation" must be a short string';
  }
  return undefined;
}
