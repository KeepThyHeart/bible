/**
 * The hymn library: a directory of `.hymn` files, read once and held in memory.
 *
 * No build step and no compiled index. The whole library is a few hundred
 * kilobytes of text -- roughly one chapter of Scripture -- and parsing it at
 * startup costs milliseconds, so the `index.json` build artifact the design
 * notes propose would buy nothing yet and cost a prebuild hook, a gitignored
 * output, and a way for the two to disagree. It is the right move when lookup
 * gets slow. It is not slow.
 *
 * The directory layout matches what a standalone hymn repository would have, so
 * pointing `BIBLE_HYMNS_DIR` at a checkout of one is the whole integration:
 *
 *     hymns/
 *       en/
 *         amazing-grace.hymn
 *
 * A file that fails to parse is skipped and logged, never fatal. A malformed
 * hymn contributed by someone else must not stop a service from starting.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { attributionFor, type Hymn, type HymnDetail, type HymnSummary } from '../../../../src/modules/present/lib/hymns.js';
import { parseHymn, type HymnParseIssue } from './parseHymn.js';
import { packSlides } from './slides.js';

export interface HymnLoadReport {
  loaded: number;
  failed: Array<{ file: string; errors: HymnParseIssue[] }>;
  warnings: Array<{ file: string; warnings: HymnParseIssue[] }>;
}

/** Results returned for one query. A controller list, not a catalogue dump. */
const DEFAULT_SEARCH_LIMIT = 30;

function summarize(hymn: Hymn): HymnSummary {
  return {
    id: hymn.id,
    title: hymn.title,
    firstLine: hymn.firstLine,
    ...(hymn.author ? { author: hymn.author } : {}),
    ...(hymn.tune ? { tune: hymn.tune } : {}),
    ...(hymn.meter ? { meter: hymn.meter } : {}),
    hymnals: hymn.hymnals,
    verseCount: hymn.sections.filter(section => section.kind === 'verse').length,
    hasRefrain: hymn.sections.some(section => section.kind === 'refrain'),
  };
}

export class HymnLibrary {
  private readonly hymns = new Map<string, Hymn>();
  /** Lower-cased haystack per hymn, built once so search does no work per query. */
  private readonly haystacks = new Map<string, string>();

  /**
   * Load every `.hymn` under `root`, recursing one level for the language
   * directories. Returns a report rather than throwing: the caller logs it.
   */
  load(root: string): HymnLoadReport {
    const report: HymnLoadReport = { loaded: 0, failed: [], warnings: [] };

    for (const file of this.walk(root)) {
      let source: string;
      try {
        source = readFileSync(file, 'utf-8');
      } catch {
        continue;
      }

      const result = parseHymn(source);
      if (!result.ok) {
        report.failed.push({ file, errors: result.errors });
        continue;
      }
      if (result.warnings.length > 0) {
        report.warnings.push({ file, warnings: result.warnings });
      }
      if (this.hymns.has(result.hymn.id)) {
        // Ids are what service plans reference, so two files claiming one id is
        // a corruption of saved sessions, not a merge.
        report.failed.push({
          file,
          errors: [{ line: 1, message: `Duplicate id '${result.hymn.id}'` }],
        });
        continue;
      }

      this.hymns.set(result.hymn.id, result.hymn);
      this.haystacks.set(result.hymn.id, this.haystackFor(result.hymn));
      report.loaded++;
    }
    return report;
  }

  private *walk(dir: string): Generator<string> {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      // No library installed. A perfectly ordinary state: hymns are optional.
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) yield* this.walk(full);
      else if (entry.endsWith('.hymn')) yield full;
    }
  }

  /**
   * Everything a person might type when asking for a hymn, in one string.
   *
   * The four ways someone actually asks are the title, the first line, an
   * alternative title, and a hymnal number -- somebody calls out "460" and the
   * controller should find it. Searching them together means the presenter does
   * not have to say which kind of thing they are typing.
   */
  private haystackFor(hymn: Hymn): string {
    const parts = [
      hymn.title,
      hymn.firstLine,
      ...hymn.altTitles,
      hymn.author ?? '',
      hymn.tune ?? '',
      ...hymn.hymnals.map(ref => `${ref.hymnal} ${ref.number}`),
      ...hymn.topics,
    ];
    return parts.join(' \u0000 ').toLowerCase();
  }

  get size(): number {
    return this.hymns.size;
  }

  get(id: string): Hymn | null {
    return this.hymns.get(id) ?? null;
  }

  /**
   * Everything needed to put a hymn on a screen.
   *
   * Slides are packed here rather than by the viewer because the server owns
   * what "next" means -- it has to know how many slides there are to know when
   * `next` runs out.
   */
  detail(id: string, verseOrder?: string[]): HymnDetail | null {
    const hymn = this.hymns.get(id);
    if (!hymn) return null;

    const order = verseOrder?.length ? verseOrder : hymn.verseOrder;
    return {
      ...summarize(hymn),
      slides: packSlides(hymn, order),
      attribution: attributionFor(hymn),
      verseOrder: order,
    };
  }

  /** How many slides a hymn makes in a given order. What `next` needs. */
  slideCount(id: string, verseOrder?: string[]): number | null {
    const hymn = this.hymns.get(id);
    if (!hymn) return null;
    return packSlides(hymn, verseOrder?.length ? verseOrder : hymn.verseOrder).length;
  }

  /**
   * Find hymns by any of the ways a person names one.
   *
   * Every term has to appear somewhere, which is what makes "amazing newton"
   * and "grace 460" both work. Ranking is by where the match landed: a title is
   * a stronger signal than a topic, and a hymn whose title *starts* with what
   * was typed is almost certainly the one being looked for.
   */
  search(query: string, limit = DEFAULT_SEARCH_LIMIT): { hymns: HymnSummary[]; total: number } {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

    const matched: Array<{ hymn: Hymn; score: number }> = [];
    for (const hymn of this.hymns.values()) {
      const haystack = this.haystacks.get(hymn.id)!;
      if (!terms.every(term => haystack.includes(term))) continue;
      matched.push({ hymn, score: this.score(hymn, terms) });
    }

    matched.sort((a, b) => b.score - a.score || a.hymn.title.localeCompare(b.hymn.title));
    return {
      hymns: matched.slice(0, limit).map(entry => summarize(entry.hymn)),
      total: matched.length,
    };
  }

  private score(hymn: Hymn, terms: string[]): number {
    if (terms.length === 0) return 0;
    const title = hymn.title.toLowerCase();
    const firstLine = hymn.firstLine.toLowerCase();
    const typed = terms.join(' ');

    let score = 0;
    if (title === typed) score += 100;
    if (title.startsWith(typed)) score += 50;
    if (firstLine.startsWith(typed)) score += 40;
    if (title.includes(typed)) score += 20;
    if (firstLine.includes(typed)) score += 10;
    // Someone calling out a number wants that number, not a hymn that happens
    // to mention it.
    if (hymn.hymnals.some(ref => terms.includes(ref.number.toLowerCase()))) score += 60;
    // A tie-break that is at least meaningful: appearing in many hymnals is
    // objective evidence a text is widely sung, with nobody asserting it.
    return score + Math.min(hymn.hymnals.length, 9);
  }

  /** Every hymn, for a browse list. Sorted by title, which is how one reads. */
  all(limit = DEFAULT_SEARCH_LIMIT): { hymns: HymnSummary[]; total: number } {
    const sorted = [...this.hymns.values()].sort((a, b) => a.title.localeCompare(b.title));
    return { hymns: sorted.slice(0, limit).map(summarize), total: sorted.length };
  }
}
