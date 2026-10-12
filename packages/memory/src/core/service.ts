/**
 * Scripture Memory - the service behind the UI.
 *
 * This is the extension's worker (`main.ts`) as a plain class. It owns
 * everything that is not a pixel: the database, the schedule, the scoring, and
 * the session the user is in the middle of. The UI asks (one method per former
 * panel request, see `MemoryApi`) and renders. The split is not stylistic - a
 * popped-out window is a brand new document, so anything the UI held would be
 * lost the moment the user detached it. The service is long-lived, so the
 * session survives.
 *
 * What changed with the move: module-level state became instance fields; the
 * host is handed in as `MemoryHostApi` and `MemorySql`; what used to be a
 * panel push, a notification or a status bar item is now one `emit` callback;
 * and there is no permission, panel-type, command or context-menu plumbing.
 * Failures are thrown as `Error`s with the readable messages `dispatch` used to
 * wrap in `{ ok: false, error }`.
 */

import { setCoreTranslator, tc } from './messages';
import type { Translate } from './messages';
import type {
  BibleBookDto,
  BibleChapterDto,
  BibleVerseDto,
  MemoryHostApi,
  MemorySql,
  ParsedReferenceDto,
} from './ports';
import type {
  AddVersesOutcome,
  MemoryApi,
  MemoryImportStatus,
  MemoryImportResult,
  MemoryPush,
  MemoryStatus,
} from './api';
import type {
  AnswerMode,
  Card,
  Passage,
  PanelRequest,
  PassageContext,
  PassageView,
  PlanView,
  RequestMap,
  Rung,
  RungView,
  ReciteStateView,
  SessionSummary,
  SpeechAvailability,
  StepAnswer,
  VerseText,
} from './types';
import { MemoryStore, activityLevels, byCard, scopeOf, ensureDefaultCollection } from './store';
import type { ScopeFacts, TierProgressRow } from './store';
import {
  applicableRungs,
  inRungOrder,
  isOptionalRung,
  levelForActivity,
  MIN_VERSES_FOR_REFERENCE_ACTIVITIES,
  passageWellLearned,
  summarizeActivity,
  TIERS,
  WELL_LEARNED_LEVEL,
} from './ladder';
import { schedule, makeRng, isDue } from './scheduler';
import { PushController } from './pushController';
import { localCalendar } from './reminderPlan';
import type { Calendar } from './reminderPlan';
import { Session, nextSessionId, MAX_REFERENCE_STEPS } from './session';
import type { ReferenceCatalog } from './session';
import { toVerseText, CONTEXT_VERSES } from './verses';
import { resolveReference, ReferenceError, MAX_PASSAGE_VERSES } from './reference';
import { ReciteService } from './recite/service';
import type { RecordAndScheduleArgs, RecordAndScheduleResult } from './recite/service';
import {
  moduleKit,
  moduleLanguage,
  resetModuleCache,
  unavailableMessage,
} from './recite/speechAvailability';
import { BOOK_GENRE, buildReferenceDistractors, type ReferencePoint } from './exercises/references';
import { LEGACY_SOURCE_KEY } from './legacyImport';

const DEFAULT_COLLECTION_NAME = 'Default';
/**
 * The old default list's name, before T5 introduced multiple lists.
 *
 * Used only by `renameLegacyDefaultCollection`, the one-time startup upgrade
 * below - a database created before that has exactly one collection, still
 * called this.
 */
const LEGACY_DEFAULT_COLLECTION_NAME = 'My plan';

/**
 * Verse id encoding: book * 1e6 + chapter * 1e3 + verse.
 *
 * This is the host's KJV-absolute scheme, and it is used here only to render
 * the "3:16" label in the margin. It is an inference from the shape of the
 * ids, not a documented contract, so `verifyVerseIdEncoding` checks it once at
 * start against `listChapters` - real data the host computed itself - and
 * disables the labels rather than showing wrong ones if it ever stops holding.
 */
const BOOK_FACTOR = 1_000_000;
const CHAPTER_FACTOR = 1_000;

/** How long a soft-deleted passage is kept (restorable by re-adding it) before it is purged. */
const DELETED_PASSAGE_RETENTION_MS = 7 * 24 * 3600 * 1000;

/**
 * How many distinct books a `refmatch` distractor pool samples, at tiers 0
 * and 1 - a bound on `listChapters` calls, not an exhaustive fetch of every
 * book in the canon or every book of a genre. Large enough that a real
 * session essentially never runs short (see the `< 3` check in
 * `startSession`), small enough that opening a fresh reference activity does
 * not fire a dozen-plus host calls in a row.
 */
const REFERENCE_POOL_BOOKS = 8;

export interface MemoryServiceOptions {
  sql: MemorySql;
  /** `bible` always; `speech` and `reminders` when the host has them. */
  host: MemoryHostApi;
  /** Pushes to the UI: plan changes, recite state, notices, the status. */
  emit(push: MemoryPush): void;
  /** Bring the memory app forward (formerly `workspace.openPanel`). */
  openApp?(): void | Promise<void>;
  /** Open the host's settings (formerly `ui.openSettings`). */
  openSettings?(): void | Promise<void>;
  /** The host's translator for messages shown to the user (errors, notices, reminder text). Default: English. */
  t?: Translate;
  now?(): number;
  rng?(): number;
  calendar?: Calendar;
  log?: { warn(...a: unknown[]): void; error(...a: unknown[]): void };
  /**
   * The old extension's database on this machine, for the manual import.
   * Absent on hosts that never had the extension (web).
   */
  legacy?: {
    available(): boolean;
    merge(): MemoryImportResult | Promise<MemoryImportResult>;
  };
}

/** A request's arguments: the request without `type`. */
type Req<K extends PanelRequest['type']> = Omit<Extract<PanelRequest, { type: K }>, 'type'>;

/**
 * The verses a "Memorize" action was opened on: a contiguous run within one
 * chapter becomes a range, anything else just its first verse. Null when
 * there is no verse to go on.
 *
 * `verseId` is the verse that was clicked, when that is known and differs from
 * the first of `verseIds`; otherwise the lowest of `verseIds` is used.
 */
export function versesFromMenuArgs(
  args: { verseIds?: readonly number[]; verseId?: number; module?: string } | null | undefined,
): { start: number; end: number; module?: string } | null {
  if (!args) return null;
  const module = typeof args.module === 'string' && args.module !== '' ? args.module : undefined;

  const ids = (Array.isArray(args.verseIds) ? args.verseIds : [])
    .filter((n): n is number => typeof n === 'number')
    .sort((a, b) => a - b);
  const first = ids[0];
  const last = ids[ids.length - 1];
  const clicked = typeof args.verseId === 'number' ? args.verseId : first;
  if (clicked === undefined) return null;

  const contiguous =
    first !== undefined &&
    last !== undefined &&
    ids.length <= MAX_PASSAGE_VERSES &&
    ids.every((id, i) => i === 0 || id === ids[i - 1]! + 1) &&
    Math.floor(first / CHAPTER_FACTOR) === Math.floor(last / CHAPTER_FACTOR);
  return contiguous
    ? { start: first, end: last, ...(module ? { module } : {}) }
    : { start: clicked, end: clicked, ...(module ? { module } : {}) };
}

export class MemoryService implements MemoryApi {
  private readonly sql: MemorySql;
  private readonly host: MemoryHostApi;
  private readonly emit: (push: MemoryPush) => void;
  private readonly now: () => number;
  private readonly rng: () => number;
  private readonly calendar: Calendar;
  private readonly log: { warn(...a: unknown[]): void; error(...a: unknown[]): void };
  private readonly store: MemoryStore;

  /**
   * The Default list's id, set once at start. Used only as the initial value
   * and by `renameLegacyDefaultCollection`; every other read that needs "the
   * Default list right now" goes through `resolveAddTargetCollectionId` /
   * `findDefaultListId` instead, because the Default list can itself be
   * deleted (its passages moved elsewhere) after start, which would leave
   * this field pointing at a row that no longer exists.
   */
  private defaultCollectionId = 0;
  /**
   * Abbreviation of the translation new passages are recorded against. Null:
   * the first installed module. A later UI step may set it to the reader's.
   */
  private preferredModule: string | null = null;
  /** Push cards (task 0072). Null until start finishes, and after dispose. */
  private push: PushController | null = null;
  private lastStatus: MemoryStatus | null = null;
  private readonly sessions = new Map<string, Session>();
  /** Recite-aloud service: built lazily, once per service (see `getRecite`). */
  private recite: ReciteService | null = null;
  /** When each in-flight session started, for the (currently unshown) duration column. */
  private readonly sessionStartedAt = new Map<string, number>();
  private verseIdEncodingTrusted = true;
  /** Book number -> display name, from the host. Empty until loaded, or if the host refuses. */
  private bookNames = new Map<number, string>();

  /**
   * Book catalog and chapter-extent caches for `refmatch`'s distractor pool.
   *
   * `listBooks` is one call, fetched once and kept for the life of the
   * service. `listChapters` is genuinely one host call PER BOOK, so it is
   * fetched lazily, only for whichever books a session's tier actually needs
   * (see `buildReferenceCatalog`), and cached the same way so a book fetched
   * for one session is not re-fetched for the next.
   */
  private bookCatalogCache: BibleBookDto[] | null = null;
  private readonly chaptersCache = new Map<number, BibleChapterDto[]>();

  private constructor(opts: MemoryServiceOptions) {
    this.sql = opts.sql;
    this.host = opts.host;
    this.emit = opts.emit;
    this.opts = opts;
    this.now = opts.now ?? (() => Date.now());
    this.rng = opts.rng ?? Math.random;
    this.calendar = opts.calendar ?? localCalendar;
    this.log = opts.log ?? console;
    this.store = new MemoryStore(opts.sql);
  }

  private readonly opts: MemoryServiceOptions;

  /**
   * Open the service on `opts.sql`: default list, upgrades, housekeeping, the
   * optional push cards, and the first status. Storage is fatal (it throws);
   * everything after it is best effort.
   */
  static async start(opts: MemoryServiceOptions): Promise<MemoryService> {
    setCoreTranslator(opts.t);
    const svc = new MemoryService(opts);
    await svc.init();
    return svc;
  }

  private async init(): Promise<void> {
    resetModuleCache();

    this.defaultCollectionId = await ensureDefaultCollection(this.sql, DEFAULT_COLLECTION_NAME, this.now());
    await this.renameLegacyDefaultCollection();
    // Housekeeping only: a failed purge must never block start.
    try {
      await this.store.purgeOldDeletedPassages(this.now(), DELETED_PASSAGE_RETENTION_MS);
    } catch (err) {
      this.log.error(
        `Scripture Memory could not purge old deleted passages: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    await this.verifyVerseIdEncoding();
    await this.loadBookNames();
    await this.refreshStatus();

    // Push cards. Optional by design: the host may have no `reminders` API,
    // and nothing here may ever fail start.
    try {
      this.push = new PushController({
        store: this.store,
        api: this.host,
        now: this.now,
        calendar: this.calendar,
        rng: this.rng,
        fetchVerses: (passage) =>
          this.fetchVersesSafely(
            passage.startVerseId,
            passage.endVerseId,
            passage.moduleId,
            this.makeLabeller(passage.startVerseId, passage.endVerseId),
          ),
        post: (message) => {
          if (message.type !== 'activeVerse') this.emit(message);
        },
        refreshStatus: () => this.refreshStatus(),
        openPanel: async () => {
          await this.opts.openApp?.();
        },
      });
      await this.push.start();
      await this.refreshStatus();
    } catch (err) {
      this.push?.dispose();
      this.push = null;
      this.log.warn(`Scripture Memory: push cards unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  dispose(): void {
    // Sessions are in-memory and intentionally not flushed as attempts: a
    // half-finished exercise is not a fact worth recording as one, and writing
    // a partial attempt on shutdown would put a score in the history for work
    // the user never finished. The resume point up to the last completed verse
    // was already written to disk by `submitStep`, so nothing is lost except
    // the verse in progress.
    this.sessions.clear();
    this.sessionStartedAt.clear();
    // Stops listening, if a recitation is in progress.
    if (this.recite) void this.recite.dispose().catch(() => undefined);
    this.recite = null;
    this.push?.dispose();
    this.push = null;
  }

  // -------------------------------------------------------------------------
  // Labels
  // -------------------------------------------------------------------------

  private labelFor(verseId: number): string {
    if (!this.verseIdEncodingTrusted) return String(verseId);
    const chapter = Math.floor((verseId % BOOK_FACTOR) / CHAPTER_FACTOR);
    const verse = verseId % CHAPTER_FACTOR;
    return `${chapter}:${verse}`;
  }

  /**
   * Build a labeller for one passage: bare verse numbers when both the passage
   * and the verse being labelled sit in the same single chapter,
   * "chapter:verse" otherwise.
   *
   * A single-chapter passage reads fine with bare numbers in its own margin,
   * but a context verse from the chapter before or after it does not belong to
   * that chapter - labelling it bare would misread as if it were part of the
   * passage's chapter. So the "bare number" shortcut only applies when the
   * passage itself is single-chapter *and* the verse being labelled is inside
   * that same chapter; everything else gets the fully qualified label.
   */
  private makeLabeller(startVerseId: number, endVerseId: number): (verseId: number) => string {
    if (!this.verseIdEncodingTrusted) {
      return (verseId: number) => String(verseId);
    }
    const startChapter = Math.floor((startVerseId % BOOK_FACTOR) / CHAPTER_FACTOR);
    const endChapter = Math.floor((endVerseId % BOOK_FACTOR) / CHAPTER_FACTOR);
    const singleChapter = startChapter === endChapter ? startChapter : null;
    return (verseId: number) => {
      const chapter = Math.floor((verseId % BOOK_FACTOR) / CHAPTER_FACTOR);
      if (singleChapter !== null && chapter === singleChapter) {
        return String(verseId % CHAPTER_FACTOR);
      }
      return this.labelFor(verseId);
    };
  }

  /**
   * A full reference - "John 3:16", or "John 3:16-18" for a run within one
   * chapter. Plan entries need the book: "3:16" is ambiguous in a list, and
   * the reference parser cannot read it back. Falls back to `labelFor` when
   * the book name is unknown.
   */
  private referenceFor(startVerseId: number, endVerseId = startVerseId): string {
    const label = this.labelFor(startVerseId);
    const range = endVerseId === startVerseId ? label : `${label}-${endVerseId % CHAPTER_FACTOR}`;
    const book = this.verseIdEncodingTrusted
      ? this.bookNames.get(Math.floor(startVerseId / BOOK_FACTOR))
      : undefined;
    return book ? `${book} ${range}` : range;
  }

  private async getBookCatalog(): Promise<BibleBookDto[]> {
    if (!this.bookCatalogCache) this.bookCatalogCache = await this.host.bible.listBooks();
    return this.bookCatalogCache;
  }

  private async getChaptersCached(bookNumber: number): Promise<BibleChapterDto[]> {
    const cached = this.chaptersCache.get(bookNumber);
    if (cached) return cached;
    const chapters = await this.host.bible.listChapters(bookNumber);
    this.chaptersCache.set(bookNumber, chapters);
    return chapters;
  }

  /**
   * The book/chapter/verse each of `verses` actually is, off the same trusted
   * verse-id encoding `labelFor` uses. Pure arithmetic, no host call - see
   * `session.ts#SessionOpts.referencePoints` for why `refmatch` needs this
   * rather than parsing `VerseText.label` back (which can be a bare verse
   * number for a single-chapter passage).
   */
  private referencePointsFor(verses: VerseText[]): ReferencePoint[] {
    return verses.map((v) => ({
      bookNumber: Math.floor(v.verseId / BOOK_FACTOR),
      chapter: Math.floor((v.verseId % BOOK_FACTOR) / CHAPTER_FACTOR),
      verse: v.verseId % CHAPTER_FACTOR,
    }));
  }

  /**
   * Build the pre-fetched distractor pool `refmatch` needs for one tier.
   *
   * Tier 2 (same book) only ever needs the correct verse's own book - one
   * `listChapters` call, cached forever after. Tiers 0/1 sample a bounded set
   * of candidate books (any book / same genre) and fetch each one's chapters,
   * also cached, so repeated sessions on the same tier cost nothing further.
   */
  private async buildReferenceCatalog(
    correctBookNumber: number,
    tier: number,
    rng: () => number,
  ): Promise<ReferenceCatalog> {
    const books = await this.getBookCatalog();
    const bookNames: Record<number, string> = {};
    for (const b of books) {
      if (typeof b.name === 'string') bookNames[b.bookNumber] = b.name;
    }

    let candidates: BibleBookDto[];
    if (tier >= 2) {
      candidates = books.filter((b) => b.bookNumber === correctBookNumber);
    } else if (tier === 1) {
      const genre = BOOK_GENRE[correctBookNumber];
      candidates = shuffledBooks(
        books.filter((b) => BOOK_GENRE[b.bookNumber] === genre),
        rng,
      ).slice(0, REFERENCE_POOL_BOOKS);
    } else {
      candidates = shuffledBooks(books, rng).slice(0, REFERENCE_POOL_BOOKS);
    }
    // The correct book is always fetched, tier 2 or not: without it a step
    // could not even format its OWN correct answer's chapter/verse bounds.
    if (!candidates.some((b) => b.bookNumber === correctBookNumber)) {
      const correctBook = books.find((b) => b.bookNumber === correctBookNumber);
      if (correctBook) candidates = [correctBook, ...candidates];
    }

    const chapters: Record<number, { chapter: number; verseCount: number }[]> = {};
    for (const book of candidates) {
      const list = await this.getChaptersCached(book.bookNumber);
      chapters[book.bookNumber] = list.map((c) => ({
        chapter: c.chapter,
        verseCount: c.verseCount,
      }));
    }

    return {
      books: books.map((b) => ({ bookNumber: b.bookNumber, chapterCount: b.chapterCount })),
      chapters,
      bookNames,
    };
  }

  // -------------------------------------------------------------------------
  // Start-up
  // -------------------------------------------------------------------------

  /**
   * One-time, idempotent upgrade: a database created before T5 has exactly one
   * collection, still named the old default `'My plan'`. Rename it to
   * `'Default'` so it reads correctly under the new naming.
   *
   * Guarded on BOTH "exactly one list" and "still literally named the old
   * default" so this can never fire a second time (the name will not match
   * once it has been renamed) and never fires wrongly once the user has
   * created a second list or renamed the first one themselves - either of
   * which is a deliberate choice this upgrade must not undo.
   */
  private async renameLegacyDefaultCollection(): Promise<void> {
    const collections = await this.store.listCollections();
    if (collections.length !== 1) return;
    if (collections[0]!.name !== LEGACY_DEFAULT_COLLECTION_NAME) return;
    await this.store.renameCollection(collections[0]!.id, DEFAULT_COLLECTION_NAME);
  }

  /**
   * Check the verse-id arithmetic against data the host computed.
   *
   * John is book 43; if `listChapters` says chapter 3 starts at 43003001 then
   * the encoding holds. A mismatch is logged loudly and downgrades every label
   * to a bare id, which is ugly but honest - a wrong chapter:verse in the
   * margin of a memorisation exercise would actively teach the user the wrong
   * address.
   */
  private async verifyVerseIdEncoding(): Promise<void> {
    try {
      const chapters = await this.host.bible.listChapters(43);
      const third = chapters.find((c) => c.chapter === 3);
      if (!third) return;
      const expected = 43 * BOOK_FACTOR + 3 * CHAPTER_FACTOR + 1;
      if (third.firstVerseId !== expected) {
        this.verseIdEncodingTrusted = false;
        this.log.warn(
          `Scripture Memory: verse id encoding changed (expected ${expected}, ` +
            `host says ${third.firstVerseId}); verse labels disabled.`,
        );
      }
    } catch (err) {
      this.verseIdEncodingTrusted = false;
      this.log.warn('Scripture Memory: could not verify verse id encoding:', err);
    }
  }

  /**
   * Load book names for `referenceFor`. Best effort: without them references
   * degrade to "3:16", which is what they were before names were available.
   */
  private async loadBookNames(): Promise<void> {
    try {
      const books = await this.host.bible.listBooks();
      // `name` is a LocalizedString. The host sends plain strings; the other
      // form is a catalog key the service cannot resolve, so it is skipped
      // rather than shown raw.
      this.bookNames = new Map(
        books.flatMap((b) => (typeof b.name === 'string' ? [[b.bookNumber, b.name] as const] : [])),
      );
    } catch (err) {
      this.log.warn('Scripture Memory: could not load book names:', err);
    }
  }

  /**
   * The Default list's id right now, without creating anything - for display
   * purposes only (`buildPlanView`'s `collectionId` field). `undefined` when
   * no list is named `'Default'` (the user renamed or deleted it); callers
   * that need a real target to write into use `resolveAddTargetCollectionId`,
   * which creates one if it has to.
   */
  private findDefaultListId(lists: { id: number; name: string }[]): number | undefined {
    return lists.find((c) => c.name === DEFAULT_COLLECTION_NAME)?.id;
  }

  /**
   * Where `addPassage` should land right now: the currently scoped list, or -
   * scope `'all'` - the Default list, created fresh if something has deleted
   * it since start.
   */
  private async resolveAddTargetCollectionId(): Promise<number> {
    const scope = await this.store.getScope();
    if (scope.kind === 'list') return scope.id;

    const lists = await this.store.listCollections();
    const existing = this.findDefaultListId(lists);
    if (existing !== undefined) return existing;
    const created = await this.store.createCollection(DEFAULT_COLLECTION_NAME, this.now());
    return created.id;
  }

  // -------------------------------------------------------------------------
  // Pushes and status
  // -------------------------------------------------------------------------

  /**
   * Tell the UI the plan changed, and let push cards recompute which
   * reminders to hand the host (the plan, the due dates or the lists moved).
   */
  private planChanged(): void {
    this.emit({ type: 'planChanged' });
    this.push?.requestRecompute('plan');
  }

  private notice(message: string): void {
    this.emit({ type: 'notice', message });
  }

  private async computeStatus(): Promise<MemoryStatus> {
    // Global on purpose: the status is a system-wide reminder, not a
    // reflection of whatever list the UI has scoped right now - and the app
    // need not even be open for it to matter.
    const due = await this.store.dueCount({ kind: 'all' }, this.now());
    const waiting = this.push ? await this.push.waitingCount() : 0;
    return { due, waiting };
  }

  /**
   * Emit the status (and the old `dueCountChanged` push) when it changed.
   * `lastStatus` guards the churn so a no-op refresh does not repeat itself on
   * every scheduling tick.
   */
  private async refreshStatus(): Promise<void> {
    const status = await this.computeStatus();
    const last = this.lastStatus;
    if (last && last.due === status.due && last.waiting === status.waiting) return;

    this.lastStatus = status;
    this.emit({ type: 'status', status });
    this.emit({ type: 'dueCountChanged', count: status.due });
  }

  // -------------------------------------------------------------------------
  // Requests
  // -------------------------------------------------------------------------

  /**
   * Run one request. Failures are rethrown untouched (their message is meant
   * for the user - "that reference does not parse"); anything that is not a
   * plain reference problem is also logged, as the old dispatch did.
   */
  private async guard<T>(type: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (!(err instanceof ReferenceError)) {
        this.log.warn(`Scripture Memory: ${type} failed:`, err);
      }
      throw err;
    }
  }

  getPlan(): Promise<PlanView> {
    return this.guard('getPlan', () => this.buildPlanView());
  }

  getAnalytics(): Promise<RequestMap['getAnalytics']> {
    return this.guard('getAnalytics', async () =>
      this.store.analytics(await this.store.getScope(), this.now()),
    );
  }

  getSettings(): Promise<RequestMap['getSettings']> {
    return this.guard('getSettings', async () => ({
      defaultAnswerMode: await this.store.getDefaultAnswerMode(),
      recite: await this.getRecite().getSettings(),
      speech: await this.getRecite().probe(true),
    }));
  }

  setPassageSortOrder(args: Req<'setPassageSortOrder'>): Promise<Record<string, never>> {
    return this.guard('setPassageSortOrder', async () => {
      await this.store.setPassageSortOrder(args.order);
      this.planChanged();
      return {};
    });
  }

  setDefaultAnswerMode(args: Req<'setDefaultAnswerMode'>): Promise<Record<string, never>> {
    return this.guard('setDefaultAnswerMode', async () => {
      await this.store.setDefaultAnswerMode(args.mode);
      this.planChanged();
      return {};
    });
  }

  setPassageAnswerMode(args: Req<'setPassageAnswerMode'>): Promise<Record<string, never>> {
    return this.guard('setPassageAnswerMode', async () => {
      await this.store.setPassageAnswerMode(args.passageId, args.mode);
      this.planChanged();
      return {};
    });
  }

  getContext(args: Req<'getContext'>): Promise<PassageContext> {
    return this.guard('getContext', () => this.buildContext(args.passageId, { withholdAfter: false }));
  }

  addPassage(args: Req<'addPassage'>): Promise<{ passage: Passage }> {
    return this.guard('addPassage', async () => {
      const passage = await this.addPassageFromReference(args.reference);
      return { passage };
    });
  }

  removePassage(args: Req<'removePassage'>): Promise<Record<string, never>> {
    return this.guard('removePassage', async () => {
      await this.store.removePassage(args.passageId, this.now());
      await this.refreshStatus();
      return {};
    });
  }

  resetPassageProgress(args: Req<'resetPassageProgress'>): Promise<PlanView> {
    return this.guard('resetPassageProgress', async () => {
      // The only action that can lower a level. `now()` is the reset
      // boundary and attempts are compared strictly against it, so a session
      // finishing in the same millisecond belongs to the run being discarded
      // - see `store.ts#listTierProgress`.
      await this.store.resetPassageProgress(args.passageId, this.now());
      await this.refreshStatus();
      this.planChanged();
      // Unlike `removePassage`, the reply carries the rebuilt plan: the
      // screen that asked is showing the levels that just changed, and
      // waiting for the push to come round would flash the old ones.
      return this.buildPlanView();
    });
  }

  startSession(args: Req<'startSession'>): Promise<RequestMap['startSession']> {
    return this.guard('startSession', () =>
      this.startSessionImpl(args.passageId, args.rung, args.restart ?? false, args.tier),
    );
  }

  submitStep(args: Req<'submitStep'>): Promise<RequestMap['submitStep']> {
    return this.guard('submitStep', () => this.submitStepImpl(args.sessionId, args.answer));
  }

  endSession(args: Req<'endSession'>): Promise<RequestMap['endSession']> {
    return this.guard('endSession', async () => {
      // Abandoning a session records nothing beyond the resume point already
      // on disk. A user who closes the app halfway through has not
      // demonstrated anything, and writing a partial score would punish them
      // for stopping.
      this.sessions.delete(args.sessionId);
      this.sessionStartedAt.delete(args.sessionId);
      return { summary: null };
    });
  }

  navigateTo(args: Req<'navigateTo'>): Promise<Record<string, never>> {
    return this.guard('navigateTo', async () => {
      await this.host.bible.navigateToVerse(args.verseId);
      return {};
    });
  }

  getPassageView(args: Req<'getPassageView'>): Promise<PassageView> {
    return this.guard('getPassageView', () => this.buildPassageView(args.passageId));
  }

  createList(args: Req<'createList'>): Promise<PlanView> {
    return this.guard('createList', async () => {
      await this.store.createCollection(args.name, this.now());
      this.planChanged();
      return this.buildPlanView();
    });
  }

  renameList(args: Req<'renameList'>): Promise<PlanView> {
    return this.guard('renameList', async () => {
      await this.store.renameCollection(args.id, args.name);
      this.planChanged();
      return this.buildPlanView();
    });
  }

  deleteList(args: Req<'deleteList'>): Promise<PlanView> {
    return this.guard('deleteList', async () => {
      // Throws a readable error (and touches nothing) when `args.id` is the
      // only list - see `store.ts#deleteCollection`. Passages, cards and
      // attempt history all move to `movePassagesTo` first.
      await this.store.deleteCollection(args.id, args.movePassagesTo);
      await this.refreshStatus();
      this.planChanged();
      return this.buildPlanView();
    });
  }

  getListPracticeStats(args: Req<'getListPracticeStats'>): Promise<{ total: number; practiced: number }> {
    return this.guard('getListPracticeStats', () => this.store.listPracticeStats(args.id));
  }

  movePassage(args: Req<'movePassage'>): Promise<PlanView> {
    return this.guard('movePassage', async () => {
      await this.store.movePassage(args.passageId, args.collectionId);
      await this.refreshStatus();
      this.planChanged();
      return this.buildPlanView();
    });
  }

  setScope(args: Req<'setScope'>): Promise<PlanView> {
    return this.guard('setScope', async () => {
      await this.store.setScope(args.scope);
      this.planChanged();
      return this.buildPlanView();
    });
  }

  startRecite(args: Req<'startRecite'>): Promise<ReciteStateView> {
    return this.guard('startRecite', () => this.getRecite().start({ source: args.source, mode: args.mode }));
  }

  reciteControl(args: Req<'reciteControl'>): Promise<ReciteStateView> {
    return this.guard('reciteControl', async () =>
      this.getRecite().control({ reciteId: args.reciteId, action: args.action }),
    );
  }

  getReciteState(): Promise<ReciteStateView | null> {
    return this.guard('getReciteState', async () => this.getRecite().get());
  }

  setReciteSettings(args: Req<'setReciteSettings'>): Promise<Record<string, never>> {
    return this.guard('setReciteSettings', async () => {
      await this.getRecite().setSettings(args.patch);
      this.planChanged();
      return {};
    });
  }

  setPassageRecite(args: Req<'setPassageRecite'>): Promise<PassageView> {
    return this.guard('setPassageRecite', async () => {
      await this.store.setPassageReciteOn(args.passageId, args.on);
      this.planChanged();
      return this.buildPassageView(args.passageId);
    });
  }

  openHostSettings(): Promise<Record<string, never>> {
    return this.guard('openHostSettings', async () => {
      await this.opts.openSettings?.();
      return {};
    });
  }

  deleteReciteHistory(): Promise<Record<string, never>> {
    return this.guard('deleteReciteHistory', async () => {
      await this.getRecite().deleteHistory();
      return {};
    });
  }

  getPushSettings(): Promise<RequestMap['getPushSettings']> {
    return this.guard('getPushSettings', async () => this.requirePush().getSettingsView());
  }

  setPushSettings(args: Req<'setPushSettings'>): Promise<RequestMap['setPushSettings']> {
    return this.guard('setPushSettings', async () => this.requirePush().setSettings(args.settings));
  }

  requestReminderPermission(): Promise<RequestMap['requestReminderPermission']> {
    return this.guard('requestReminderPermission', async () => this.requirePush().requestPermission());
  }

  getCardStack(): Promise<RequestMap['getCardStack']> {
    return this.guard('getCardStack', async () => this.requirePush().getStack());
  }

  gradeRecall(args: Req<'gradeRecall'>): Promise<RequestMap['gradeRecall']> {
    return this.guard('gradeRecall', async () => this.requirePush().grade(args));
  }

  snoozeCard(args: Req<'snoozeCard'>): Promise<RequestMap['snoozeCard']> {
    return this.guard('snoozeCard', async () => this.requirePush().snooze(args));
  }

  consumeLaunchIntent(): Promise<RequestMap['consumeLaunchIntent']> {
    return this.guard('consumeLaunchIntent', async () =>
      this.push ? this.push.consumeLaunchIntent() : { showCard: false },
    );
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  async practiceDue(): Promise<{ due: boolean }> {
    // Same global choice as `refreshStatus`: this is reached from the palette
    // or the status item, neither of which is scoped to one list.
    const next = await this.store.nextDueCard({ kind: 'all' }, this.now());
    if (!next) {
      this.notice(tc('memory.core.nothingDue', 'Nothing is due right now.'));
      return { due: false };
    }
    await this.opts.openApp?.();
    this.planChanged();
    return { due: true };
  }

  async practiceDueAloud(): Promise<{ started: boolean }> {
    const svc = this.getRecite();
    const availability = await svc.probe(true);
    if (availability.state !== 'ready') {
      this.notice(unavailableMessage(availability));
      return { started: false };
    }
    if ((await this.store.reciteDueCount(await this.store.getScope(), this.now())) === 0) {
      this.notice(tc('memory.core.nothingDueToRecite', 'Nothing is due to recite right now.'));
      return { started: false };
    }
    // Hands-free needs `speech:speak`; without it fall back to tap (Talk button).
    await svc.start({ source: { kind: 'due' }, mode: availability.handsFree ? 'handsfree' : 'tap' });
    await this.opts.openApp?.();
    const state = svc.get();
    if (state) this.pushReciteState(state);
    this.planChanged();
    return { started: true };
  }

  async addVerses(args: {
    verseIds: readonly number[];
    module?: string;
  }): Promise<{ outcome: AddVersesOutcome; passageId: number }> {
    // The verses the user selected, which need not be the reader's active
    // verse: a contiguous run within one chapter becomes one passage,
    // anything else just its first verse.
    const picked = versesFromMenuArgs(args);
    if (!picked) throw new Error(tc('memory.core.selectVerseFirst', 'Select a verse first, then add it to your plan.'));
    return this.addPassageFromVerseId(picked.start, picked.end, picked.module);
  }

  async getStatus(): Promise<MemoryStatus> {
    return this.computeStatus();
  }

  async getImportStatus(): Promise<MemoryImportStatus> {
    const sourceAvailable = this.opts.legacy?.available() ?? false;
    const row = await this.sql.queryOne<{ status: string; recorded_at: number; counts: string | null }>(
      `SELECT status, recorded_at, counts FROM memory_import WHERE source = ?`,
      [LEGACY_SOURCE_KEY],
    );
    if (!row) return { status: null, recordedAt: null, counts: null, sourceAvailable };
    let counts: Record<string, number> | null = null;
    if (row.counts) {
      try {
        counts = JSON.parse(row.counts) as Record<string, number>;
      } catch {
        counts = null;
      }
    }
    return { status: row.status, recordedAt: row.recorded_at, counts, sourceAvailable };
  }

  async importLegacyData(): Promise<MemoryImportResult> {
    return this.guard('importLegacyData', async () => {
      const legacy = this.opts.legacy;
      if (!legacy || !legacy.available()) {
        throw new Error(tc('memory.core.noLegacyData', 'There is no Scripture Memory extension data on this computer to import.'));
      }
      const result = await legacy.merge();
      if (result.status === 'merged') {
        await this.refreshStatus();
        this.planChanged();
      }
      return result;
    });
  }

  // -------------------------------------------------------------------------
  // Recite aloud
  // -------------------------------------------------------------------------

  private pushReciteState(state: ReciteStateView): void {
    try {
      this.emit({ type: 'reciteState', state });
    } catch {
      /* fire-and-forget */
    }
  }

  /** The recite service, built on first use. `host.speech` may be missing. */
  private getRecite(): ReciteService {
    if (this.recite) return this.recite;
    this.recite = new ReciteService({
      store: this.store,
      speech: this.host.speech,
      now: this.now,
      rng: this.rng,
      bibleModuleLanguage: (id) => this.moduleLanguageSafe(id),
      loadVerses: (passage) =>
        this.fetchVerses(
          passage.startVerseId,
          passage.endVerseId,
          passage.moduleId,
          this.makeLabeller(passage.startVerseId, passage.endVerseId),
        ),
      bookNames: () => Array.from(this.bookNames.values()),
      recordAndSchedule: (a) => this.recordAndSchedule(a),
      push: (state) => this.pushReciteState(state),
    });
    return this.recite;
  }

  private async moduleLanguageSafe(moduleId: string): Promise<string | undefined> {
    try {
      return await moduleLanguage({ bible: this.host.bible }, moduleId);
    } catch {
      return undefined;
    }
  }

  /** Whether the recite rung applies to a passage: listening is usable and a kit exists for its language. */
  private async speechOnFor(availability: SpeechAvailability, moduleId: string): Promise<boolean> {
    if (availability.state !== 'ready' && availability.state !== 'needs-download') return false;
    try {
      return (await moduleKit({ bible: this.host.bible }, moduleId)) !== null;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Views
  // -------------------------------------------------------------------------

  /**
   * One passage's ladder, as both the plan list and the passage screen need it.
   *
   * Factored out of `buildPlanView` so `getPassageView` can build a single
   * passage's view (`buildPassageView`) without fetching every other passage in
   * the plan to get there - the whole point of that request existing (see
   * `types.ts#RequestMap.getPassageView`).
   */
  private async assemblePassageView(
    passage: Passage,
    cards: Card[],
    tierRows: Map<number, TierProgressRow[]>,
    scope: ScopeFacts,
    now: number,
    availability: SpeechAvailability,
  ): Promise<PassageView> {
    const applicable = new Set(
      applicableRungs(passage.verseCount, scope.siblingCount, scope.scopeVerseCount, {
        speech: await this.speechOnFor(availability, passage.moduleId),
      }),
    );
    const rungs: RungView[] = [];
    let bestLevel = 0;
    let dueCount = 0;

    for (const c of cards) {
      const isApplicable = applicable.has(c.rung);
      // The level is derived from per-tier bests over the whole history, not
      // from `c.lastScore`. That is what makes it non-regressing: a bad
      // session below still moves `dueAt` closer without moving this number.
      const progress = summarizeActivity(c.rung, tierRows.get(c.id) ?? []);
      const level = levelForActivity(progress);
      const optional = isOptionalRung(c.rung);
      // Optional rungs (recite) never count toward the plan's due count; a real
      // recitation still raises `bestLevel`, even when the rung is not applicable
      // right now (no microphone today), as it carries down to the text rungs.
      if (isApplicable || (optional && progress.attempts > 0)) {
        bestLevel = Math.max(bestLevel, level);
      }
      if (isApplicable && !optional && isDue(c.dueAt, now)) dueCount += 1;

      // `totalStepsFor` needs the resume row's OWN tier, not the tier a fresh
      // session would auto-select: `blanks` has a different step count per
      // tier, so sizing this against today's suggested tier could make a
      // perfectly valid tier-0 resume point read as "past the end" (or vice
      // versa) the moment `nextTier` moves on.
      const resumeRow = await this.store.getResume(c.id);
      const totalSteps = totalStepsFor(c.rung, passage.verseCount, resumeRow?.tier ?? 0);
      const resume =
        resumeRow && resumeRow.cursor > 0 && resumeRow.cursor < totalSteps
          ? { stepsDone: resumeRow.cursor, totalSteps }
          : null;

      rungs.push({
        rung: c.rung,
        level,
        dueAt: c.dueAt,
        streak: c.streak,
        lastScore: c.lastScore,
        applicable: isApplicable,
        resume,
        tiers: progress.totalTiers,
        tiersPassed: progress.tiersPassed,
        bestScore: progress.bestScore,
        attempts: progress.attempts,
        nextTier: progress.nextTier,
        ...(optional ? { optional: true as const } : {}),
      });
    }

    return {
      passage,
      rungs: inRungOrder(rungs),
      dueCount,
      bestLevel,
      // Not `bestLevel >= 4` any more: every applicable activity has to be
      // satisfied, and an empty applicable set is never satisfied - see
      // `PassageView.wellLearned`.
      wellLearned: passageWellLearned(rungs),
    };
  }

  private requirePush(): PushController {
    if (!this.push) throw new Error(tc('memory.core.cardsUnavailable', 'Memory cards are not available right now.'));
    return this.push;
  }

  private async buildPlanView(): Promise<PlanView> {
    const now = this.now();
    const scope = await this.store.getScope();
    const passages = await this.store.listPassagesInScope(scope);
    const scopeFacts = scopeOf(passages);
    // One query for the whole plan's attempt history, reduced in SQL. A plan of
    // thirty passages is ~150 cards, and every one of their levels is needed to
    // draw the list.
    const tierRows = byCard(await this.store.listTierProgress(passages.map((p) => p.id)));
    const views: PassageView[] = [];
    let totalDue = 0;
    const speech = await this.getRecite().probe();

    for (const passage of passages) {
      const cards = await this.store.listCards(passage.id);
      const view = await this.assemblePassageView(passage, cards, tierRows, scopeFacts, now, speech);
      totalDue += view.dueCount;
      views.push(view);
    }

    const lists = await this.store.listCollections();
    const scopedListId = scope.kind === 'list' ? scope.id : this.findDefaultListId(lists);
    const scopedList = scopedListId !== undefined ? lists.find((l) => l.id === scopedListId) : undefined;

    return {
      cardsWaiting: this.push ? await this.push.waitingCount() : 0,
      // The list `addPassage` would target right now - see the field's own doc
      // comment in `types.ts` for why this is kept rather than dropped.
      collectionId: scopedListId ?? this.defaultCollectionId,
      collectionName: scopedList ? scopedList.name : tc('memory.core.allLists', 'All lists'),
      lists,
      scope: scope.kind === 'all' ? 'all' : scope.id,
      scopeVerseCount: scopeFacts.scopeVerseCount,
      referenceActivitiesUnlocked: scopeFacts.scopeVerseCount >= MIN_VERSES_FOR_REFERENCE_ACTIVITIES,
      passages: views,
      totalDue,
      defaultAnswerMode: await this.store.getDefaultAnswerMode(),
      sortOrder: await this.store.getPassageSortOrder(),
      speech,
      reciteDueCount: await this.store.reciteDueCount(scope, now),
    };
  }

  /**
   * One passage's view on its own, for `getPassageView` - without rebuilding
   * the whole plan just to find one row in it, the inefficiency the request
   * was added to avoid.
   *
   * Scoped to the passage's OWN list, not the UI's current browsing scope:
   * a passage's applicable activities are a property of the list it actually
   * belongs to (D2(i) - a passage lives in exactly one list), not of whatever
   * the plan list happens to be filtered to when this is requested.
   */
  private async buildPassageView(passageId: number): Promise<PassageView> {
    const passage = await this.store.getPassage(passageId);
    if (!passage) throw new Error(tc('memory.core.passageGone', 'That passage is no longer in your plan.'));

    const siblings = await this.store.listPassages(passage.collectionId);
    const scopeFacts = scopeOf(siblings);
    const cards = await this.store.listCards(passage.id);
    const tierRows = byCard(await this.store.listTierProgress([passage.id]));

    return this.assemblePassageView(
      passage,
      cards,
      tierRows,
      scopeFacts,
      this.now(),
      await this.getRecite().probe(),
    );
  }

  /**
   * Fetch a passage and the verses around it.
   *
   * `withholdAfter` is the one place the "context is real text" decision needs a
   * caveat. Rendering the surrounding verses as actual scripture is right - it
   * is what the user asked for, and it is how the passage is really encountered
   * - but during an exercise the verses *after* the working point are the
   * answer. The ordering picker would be trivially solvable by reading ahead. So
   * they are withheld by the service rather than merely hidden by the UI: a UI
   * that never receives them cannot leak them through a stylesheet.
   */
  private async buildContext(
    passageId: number,
    opts: { withholdAfter: boolean },
  ): Promise<PassageContext> {
    const passage = await this.store.getPassage(passageId);
    if (!passage) throw new Error(tc('memory.core.passageGone', 'That passage is no longer in your plan.'));

    const label = this.makeLabeller(passage.startVerseId, passage.endVerseId);

    const verses = await this.fetchVerses(passage.startVerseId, passage.endVerseId, passage.moduleId, label);

    const before = await this.fetchVersesSafely(
      passage.startVerseId - CONTEXT_VERSES,
      passage.startVerseId - 1,
      passage.moduleId,
      label,
    );

    const after = opts.withholdAfter
      ? []
      : await this.fetchVersesSafely(
          passage.endVerseId + 1,
          passage.endVerseId + CONTEXT_VERSES,
          passage.moduleId,
          label,
        );

    return { passageId, reference: passage.reference, before, verses, after };
  }

  private async fetchVerses(
    start: number,
    end: number,
    moduleId: string,
    label: (verseId: number) => string = (id) => this.labelFor(id),
  ): Promise<VerseText[]> {
    const dtos = await this.host.bible.getRange(start, end, { module: moduleId });
    return dtos.map((d: BibleVerseDto) => toVerseText(d, label(d.verseId)));
  }

  /**
   * Fetch context verses, tolerating a range that runs off the end of a book.
   *
   * A passage at a book boundary has no neighbours, and the host is entitled to
   * refuse the range rather than return fewer verses. Missing context is a
   * cosmetic loss; a thrown error here would take out the whole practice view.
   */
  private async fetchVersesSafely(
    start: number,
    end: number,
    moduleId: string,
    label: (verseId: number) => string = (id) => this.labelFor(id),
  ): Promise<VerseText[]> {
    if (end < start) return [];
    try {
      return await this.fetchVerses(start, end, moduleId, label);
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Adding passages
  // -------------------------------------------------------------------------

  /**
   * The module new passages are recorded against: `preferred` (the reader's
   * translation, when the caller says), else `preferredModule`, falling back
   * to the first installed module when neither is known.
   *
   * Returns the abbreviation rather than `id`. Both resolve in `getRange` on
   * current hosts, but earlier hosts resolve only the abbreviation - their `id`
   * was a registry row number that read back as an empty range.
   */
  private async activeModuleId(preferred: string | null | undefined = this.preferredModule): Promise<string> {
    const modules = await this.host.bible.listModules();
    const match = preferred
      ? modules.find((m) => m.abbreviation === preferred || m.id === preferred)
      : undefined;
    const chosen = match ?? modules[0];
    if (!chosen) throw new Error(tc('memory.core.noBibleModule', 'No Bible module is installed.'));
    return chosen.abbreviation;
  }

  private async addPassageFromReference(reference: string): Promise<Passage> {
    const moduleId = await this.activeModuleId();
    const resolved = await resolveReference(this.host, reference, moduleId);
    const now = this.now();
    const targetCollectionId = await this.resolveAddTargetCollectionId();

    const { passage, created, revived } = await this.store.addPassage({
      collectionId: targetCollectionId,
      moduleId,
      startVerseId: resolved.startVerseId,
      endVerseId: resolved.endVerseId,
      reference: resolved.reference,
      verseCount: resolved.verseCount,
      addedAt: now,
    });

    if (created || revived) await this.refreshStatus();
    this.planChanged();
    return passage;
  }

  /** The reader path: add whatever verse (or run) the user selected. */
  private async addPassageFromVerseId(
    startVerseId: number,
    endVerseId = startVerseId,
    preferredModule?: string,
  ): Promise<{ outcome: AddVersesOutcome; passageId: number }> {
    const moduleId = await this.activeModuleId(preferredModule ?? this.preferredModule);
    const now = this.now();
    const targetCollectionId = await this.resolveAddTargetCollectionId();

    const { passage, created, revived } = await this.store.addPassage({
      collectionId: targetCollectionId,
      moduleId,
      startVerseId,
      endVerseId,
      reference: this.referenceFor(startVerseId, endVerseId),
      verseCount: endVerseId - startVerseId + 1,
      addedAt: now,
    });

    await this.refreshStatus();
    this.planChanged();
    this.notice(
      created
        ? tc('memory.core.noticeAdded', 'Added to your memorization plan.')
        : revived
          ? tc('memory.core.noticeRestored', 'Restored to your memorization plan with its progress.')
          : tc('memory.core.noticeAlreadyInPlan', 'That verse is already in your plan.'),
    );
    return { outcome: created ? 'added' : revived ? 'revived' : 'exists', passageId: passage.id };
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  /**
   * Start practising one rung of one passage.
   *
   * `rung` is used to start a specific activity (the passage screen's own
   * buttons always pass one); when omitted - "Start practicing" on the home
   * screen for a passage it has already chosen - `suggestedRungForPassage`
   * picks the same activity the passage screen would badge "Suggested".
   *
   * There is no more `replay` distinction: nothing is locked, so every attempt
   * here is a live one and reschedules its card in `finishSession`.
   */
  private async startSessionImpl(
    passageId: number,
    rung: Rung | undefined,
    restart: boolean,
    tier?: number,
  ) {
    const passage = await this.store.getPassage(passageId);
    if (!passage) throw new Error(tc('memory.core.passageGone', 'That passage is no longer in your plan.'));

    // The passage's own list, not the UI's current browsing scope - see
    // `buildPassageView`'s doc comment for why applicability is anchored to a
    // passage's actual list (D2(i)) rather than to whatever is being viewed.
    const all = await this.store.listPassages(passage.collectionId);
    const scope = scopeOf(all);
    const applicable = applicableRungs(
      passage.verseCount,
      scope.siblingCount,
      scope.scopeVerseCount,
    );
    if (rung === 'recite') {
      throw new Error('Recite aloud is not a practice session; use startRecite.');
    }

    const now = this.now();
    const chosen = rung ?? (await this.suggestedRungForPassage(passage, applicable, now));
    if (!applicable.includes(chosen)) {
      throw new Error(tc('memory.core.exerciseNotApplicable', 'That exercise does not apply to this passage.'));
    }

    const card = await this.store.getCard(passageId, chosen);
    if (!card) throw new Error(tc('memory.core.exerciseNotSetUp', 'That exercise has not been set up for this passage.'));

    // Resolved decision D4: omitted, serve the lowest tier not yet passed (or
    // the hardest tier once every tier has been passed) - the same computation
    // `RungView.nextTier` exposes for display, via the same `summarizeActivity`
    // helper. Given explicitly, the tier is validated rather than clamped: a
    // stale or malicious request for a tier that does not exist gets a
    // readable error, not a silently different exercise.
    const totalTiers = TIERS[chosen];
    let selectedTier: number;
    if (tier !== undefined) {
      if (!Number.isInteger(tier) || tier < 0 || tier >= totalTiers) {
        throw new Error(
          totalTiers === 1
            ? tc('memory.core.tierMissingOne', 'That difficulty tier does not exist for this exercise (it has {count} tier).', { count: totalTiers })
            : tc('memory.core.tierMissingMany', 'That difficulty tier does not exist for this exercise (it has {count} tiers).', { count: totalTiers }),
        );
      }
      selectedTier = tier;
    } else {
      const tierRows = byCard(await this.store.listTierProgress([passageId]));
      selectedTier = summarizeActivity(chosen, tierRows.get(card.id) ?? []).nextTier;
    }

    if (restart) await this.store.clearResume(card.id);
    let resumeRow = restart ? undefined : await this.store.getResume(card.id);
    // A resume point taken at a different tier cannot be reapplied here: tiers
    // can have different step counts and different candidate sets (`ordering`,
    // `blanks`), so its `cursor` would either be misinterpreted or point past
    // an activity that no longer has that many steps. Switching tier drops the
    // stale resume rather than misapplying it - the user restarts that tier's
    // activity from the top, same as an explicit `restart`.
    if (resumeRow && resumeRow.tier !== selectedTier) {
      await this.store.clearResume(card.id);
      resumeRow = undefined;
    }

    const verses = await this.fetchVerses(
      passage.startVerseId,
      passage.endVerseId,
      passage.moduleId,
      this.makeLabeller(passage.startVerseId, passage.endVerseId),
    );
    const answerMode: AnswerMode = passage.answerMode ?? (await this.store.getDefaultAnswerMode());

    // `refmatch` needs a pre-fetched distractor pool (see `buildReferenceCatalog`)
    // and a sanity check that the pool is not degenerate; `refprovide` needs the
    // host's own reference parser, injected rather than reached into directly so
    // grading stays inside `Session` alongside every other rung's grading. Both
    // are built here, in the service, from the service's own host access -
    // never something the UI could supply or fake.
    let referencePoints: ReferencePoint[] | undefined;
    let referenceCatalog: ReferenceCatalog | undefined;
    let parseReferenceFn: ((input: string) => Promise<ParsedReferenceDto | null>) | undefined;

    if (chosen === 'refmatch') {
      referencePoints = this.referencePointsFor(verses);
      const correctBook = referencePoints[0]?.bookNumber;
      if (correctBook === undefined) {
        throw new Error(tc('memory.core.noVersesToMatch', 'That passage has no verses to match a reference against.'));
      }
      referenceCatalog = await this.buildReferenceCatalog(
        correctBook,
        selectedTier,
        makeRng(now ^ passageId ^ 0x5eed),
      );
      // Item 4 of the task: `applicableRungs` cannot know how many distinct
      // references its own pool can generate (it has no host access), so the
      // floor it is gated on there is only a cheap proxy. This is the real
      // check, against the actual fetched pool, right before a session that
      // could not be answered meaningfully would otherwise be served.
      const sample = buildReferenceDistractors({
        correct: referencePoints[0] as ReferencePoint,
        tier: selectedTier,
        books: referenceCatalog.books,
        chapters: referenceCatalog.chapters,
        bookNames: referenceCatalog.bookNames,
        count: 3,
        rng: makeRng(now ^ passageId ^ 0xc0ffee),
      });
      if (sample.length < 3) {
        throw new Error(
          tc('memory.core.notEnoughReferences', 'Not enough distinct references are available for this exercise yet.'),
        );
      }
    } else if (chosen === 'refprovide') {
      parseReferenceFn = (input: string) => this.host.bible.parseReference(input);
    }

    const session = new Session({
      sessionId: nextSessionId(),
      passageId,
      cardId: card.id,
      rung: chosen,
      tier: selectedTier,
      verses,
      referencePoints,
      referenceCatalog,
      parseReference: parseReferenceFn,
      answerMode,
      rng: makeRng(now ^ passageId),
      resume: resumeRow
        ? {
            cursor: resumeRow.cursor,
            correctFirstUnits: resumeRow.correctFirst,
            gradedUnits: resumeRow.gradedUnits,
          }
        : undefined,
    });

    this.sessions.set(session.sessionId, session);
    this.sessionStartedAt.set(session.sessionId, now);
    return session.view();
  }

  /**
   * The activity a passage's own "Practice" / "Start practicing" button starts
   * when the caller has not named one: whichever applicable rung is due
   * soonest; failing that, the first applicable rung that has not reached
   * "well learned"; failing that (everything mastered), the hardest rung, as an
   * upkeep suggestion. This never returns nothing - unlike v0, there is no
   * "everything is locked or mastered" dead end.
   */
  private async suggestedRungForPassage(
    passage: Passage,
    applicable: Rung[],
    now: number,
  ): Promise<Rung> {
    let dueBest: { rung: Rung; dueAt: number } | null = null;
    const levels = new Map<Rung, number>();
    const tierRows = byCard(await this.store.listTierProgress([passage.id]));

    for (const rung of applicable) {
      if (isOptionalRung(rung)) continue; // recite is never suggested
      const card = await this.store.getCard(passage.id, rung);
      if (!card) continue;
      // The same derived level the plan screen shows. Reading `lastScore` here
      // instead would suggest an activity the user's own screen says is
      // finished, on the strength of one bad session.
      levels.set(rung, levelForActivity(summarizeActivity(rung, tierRows.get(card.id) ?? [])));
      if (isDue(card.dueAt, now) && (dueBest === null || (card.dueAt as number) < dueBest.dueAt)) {
        dueBest = { rung, dueAt: card.dueAt as number };
      }
    }
    if (dueBest) return dueBest.rung;

    const suggestible = applicable.filter((r) => !isOptionalRung(r));
    for (const rung of suggestible) {
      if ((levels.get(rung) ?? 0) < WELL_LEARNED_LEVEL) return rung;
    }
    return suggestible[suggestible.length - 1] as Rung;
  }

  private async submitStepImpl(sessionId: string, answer: StepAnswer) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(tc('memory.core.sessionEnded', 'That practice session has ended. Start it again.'));

    // `submit` is async because `refprovide` grades against a host round trip
    // (`bible.parseReference`) - see `session.ts#Session.submit`. A parse
    // failure thrown by the host is not caught here: it propagates to the
    // caller as a readable error without losing the session - the same path
    // every other error uses.
    const result = await session.submit(answer);
    let summary: SessionSummary | null = null;

    if (session.isFinished) {
      summary = await this.finishSession(session);
      this.sessions.delete(sessionId);
      this.sessionStartedAt.delete(sessionId);
    } else {
      // Written after each verse (or ordering placement), not on every
      // keystroke - see the `memory_resume_state` note in `schema.ts`.
      await this.store.saveResume(
        session.cardId,
        {
          cursor: session.cursorIndex,
          correctFirst: session.correctFirst,
          gradedUnits: session.gradedTotal,
          tier: session.tier,
        },
        this.now(),
      );
    }

    return { result, session: session.view(), summary };
  }

  /**
   * Record the attempt and reschedule.
   *
   * Every finished session reaches this now - there is no "was this a replay"
   * branch left. See the task 0004 review, point 4: nothing is locked, so there
   * is no "ahead of schedule" attempt left to treat specially.
   */
  private async finishSession(session: Session): Promise<SessionSummary> {
    const startedAt = this.sessionStartedAt.get(session.sessionId) ?? this.now();
    const rec = await this.recordAndSchedule({
      cardId: session.cardId,
      passageId: session.passageId,
      rung: session.rung,
      tier: session.tier,
      score: session.score,
      correctFirst: session.correctFirst,
      totalSteps: session.gradedTotal,
      startedAt,
    });

    return {
      passageId: session.passageId,
      rung: session.rung,
      tier: session.tier,
      tiers: TIERS[session.rung],
      score: session.score,
      correctFirst: session.correctFirst,
      totalSteps: session.gradedTotal,
      nextDueAt: rec.nextDueAt,
      level: rec.level,
      passageWellLearned: rec.passageWellLearned,
    };
  }

  /**
   * The one path every finished attempt takes, Session or recitation: record the
   * attempt, clear the resume point, reschedule the card, refresh the status
   * and tell the UI. Returns the attempt's id so a recitation can hang its
   * per-word detail on it.
   */
  private async recordAndSchedule(a: RecordAndScheduleArgs): Promise<RecordAndScheduleResult> {
    const now = this.now();

    const attemptId = await this.store.recordAttempt({
      cardId: a.cardId,
      at: now,
      score: a.score,
      correctFirst: a.correctFirst,
      totalSteps: a.totalSteps,
      durationMs: Math.max(0, now - a.startedAt),
      tier: a.tier,
    });
    await this.store.clearResume(a.cardId);

    const card = await this.store.getCard(a.passageId, a.rung);
    if (!card) throw new Error(tc('memory.core.exerciseDisappeared', 'That exercise disappeared mid-session.'));

    const result = schedule({
      intervalStep: card.intervalStep,
      streak: card.streak,
      score: a.score,
      now,
      rng: makeRng(now ^ card.id),
    });
    await this.store.applySchedule(card.id, result, a.score);

    await this.refreshStatus();
    this.planChanged();

    // Read back AFTER the attempt row was written, so the level reported here
    // is the same one the plan view will show a moment later.
    const tierRows = byCard(await this.store.listTierProgress([a.passageId]));
    const level = levelForActivity(summarizeActivity(a.rung, tierRows.get(card.id) ?? []));

    return {
      attemptId,
      level,
      nextDueAt: result.dueAt,
      passageWellLearned: await this.isPassageWellLearned(a.passageId),
    };
  }

  /**
   * Whether the passage is "well learned" - EVERY applicable activity
   * satisfied, over a non-empty set.
   *
   * This replaces v1's "the best applicable rung reached level 4". The old rule
   * let one mastered activity speak for activities the user had never opened;
   * the new one only lets a *harder* activity speak for an easier one, and only
   * inside the text-recall chain (`ladder.ts#TEXT_RECALL_CHAIN`), because
   * reciting a passage from first letters really does demonstrate the ordering
   * and the missing words, while knowing its words says nothing about knowing
   * its address.
   *
   * Called after the attempt has been recorded, so nothing needs to be passed
   * in about the session that just finished - it is already part of the
   * history this reads.
   */
  private async isPassageWellLearned(passageId: number): Promise<boolean> {
    const passage = await this.store.getPassage(passageId);
    if (!passage) return false;
    const scope = scopeOf(await this.store.listPassages(passage.collectionId));
    const cards = await this.store.listCards(passageId);
    const tierRows = byCard(await this.store.listTierProgress([passageId]));
    return passageWellLearned(activityLevels(passage, cards, tierRows, scope));
  }
}

/**
 * How many verses (or ordering placements) one pass through a rung takes.
 *
 * `tier` only matters for `blanks`: tier 1 is one step for the whole passage
 * regardless of `verseCount`, mirroring `Session#totalSteps` in `session.ts`.
 */
function totalStepsFor(rung: Rung, verseCount: number, tier = 0): number {
  if (rung === 'ordering') return Math.max(1, verseCount - 1);
  // One question per verse of the passage, capped - see `session.ts`'s
  // `MAX_REFERENCE_STEPS` and `Session#verseSteps`, which this mirrors.
  if (rung === 'refmatch' || rung === 'refprovide') {
    return Math.min(Math.max(1, verseCount), MAX_REFERENCE_STEPS);
  }
  if (rung === 'blanks' && tier >= 1) return 1;
  return verseCount;
}

/** Fisher-Yates over a `BibleBookDto[]`, using the session's own injected RNG. */
function shuffledBooks(books: BibleBookDto[], rng: () => number): BibleBookDto[] {
  const out = books.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i] as BibleBookDto;
    out[i] = out[j] as BibleBookDto;
    out[j] = a;
  }
  return out;
}
