import { Store } from '../../stores/Store';
import { bibleStore } from '../../stores/bibleStore';
import { getWordStudyProvider, isWordStudyOfflineError } from './WordStudyProvider';
import { groupFromQuery } from '@bible/core/browser';
import type {
  IWordStudyProvider,
  WordGroup,
  WordKeyCandidate,
  WordOccurrencePage,
  WordStudyOverview,
  WordStudySubject,
} from '@bible/core/browser';

/** Occurrences fetched per page; "load more" appends the next page. */
export const WORD_STUDY_PAGE_SIZE = 100;

export interface WordStudyStoreFilters {
  book?: number;
  form?: string;
}

const STRONGS_RE = /^(?:strongs:)?([GH]\d+)$/i;
const GROUP_SYNTAX_RE = /[,;|*]/;

/** Stable identity of a subject, for trail de-duplication. */
function subjectKey(s: WordStudySubject): string {
  return s.kind === 'strongs' ? `s:${s.strongs}` : `g:${s.group.id}`;
}

/**
 * State of the Word study pane: what is being studied, the options and filters,
 * the loaded overview and occurrence pages and a back/forward
 * trail of subjects. Server work goes through the {@link IWordStudyProvider};
 * every request is sequenced so a slow response for a subject the reader has
 * already left is dropped instead of overwriting the current one.
 */
class WordStudyStore extends Store {
  private provider: IWordStudyProvider | null = null;

  subject: WordStudySubject | null = null;
  /** Module the study describes. Undefined until the server (or the reader) picks one. */
  module: string | undefined = undefined;
  renderingMode: 'head' | 'phrase' = 'head';
  filters: WordStudyStoreFilters = {};
  query = '';
  candidates: WordKeyCandidate[] = [];
  overview: WordStudyOverview | null = null;
  occurrences: WordOccurrencePage | null = null;
  loading = false;
  occurrencesLoading = false;
  error: string | null = null;
  /** True when the last request failed because the server is unreachable. */
  offline = false;

  private trail: WordStudySubject[] = [];
  private trailIndex = -1;
  /** True once the reader picked a module themselves; until then the active Bible is only a preference. */
  private moduleExplicit = false;
  private studySeq = 0;
  private occSeq = 0;
  private resolveSeq = 0;

  /** Inject a provider (tests); defaults to the app's server provider. */
  init(provider?: IWordStudyProvider): void {
    this.provider = provider ?? null;
    this.notify();
  }

  private api(): IWordStudyProvider {
    return (this.provider ??= getWordStudyProvider());
  }

  /** Back to a blank state (tests). */
  reset(): void {
    this.studySeq++; this.occSeq++; this.resolveSeq++;
    this.subject = null; this.module = undefined; this.renderingMode = 'head'; this.filters = {};
    this.query = ''; this.candidates = []; this.overview = null; this.occurrences = null;
    this.loading = false; this.occurrencesLoading = false; this.error = null; this.offline = false;
    this.trail = []; this.trailIndex = -1; this.moduleExplicit = false;
    this.notify();
  }

  get canGoBack(): boolean { return this.trailIndex > 0; }
  get canGoForward(): boolean { return this.trailIndex >= 0 && this.trailIndex < this.trail.length - 1; }
  get hasMore(): boolean {
    return !!this.occurrences && this.occurrences.items.length < this.occurrences.total;
  }

  // ------------------------------------------------------------------ input

  setQuery(query: string): void {
    this.query = query;
    this.notify();
  }

  /**
   * Study what the reader typed. A Strong's number, or a word the server resolves to
   * Strong's entries, is a Strong's study (one entry opens directly, several become a pick list);
   * anything else, and anything using group syntax (`,` `;` `|` `*`), is a word group.
   */
  async submit(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.query = trimmed;
    this.candidates = [];
    const seq = ++this.resolveSeq;

    if (GROUP_SYNTAX_RE.test(trimmed)) {
      await this.openGroup(groupFromQuery(trimmed));
      return;
    }
    const m = STRONGS_RE.exec(trimmed);
    if (m) {
      await this.openStrongs(m[1].toUpperCase());
      return;
    }

    this.loading = true; this.error = null; this.offline = false;
    this.notify();
    let found: WordKeyCandidate[];
    try {
      found = await this.api().resolve(trimmed);
    } catch (e) {
      if (seq !== this.resolveSeq) return;
      this.loading = false;
      this.fail(e);
      return;
    }
    if (seq !== this.resolveSeq) return;
    if (found.length === 1) {
      await this.openStrongs(found[0].strongs);
    } else if (found.length > 1) {
      this.candidates = found;
      this.loading = false;
      this.notify();
    } else {
      await this.openGroup(groupFromQuery(trimmed));
    }
  }

  pickCandidate(strongs: string): Promise<void> {
    this.candidates = [];
    return this.openStrongs(strongs);
  }

  // ---------------------------------------------------------------- subjects

  openStrongs(strongs: string, opts?: { module?: string }): Promise<void> {
    return this.open({ kind: 'strongs', strongs }, opts);
  }

  openGroup(group: WordGroup, opts?: { module?: string }): Promise<void> {
    return this.open({ kind: 'group', group }, opts);
  }

  private async open(subject: WordStudySubject, opts?: { module?: string }): Promise<void> {
    this.resolveSeq++;
    this.candidates = [];
    if (opts?.module) { this.module = opts.module; this.moduleExplicit = true; }
    // A new subject drops the trail beyond the current position, like browser history.
    const current = this.trail[this.trailIndex];
    if (!current || subjectKey(current) !== subjectKey(subject)) {
      this.trail = [...this.trail.slice(0, this.trailIndex + 1), subject];
      this.trailIndex = this.trail.length - 1;
    } else {
      this.trail[this.trailIndex] = subject;
    }
    await this.study(subject);
  }

  back(): Promise<void> {
    if (!this.canGoBack) return Promise.resolve();
    this.trailIndex--;
    return this.study(this.trail[this.trailIndex]);
  }

  forward(): Promise<void> {
    if (!this.canGoForward) return Promise.resolve();
    this.trailIndex++;
    return this.study(this.trail[this.trailIndex]);
  }

  /** Reload the current subject (retry after an error, or after coming back online). */
  reload(): Promise<void> {
    return this.subject ? this.study(this.subject) : Promise.resolve();
  }

  // ----------------------------------------------------------------- options

  setModule(module: string): Promise<void> {
    this.module = module;
    this.moduleExplicit = true;
    return this.reload();
  }

  setRenderingMode(mode: 'head' | 'phrase'): Promise<void> {
    if (mode === this.renderingMode) return Promise.resolve();
    this.renderingMode = mode;
    return this.reload();
  }

  setFilters(filters: WordStudyStoreFilters): Promise<void> {
    this.filters = { ...filters };
    this.notify();
    return this.loadOccurrences(true);
  }

  // ---------------------------------------------------------------- loading

  private fail(e: unknown): void {
    if (isWordStudyOfflineError(e)) {
      this.offline = true;
      this.error = null;
    } else {
      this.offline = false;
      this.error = e instanceof Error ? e.message : String(e);
    }
    this.notify();
  }

  private async study(subject: WordStudySubject): Promise<void> {
    const seq = ++this.studySeq;
    this.occSeq++;
    this.subject = subject;
    this.filters = {};
    this.overview = null;
    this.occurrences = null;
    this.occurrencesLoading = false;
    this.loading = true;
    this.error = null;
    this.offline = false;
    this.notify();

    const preferred = this.moduleExplicit ? this.module : (this.module ?? bibleStore.getActiveModule());
    try {
      let overview = await this.api().getOverview(subject, { module: preferred, renderingMode: this.renderingMode });
      if (seq !== this.studySeq) return;
      // The active Bible was only a preference: if it cannot serve this study, let the server pick.
      if (!this.moduleExplicit && preferred && (overview.notice === 'not-tagged' || overview.notice === 'no-module')) {
        overview = await this.api().getOverview(subject, { renderingMode: this.renderingMode });
        if (seq !== this.studySeq) return;
      }
      this.overview = overview;
      this.module = overview.module ?? this.module;
      this.loading = false;
      this.notify();
    } catch (e) {
      if (seq !== this.studySeq) return;
      this.loading = false;
      this.fail(e);
      return;
    }
    await this.loadOccurrences(true);
  }

  /** Fetch the first page (replace) or the next page (append) of occurrences for the current study. */
  private async loadOccurrences(reset: boolean): Promise<void> {
    const subject = this.subject;
    const module = this.overview?.module ?? this.module;
    if (!subject || !module) return;
    const seq = ++this.occSeq;
    if (reset) this.occurrences = null;
    this.occurrencesLoading = true;
    this.notify();
    const offset = reset ? 0 : (this.occurrences?.items.length ?? 0);
    try {
      const page = await this.api().getOccurrences(subject, {
        module,
        book: this.filters.book,
        form: this.filters.form,
        renderingMode: this.renderingMode,
        offset,
        limit: WORD_STUDY_PAGE_SIZE,
      });
      if (seq !== this.occSeq) return;
      this.occurrences = reset || !this.occurrences
        ? page
        : { total: page.total, items: [...this.occurrences.items, ...page.items] };
      this.occurrencesLoading = false;
      this.notify();
    } catch (e) {
      if (seq !== this.occSeq) return;
      this.occurrencesLoading = false;
      this.fail(e);
    }
  }

  loadMore(): Promise<void> {
    if (this.occurrencesLoading || !this.hasMore) return Promise.resolve();
    return this.loadOccurrences(false);
  }
}

export const wordStudyStore = new WordStudyStore();
export type { WordStudyStore };
