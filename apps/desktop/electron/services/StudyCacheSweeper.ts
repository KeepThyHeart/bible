import log from 'electron-log';
import { getSharedBookRepo } from './sharedMainDb';
import { getStudyCacheService, type StudyCacheService } from './StudyCacheService';

/**
 * How long after `start()` the first chapter is computed.
 *
 * Startup is the one moment the main process is genuinely busy - window
 * creation, database opens, the renderer's first burst of IPC. The sweep is
 * worth nothing to a user in their first minute and would be actively harmful
 * there, so it simply is not running yet.
 */
const STARTUP_DELAY_MS = 60_000;

/**
 * Gap between chapters. Also the yield: the timer is a macrotask, so the event
 * loop drains every pending IPC reply, timer and I/O callback between units.
 *
 * At this rate the full 1,189-chapter canon takes about ten minutes of wall
 * clock while occupying the main thread for a few percent of it. Filling
 * faster would buy nothing - write-through already covers whatever the reader
 * opens, and the sweep exists only for chapters they have not opened yet.
 */
const CHAPTER_INTERVAL_MS = 500;

/**
 * Ceiling on the cache file.
 *
 * Measured: a full canon costs about 28 MB, and - because only `crossrefs` is
 * stored (see `CACHED_SECTIONS`) - that figure no longer scales with the number
 * of installed commentaries. The cap is therefore generous headroom rather than
 * a live constraint; it exists so that widening `CACHED_SECTIONS` later cannot
 * silently grow the file without bound. It stops the SWEEP only. Write-through
 * is never blocked by it, because a chapter the reader is looking at is worth
 * caching whatever the file currently weighs.
 */
const MAX_CACHE_BYTES = 256 * 1024 * 1024;

/** How often the size cap is re-checked (in chapters). `statSync` is not free. */
const SIZE_CHECK_EVERY = 25;

export interface SweeperOptions {
  startupDelayMs?: number;
  chapterIntervalMs?: number;
  maxCacheBytes?: number;
  /** Injectable for tests: the canon to walk, as `[bookNumber, chapterCount]`. */
  canon?: Array<[number, number]>;
}

/**
 * Fills the study cache in the background, one chapter at a time.
 *
 * ## Why chunked timers rather than a worker
 *
 * `better-sqlite3` is synchronous, so any sweep that runs in the main process
 * holds the event loop for as long as its current unit of work takes. The two
 * ways out are a separate process, or units small enough that holding the loop
 * for one is indistinguishable from the work the app already does.
 *
 * This takes the second. One chapter's aggregation is the same order of work as
 * a single `study:getBatchVerseLinks` call, which the app already performs
 * synchronously on every chapter the user navigates to - so a unit that size is,
 * by construction, no worse than normal use. Between units the sweeper returns
 * to the event loop through a real timer, which is what keeps IPC replies and
 * window events flowing. A `utilityProcess` would remove even that, at the cost
 * of a second writer on one SQLite file, native-module loading in a child
 * process, and a cancellation protocol - none of which is justified until a
 * measurement says the yields are not enough.
 *
 * The sweep is strictly optional work: it can be stopped at any point, it never
 * blocks a read (write-through serves those), and a chapter it has not reached
 * is simply computed on demand.
 */
export class StudyCacheSweeper {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private queue: Array<[book: number, chapter: number]> = [];
  private index = 0;
  private filled = 0;
  private sinceSizeCheck = 0;
  /** Counts every yield back to the event loop. Asserted by the tests. */
  private yields = 0;

  constructor(
    private readonly cache: StudyCacheService = getStudyCacheService(),
    private readonly options: SweeperOptions = {}
  ) {}

  private get startupDelay(): number {
    return this.options.startupDelayMs ?? STARTUP_DELAY_MS;
  }
  private get interval(): number {
    return this.options.chapterIntervalMs ?? CHAPTER_INTERVAL_MS;
  }
  private get maxBytes(): number {
    return this.options.maxCacheBytes ?? MAX_CACHE_BYTES;
  }

  /** True while the sweep is scheduled or mid-walk. */
  isRunning(): boolean {
    return this.running;
  }

  /** Chapters written by this sweep so far. */
  filledCount(): number {
    return this.filled;
  }

  /** Times the sweeper has handed control back to the event loop. */
  yieldCount(): number {
    return this.yields;
  }

  /**
   * Schedule the sweep. Returns immediately - nothing is computed for at least
   * `startupDelayMs`, so this can be called during app startup without
   * contributing to it.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext(this.startupDelay);
  }

  /**
   * Stop the sweep. Idempotent, and safe to call from a quit handler: the unit
   * in flight is synchronous, so once this returns no further work is queued.
   */
  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.running = false;
  }

  private scheduleNext(delay: number): void {
    this.yields++;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.step();
    }, delay);
  }

  /**
   * One unit of work: at most one chapter, then straight back to the loop.
   *
   * Every exit path either schedules the next unit or stops - a step that
   * neither computes nor reschedules would strand the sweep half-done.
   */
  private step(): void {
    if (!this.running) return;

    const context = this.cache.contextOrNull();
    if (!context) {
      log.info('[StudyCacheSweeper] No aggregation context; not sweeping');
      this.stop();
      return;
    }

    if (this.queue.length === 0) {
      this.queue = this.buildQueue();
      if (this.queue.length === 0) {
        log.info('[StudyCacheSweeper] Nothing to sweep');
        this.stop();
        return;
      }
      log.info(`[StudyCacheSweeper] Sweeping ${this.queue.length} chapters at ${this.interval}ms each`);
    }

    if (this.index >= this.queue.length) {
      log.info(`[StudyCacheSweeper] Done: ${this.filled} chapter(s) cached`);
      this.stop();
      return;
    }

    if (this.sinceSizeCheck >= SIZE_CHECK_EVERY) {
      this.sinceSizeCheck = 0;
      const size = this.cache.sizeBytes();
      if (size > this.maxBytes) {
        log.warn(
          `[StudyCacheSweeper] Stopping: cache is ${(size / 1048576).toFixed(0)} MB, ` +
            `over the ${(this.maxBytes / 1048576).toFixed(0)} MB sweep budget`
        );
        this.stop();
        return;
      }
    }

    const [book, chapter] = this.queue[this.index++];
    this.sinceSizeCheck++;
    try {
      if (this.cache.fillChapter(book, chapter, context)) this.filled++;
    } catch (error) {
      // One bad chapter must not end the sweep - nor surface anywhere.
      log.warn(`[StudyCacheSweeper] Skipping ${book}/${chapter}:`, error);
    }

    this.scheduleNext(this.interval);
  }

  /**
   * The chapters to visit, in canon order.
   *
   * No prioritisation: write-through already covers everything the reader
   * touches, including the chapter they are on and any they navigate to, so the
   * sweep's only job is the long tail. Ordering the tail by anything would be
   * guessing at a cost the reader never pays.
   */
  private buildQueue(): Array<[number, number]> {
    const canon = this.options.canon ?? this.readCanon();
    const queue: Array<[number, number]> = [];
    for (const [book, chapterCount] of canon) {
      for (let chapter = 1; chapter <= chapterCount; chapter++) queue.push([book, chapter]);
    }
    return queue;
  }

  private readCanon(): Array<[number, number]> {
    try {
      return getSharedBookRepo()
        .getAll()
        .map(book => [book.bookNumber, book.chapterCount] as [number, number]);
    } catch (error) {
      log.warn('[StudyCacheSweeper] Could not read the canon:', error);
      return [];
    }
  }
}

let sweeper: StudyCacheSweeper | null = null;

/** Start the background fill. Safe to call during startup; does nothing for a minute. */
export function startStudyCacheSweep(): void {
  if (!sweeper) sweeper = new StudyCacheSweeper();
  sweeper.start();
}

/** Stop the background fill (quit hook). */
export function stopStudyCacheSweep(): void {
  sweeper?.stop();
  sweeper = null;
}
