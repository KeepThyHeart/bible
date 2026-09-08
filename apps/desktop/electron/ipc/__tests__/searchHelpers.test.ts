/**
 * Tests for the decision logic behind `search:performSearch`.
 *
 * These three functions are kept out of `searchHandlers.ts` and its database
 * singletons so they are reachable without an e2e run. That is what makes the
 * cases here cheap; the cases themselves are the point.
 *
 * Scope resolution decides which modules a search covers. Get it wrong in the
 * quiet direction - resolve to `[]` instead of "leave it alone" - and the app
 * reports "no results" for a query that matches, which reads as a broken
 * index rather than a broken filter.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  resolveSearchScope,
  applySearchHighlighting,
  formatSemanticReference,
  type ScopeModuleInfo,
} from '../searchHelpers';

const INSTALLED: ScopeModuleInfo[] = [
  { abbreviation: 'KJV', moduleType: 'bible' },
  { abbreviation: 'ASV', moduleType: 'bible' },
  { abbreviation: 'WEB', moduleType: 'bible' },
  { abbreviation: 'MHC', moduleType: 'commentary' },
  { abbreviation: 'TSK', moduleType: 'commentary' },
  { abbreviation: 'Easton', moduleType: 'dictionary' },
  { abbreviation: 'Naves', moduleType: 'topical' },
];

describe('resolveSearchScope — no scope', () => {
  it('leaves an explicit module list alone', () => {
    // `modules: undefined` is the signal to keep `options.modules`. Returning
    // an empty array here would silently narrow an explicit search to nothing.
    const result = resolveSearchScope(undefined, undefined, INSTALLED);

    expect(result.modules).toBeUndefined();
    expect(result.commentaryModules).toBeNull();
    expect(result.modulesToRegister).toEqual([]);
  });

  it('leaves an unrecognized scope alone rather than guessing', () => {
    const result = resolveSearchScope('currentModule', ['KJV'], INSTALLED);

    expect(result.modules).toBeUndefined();
    expect(result.commentaryModules).toBeNull();
  });

  it('never asks the caller to register a module it did not choose', () => {
    // The registration list opens databases. Echoing back a caller-supplied
    // list would let an unvalidated argument decide which files get opened.
    const result = resolveSearchScope('currentModule', ['KJV', 'ASV'], INSTALLED);

    expect(result.modulesToRegister).toEqual([]);
  });
});

describe('resolveSearchScope — allOpenModules', () => {
  it('splits the open modules into Bibles and commentaries', () => {
    const result = resolveSearchScope('allOpenModules', ['KJV', 'MHC', 'ASV'], INSTALLED);

    expect(result.modules).toEqual(['KJV', 'ASV']);
    expect(result.commentaryModules).toEqual(['MHC']);
  });

  it('keeps the renderer\'s ordering', () => {
    // The renderer sends the reader's active translation first, and result
    // dedup prefers the earlier module - so order is a visible behaviour, not
    // an implementation detail.
    const result = resolveSearchScope('allOpenModules', ['WEB', 'KJV'], INSTALLED);

    expect(result.modules).toEqual(['WEB', 'KJV']);
  });

  it('drops an open module that is not installed', () => {
    // The renderer's list can go stale across a module uninstall.
    const result = resolveSearchScope('allOpenModules', ['KJV', 'GHOST'], INSTALLED);

    expect(result.modules).toEqual(['KJV']);
  });

  it('ignores open modules that are neither Bible nor commentary', () => {
    const result = resolveSearchScope('allOpenModules', ['KJV', 'Easton', 'Naves', 'MHC'], INSTALLED);

    expect(result.modules).toEqual(['KJV']);
    expect(result.commentaryModules).toEqual(['MHC']);
  });

  it('falls back to the explicit list when nothing is open yet', () => {
    // The renderer sends an empty list during startup, before the first pane
    // has loaded. Resolving that to "search no modules" turns a valid query
    // into zero results.
    for (const openModules of [undefined, []]) {
      const result = resolveSearchScope('allOpenModules', openModules, INSTALLED);

      expect(result.modules).toBeUndefined();
      expect(result.commentaryModules).toBeNull();
      expect(result.modulesToRegister).toEqual([]);
    }
  });

  it('resolves to no commentaries — not "unchanged" — when only Bibles are open', () => {
    // `[]` and `null` are different answers. `[]` clears a commentary list
    // left over from a previous search; `null` would keep searching it.
    const result = resolveSearchScope('allOpenModules', ['KJV'], INSTALLED);

    expect(result.commentaryModules).toEqual([]);
  });

  it('asks for exactly the Bibles it chose to be registered', () => {
    const result = resolveSearchScope('allOpenModules', ['KJV', 'MHC', 'ASV'], INSTALLED);

    expect(result.modulesToRegister).toEqual(result.modules);
  });
});

describe('resolveSearchScope — allBibles', () => {
  it('takes every installed Bible', () => {
    const result = resolveSearchScope('allBibles', undefined, INSTALLED);

    expect(result.modules).toEqual(['KJV', 'ASV', 'WEB']);
  });

  it('says nothing about commentaries', () => {
    // "All Bibles" is not "all modules": it must not switch commentary search
    // on, and must not switch off one the caller already asked for.
    const result = resolveSearchScope('allBibles', undefined, INSTALLED);

    expect(result.commentaryModules).toBeNull();
  });

  it('ignores the open-module list entirely', () => {
    const result = resolveSearchScope('allBibles', ['KJV'], INSTALLED);

    expect(result.modules).toEqual(['KJV', 'ASV', 'WEB']);
  });

  it('skips a module with no abbreviation', () => {
    // `module_metadata.abbreviation` is nullable, and an abbreviation is the
    // only handle the search service has on a module.
    const result = resolveSearchScope('allBibles', undefined, [
      { abbreviation: 'KJV', moduleType: 'bible' },
      { moduleType: 'bible' },
    ]);

    expect(result.modules).toEqual(['KJV']);
  });

  it('resolves to an empty list when no Bibles are installed', () => {
    const result = resolveSearchScope('allBibles', undefined, [{ abbreviation: 'MHC', moduleType: 'commentary' }]);

    expect(result.modules).toEqual([]);
  });
});

describe('resolveSearchScope — allModules', () => {
  it('takes every Bible and every commentary', () => {
    const result = resolveSearchScope('allModules', undefined, INSTALLED);

    expect(result.modules).toEqual(['KJV', 'ASV', 'WEB']);
    expect(result.commentaryModules).toEqual(['MHC', 'TSK']);
  });

  it('leaves dictionaries and topical indexes out', () => {
    // They are searched through their own handlers, with their own result
    // shapes; including them here produces rows the results pane cannot render.
    const result = resolveSearchScope('allModules', undefined, INSTALLED);

    expect([...result.modules!, ...result.commentaryModules!]).not.toContain('Easton');
    expect([...result.modules!, ...result.commentaryModules!]).not.toContain('Naves');
  });

  it('registers only the Bibles, not the commentaries', () => {
    // Commentaries are searched by `commentaryHandlers`, which owns their
    // repositories; adding them to the Bible search service would be a
    // type error at best and a wrong-shaped result at worst.
    const result = resolveSearchScope('allModules', undefined, INSTALLED);

    expect(result.modulesToRegister).toEqual(['KJV', 'ASV', 'WEB']);
  });
});

describe('applySearchHighlighting', () => {
  const highlight = (html: string, terms: string[]) =>
    terms.reduce((acc, term) => acc.split(term).join(`<strong><u>${term}</u></strong>`), html);

  it('wraps each matched term', () => {
    const result = applySearchHighlighting('God so loved the world', [{ term: 'loved' }], highlight);

    expect(result).toBe('God so <strong><u>loved</u></strong> the world');
  });

  it('passes every term through, in order', () => {
    const spy = vi.fn(() => 'out');

    applySearchHighlighting('in', [{ term: 'a' }, { term: 'b' }], spy);

    expect(spy).toHaveBeenCalledWith('in', ['a', 'b']);
  });

  it('returns the html untouched when there are no matches', () => {
    // Not just an optimization: the highlighter is given a term list, and an
    // empty one has it rewrite the markup for nothing.
    const spy = vi.fn();

    expect(applySearchHighlighting('<p>text</p>', [], spy)).toBe('<p>text</p>');
    expect(spy).not.toHaveBeenCalled();
  });

  it('tolerates a missing matches array', () => {
    // Multi-verse results come back from `BibleSearchService` already
    // highlighted and carry no `matches`.
    const spy = vi.fn();

    expect(applySearchHighlighting('<p>text</p>', undefined, spy)).toBe('<p>text</p>');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('formatSemanticReference', () => {
  const BOOKS: Record<number, string> = { 43: 'John', 40: 'Matthew', 41: 'Mark', 19: 'Psalms' };
  const bookName = (n: number) => BOOKS[n] ?? `Book ${n}`;
  const id = (book: number, chapter: number, verse: number) => book * 1000000 + chapter * 1000 + verse;

  it('renders a single verse', () => {
    expect(formatSemanticReference(id(43, 3, 16), id(43, 3, 16), bookName)).toBe('John 3:16');
  });

  it('renders a range inside one chapter with a bare end verse', () => {
    expect(formatSemanticReference(id(43, 3, 16), id(43, 3, 18), bookName)).toBe('John 3:16-18');
  });

  it('repeats the chapter for a range that crosses chapters', () => {
    // "John 3:16-2" would be unreadable, so the cross-chapter form spells the
    // end out and spaces the dash.
    expect(formatSemanticReference(id(43, 3, 30), id(43, 4, 2), bookName)).toBe('John 3:30 - 4:2');
  });

  it('names the second book for a range that crosses books', () => {
    // Chapter-level embeddings can span a book boundary.
    expect(formatSemanticReference(id(40, 28, 18), id(41, 1, 3), bookName))
      .toBe('Matthew 28:18 - Mark 1:3');
  });

  it('falls back to a numbered book name for an unknown book', () => {
    expect(formatSemanticReference(id(99, 1, 1), id(99, 1, 1), bookName)).toBe('Book 99 1:1');
  });

  it('looks the end book up too, not just the start', () => {
    const spy = vi.fn(bookName);

    formatSemanticReference(id(40, 28, 18), id(41, 1, 3), spy);

    expect(spy).toHaveBeenCalledWith(40);
    expect(spy).toHaveBeenCalledWith(41);
  });

  it('does not look up the end book when it does not need it', () => {
    const spy = vi.fn(bookName);

    formatSemanticReference(id(43, 3, 16), id(43, 3, 18), spy);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('parses the three-part verse id correctly at its boundaries', () => {
    expect(formatSemanticReference(id(19, 119, 176), id(19, 119, 176), bookName)).toBe('Psalms 119:176');
    expect(formatSemanticReference(id(43, 1, 1), id(43, 1, 1), bookName)).toBe('John 1:1');
  });
});
