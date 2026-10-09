/**
 * Similar passages pane state (task 0070). Purely in-memory: the web app keeps no personal content in the
 * browser until accounts exist, so filters, the "More like this" back stack and results live only for the
 * session (component lifetime of the store, never persisted).
 */

import { Store } from '../../stores/Store';
import { loadSimilarTable, resetSimilarTable } from './similarTable';
import { formatPassage } from './webSimilarService';
import type { WebSimilar } from './webSimilarService';
import type { MatchReason, PassageRange, SimilarPassage, SimilarResult } from '@bible/core/browser';

export type SimilarStatus = 'idle' | 'loading' | 'downloading' | 'ready' | 'unavailable' | 'empty' | 'needsLive' | 'error';
export type SimilarTestament = 'any' | 'ot' | 'nt' | 'other';

export interface SimilarRowData extends SimilarPassage {
  key: string;
  reference: string;
  text: string;
}

const PAGE = 10;

const sameRange = (a: PassageRange | null, b: PassageRange | null): boolean =>
  !!a && !!b && a.startVerseId === b.startVerseId && a.endVerseId === b.endVerseId;

class SimilarStore extends Store {
  status: SimilarStatus = 'idle';
  progress: { loaded: number; total: number } | null = null;
  source: PassageRange | null = null;
  rows: SimilarRowData[] = [];
  floor = 0;
  approximate = false;
  hideKnown = false;
  testament: SimilarTestament = 'any';
  limit = PAGE;
  /** True when the table may hold more rows than shown. */
  canShowMore = false;
  errorMessage = '';
  reasons = new Map<string, MatchReason[]>();
  private backStack: PassageRange[] = [];
  private web: WebSimilar | null = null;
  private token = 0;

  get canGoBack(): boolean {
    return this.backStack.length > 0;
  }

  configure(web: WebSimilar | null): void {
    this.web = web;
    this.web?.service.reset();
  }

  /** The pane follows the selected verse/passage; following drops the "More like this" trail. */
  follow(range: PassageRange | null): void {
    if (sameRange(range, this.source)) return;
    this.backStack = [];
    this.limit = PAGE;
    void this.run(range);
  }

  /** Re-centre on a result; Back returns. */
  moreLike(range: PassageRange): void {
    if (this.source) this.backStack.push(this.source);
    this.limit = PAGE;
    void this.run(range);
  }

  back(): void {
    const prev = this.backStack.pop();
    if (!prev) return;
    this.limit = PAGE;
    void this.run(prev);
  }

  setHideKnown(v: boolean): void {
    if (v === this.hideKnown) return;
    this.hideKnown = v;
    void this.run(this.source, true);
  }

  setTestament(v: SimilarTestament): void {
    if (v === this.testament) return;
    this.testament = v;
    void this.run(this.source, true);
  }

  showMore(): void {
    this.limit += PAGE;
    void this.run(this.source, true);
  }

  retry(): void {
    resetSimilarTable();
    void this.run(this.source, true);
  }

  /** Fills the "why" chips for a row the first time it is visible. */
  async requestReasons(row: SimilarRowData): Promise<void> {
    const web = this.web;
    const source = this.source;
    if (!web || !source || this.reasons.has(row.key)) return;
    this.reasons.set(row.key, []);
    try {
      const reasons = await web.explain(source, row);
      if (this.source !== source) return;
      this.reasons.set(row.key, reasons);
      this.notify();
    } catch { /* chips are optional */ }
  }

  private async run(range: PassageRange | null, keepRows = false): Promise<void> {
    const my = ++this.token;
    this.source = range;
    if (!keepRows) {
      this.rows = [];
      this.reasons = new Map();
    }
    this.errorMessage = '';
    const web = this.web;
    if (!range || !web) {
      this.status = 'idle';
      this.rows = [];
      this.notify();
      return;
    }
    this.status = 'loading';
    this.progress = null;
    this.notify();
    try {
      const table = await loadSimilarTable((p) => {
        if (my !== this.token) return;
        this.status = 'downloading';
        this.progress = p;
        this.notify();
      });
      if (my !== this.token) return;
      if (!table) {
        this.status = 'unavailable';
        this.rows = [];
        this.notify();
        return;
      }
      const result: SimilarResult = await web.service.findSimilar(range, {
        maxResults: this.limit,
        crossRefs: this.hideKnown ? 'hide' : 'flag',
        testament: this.testament,
        source: 'auto',
      });
      if (my !== this.token) return;
      const rows = await Promise.all(
        result.passages.map(async (p): Promise<SimilarRowData> => ({
          ...p,
          key: `${p.level}|${p.startVerseId}|${p.endVerseId}`,
          reference: formatPassage(p),
          text: await web.textOf(p).catch(() => ''),
        })),
      );
      if (my !== this.token) return;
      this.rows = rows;
      this.floor = result.floor;
      this.approximate = result.approximate;
      this.canShowMore = rows.length >= this.limit;
      this.status = result.via === 'none'
        ? (result.reason === 'range-needs-live' ? 'needsLive' : 'empty')
        : rows.length ? 'ready' : 'empty';
      this.progress = null;
    } catch (e) {
      if (my !== this.token) return;
      this.status = 'error';
      this.errorMessage = e instanceof Error ? e.message : String(e);
    }
    this.notify();
  }

  /** Test seam. */
  resetForTests(): void {
    this.token++;
    this.status = 'idle';
    this.progress = null;
    this.source = null;
    this.rows = [];
    this.floor = 0;
    this.approximate = false;
    this.hideKnown = false;
    this.testament = 'any';
    this.limit = PAGE;
    this.canShowMore = false;
    this.errorMessage = '';
    this.reasons = new Map();
    this.backStack = [];
    this.web = null;
  }
}

export const similarStore = new SimilarStore();
