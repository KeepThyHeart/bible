/**
 * The decision-making parts of `searchHandlers.ts`, separated from the wiring.
 *
 * `searchHandlers.ts` is 710 lines of IPC registration around module
 * singletons - a `SqliteProvider`, a `SearchController`, an ONNX embedder -
 * none of which can be stood up in a unit test. The logic that decides *what*
 * gets searched and *how a result is labelled* was buried in there with it, so
 * the only way to reach it was an e2e run against real modules.
 *
 * These functions are pure: no database, no Electron, no singletons. The
 * handler still owns every side effect (opening repositories, registering
 * modules with the search service); it just asks these for the answers first.
 */

/** The fields of `ModuleMetadata` scope resolution actually reads. */
export interface ScopeModuleInfo {
  abbreviation?: string;
  moduleType: string;
}

export type SearchScope = 'allOpenModules' | 'allBibles' | 'allModules' | string | undefined;

export interface ResolvedSearchScope {
  /**
   * The Bible modules to search, or `undefined` to keep whatever the caller
   * asked for in `options.modules`.
   */
  modules: string[] | undefined;
  /**
   * The commentary modules to search, or `null` to leave the caller's existing
   * `options.commentaryModules` alone. `[]` and `null` are different answers:
   * `[]` means "this scope resolved to no commentaries", `null` means "this
   * scope has no opinion".
   */
  commentaryModules: string[] | null;
  /**
   * Bible modules the caller must register with the search service before
   * searching. Empty for scopes that search whatever is already registered -
   * registering an arbitrary caller-supplied list would open databases on
   * demand from an unvalidated argument.
   */
  modulesToRegister: string[];
}

/**
 * Work out which modules a search covers.
 *
 * The three scopes differ in more than breadth:
 *
 * - `allOpenModules` trusts the renderer's list of open modules, but only
 *   after checking each one against the installed-module registry, and it
 *   preserves the renderer's ordering so the reader's current translation
 *   stays first in the results.
 * - `allBibles` searches every installed Bible and says nothing about
 *   commentaries.
 * - `allModules` is `allBibles` plus every installed commentary.
 *
 * Anything else - including no scope at all - leaves the explicit module list
 * untouched.
 */
export function resolveSearchScope(
  scope: SearchScope,
  openModules: string[] | undefined,
  allModules: ScopeModuleInfo[],
): ResolvedSearchScope {
  const unchanged: ResolvedSearchScope = { modules: undefined, commentaryModules: null, modulesToRegister: [] };

  if (scope === 'allOpenModules') {
    // No open modules is not the same as no modules: the renderer sends an
    // empty list before the first pane finishes loading, and narrowing the
    // search to nothing there would return zero hits for a valid query.
    if (!openModules || openModules.length === 0) return unchanged;

    const bibles: string[] = [];
    const commentaries: string[] = [];
    for (const abbreviation of openModules) {
      const info = allModules.find(m => m.abbreviation === abbreviation);
      if (!info) continue;
      if (info.moduleType === 'bible') bibles.push(abbreviation);
      else if (info.moduleType === 'commentary') commentaries.push(abbreviation);
    }
    return { modules: bibles, commentaryModules: commentaries, modulesToRegister: bibles };
  }

  if (scope === 'allBibles' || scope === 'allModules') {
    const bibles = abbreviationsOfType(allModules, 'bible');
    return {
      modules: bibles,
      commentaryModules: scope === 'allModules' ? abbreviationsOfType(allModules, 'commentary') : null,
      modulesToRegister: bibles,
    };
  }

  return unchanged;
}

/** Abbreviations of every installed module of one type, skipping any without one. */
function abbreviationsOfType(modules: ScopeModuleInfo[], moduleType: string): string[] {
  return modules
    .filter(m => m.moduleType === moduleType)
    .map(m => m.abbreviation)
    .filter((abbreviation): abbreviation is string => abbreviation !== undefined);
}

/**
 * Highlight the matched terms in a formatted verse.
 *
 * The guard matters: `highlightSearchTerms` is given a term list, and an empty
 * one would have it rewrite the HTML for nothing.
 */
export function applySearchHighlighting(
  html: string,
  matches: Array<{ term: string }> | undefined,
  highlight: (html: string, terms: string[]) => string,
): string {
  if (!matches || matches.length === 0) return html;
  return highlight(html, matches.map(m => m.term));
}

/**
 * Human-readable reference for a semantic-search hit.
 *
 * Semantic results are ranges, not verses - a paragraph- or chapter-level hit
 * can start and end in different chapters, and (at chapter level, near a book
 * boundary) different books. Each of those needs a different rendering, and
 * getting it wrong is visible on every result row.
 */
export function formatSemanticReference(
  startVerseId: number,
  endVerseId: number,
  bookName: (bookNumber: number) => string,
): string {
  const start = parseVerseId(startVerseId);
  const startName = bookName(start.book);
  const base = `${startName} ${start.chapter}:${start.verse}`;

  if (startVerseId === endVerseId) return base;

  const end = parseVerseId(endVerseId);
  if (start.book === end.book && start.chapter === end.chapter) {
    return `${base}-${end.verse}`;
  }
  if (start.book === end.book) {
    return `${base} - ${end.chapter}:${end.verse}`;
  }
  return `${base} - ${bookName(end.book)} ${end.chapter}:${end.verse}`;
}

function parseVerseId(verseId: number): { book: number; chapter: number; verse: number } {
  return {
    book: Math.floor(verseId / 1000000),
    chapter: Math.floor((verseId % 1000000) / 1000),
    verse: verseId % 1000,
  };
}
