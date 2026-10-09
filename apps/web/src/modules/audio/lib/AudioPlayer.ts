/**
 * `IAudioPlayer`: transport, position and verse events over any provider.
 *
 * The player asks a provider for a chapter, walks that chapter's segments
 * through an `IAudioOutput`, and turns output time into verse events. It never
 * learns whether the audio was recorded or synthesized, and it never touches the
 * Bible's selection: it only announces which verse is being read.
 *
 * ## Concurrency
 *
 * Everything asynchronous (open a chapter, fetch a segment, load, play) can be
 * overtaken by the user pressing something else. One generation counter guards
 * all of it: `begin()` starts a new generation and aborts the previous one's
 * `AbortSignal`, and every `await` re-checks the generation it started under.
 * A stale result is discarded and its segment released, so a slow response can
 * never start playing after the user has moved on. Aborts are never surfaced as
 * errors.
 *
 * ## Segment ownership
 *
 * The player releases every segment it is given, exactly once, when the segment
 * is replaced, stopped or discarded (`releaseOnce`). It disposes a chapter when
 * the chapter is replaced or playback stops.
 *
 * ## Verse from time
 *
 * Verse `i` is current while `start_i <= t < end_i` (a hair of tolerance so a
 * seek to exactly `start_i` is not read as the previous verse). Between verses,
 * before the first (an intro) and after the last, the previous verse stays
 * current ("sticky"). A `verse` event fires only when the verse changes.
 *
 * ## Chapter end
 *
 * At the end of a chapter the player emits `chapterEnd(next)` synchronously and
 * then stops, unless a listener called `seekChapter(1)` or `play()` from inside
 * the callback. Listeners that want to continue must do so synchronously.
 */

import type {
  AudioError,
  AudioSegment,
  ChapterRef,
  IAudioOutput,
  IAudioPlayer,
  IAudioProvider,
  IChapterAudio,
  LoadProgress,
  OpenChapterOptions,
  PlayerState,
  VerseRef,
} from '@bible/core/browser';

export interface AudioPlayerOptions {
  /** The chapter after `ref`, or null at the end of the Bible. Chapter arithmetic lives outside the player. */
  nextChapter(ref: ChapterRef): ChapterRef | null;
  prevChapter(ref: ChapterRef): ChapterRef | null;
  /** Seconds into a verse after which "previous verse" restarts it. Default 2. */
  restartThreshold?: number;
  /** Seconds before the end of a recorded chapter at which the next is prefetched. Default 30. */
  prefetchLead?: number;
  /** Milliseconds a segment change may take before the status shows "buffering". Default 250. */
  bufferingDelay?: number;
}

const IDLE_STATE: PlayerState = {
  status: 'idle',
  providerId: null,
  voiceId: null,
  current: null,
  position: 0,
  duration: null,
  rate: 1,
  progress: null,
  error: null,
};

/** A hair of tolerance so a seek to exactly `start` lands inside that verse. */
const EPSILON = 0.01;
/** Position changes smaller than this (seconds) do not produce a state event. */
const POSITION_STEP = 0.2;

export function isAbort(e: unknown): boolean {
  const x = e as { code?: string; name?: string } | null;
  return x?.code === 'aborted' || x?.name === 'AbortError';
}

export function toAudioError(e: unknown): AudioError {
  const x = e as Partial<AudioError> & { message?: string } | null;
  if (x && typeof x === 'object' && typeof x.code === 'string' && typeof x.message === 'string') {
    return { code: x.code, message: x.message, retryable: x.retryable ?? false };
  }
  return {
    code: 'unknown',
    message: (x && typeof x.message === 'string' && x.message) || 'Audio playback failed.',
    retryable: true,
  };
}

const sameVerse = (a: VerseRef | null, b: VerseRef | null): boolean =>
  !!a && !!b && a.moduleAbbr === b.moduleAbbr && a.book === b.book && a.chapter === b.chapter && a.verse === b.verse;

const chapterKey = (r: ChapterRef): string => `${r.moduleAbbr}:${r.book}:${r.chapter}`;

/** The verse `t` falls in, or null between verses / outside the segment. */
export function verseAt(seg: AudioSegment, t: number): number | null {
  const tt = t + EPSILON;
  for (const v of seg.verses) {
    if (v.start <= tt && tt < v.end) return v.verse;
  }
  return null;
}

type Which = 'first' | 'last';

export class AudioPlayer implements IAudioPlayer {
  private _state: PlayerState = { ...IDLE_STATE };

  private readonly stateListeners = new Set<(s: PlayerState) => void>();
  private readonly verseListeners = new Set<(v: VerseRef) => void>();
  private readonly endListeners = new Set<(next: ChapterRef | null) => void>();
  private readonly offOutput: Array<() => void> = [];

  private gen = 0;
  private ctrl = new AbortController();
  private prefetchCtrl = new AbortController();
  /** The chapter a prefetch was triggered from (so it is triggered once per chapter). */
  private prefetchedFor: string | null = null;
  /** The chapter being prefetched: kept alive if playback moves on into it. */
  private prefetchTarget: string | null = null;

  private provider: IAudioProvider | null = null;
  private openOpts: OpenChapterOptions = { rate: 1 };
  private chapter: IChapterAudio | null = null;
  private chapterRef: ChapterRef | null = null;
  private seg: AudioSegment | null = null;
  private segLoaded = false;
  private wantPlaying = false;
  private target: VerseRef | null = null;
  private lastEmitted: VerseRef | null = null;
  /** The loaded segment has ended and its successor has not been loaded yet. */
  private segEnded = false;
  /** A chapter move that has not finished: where it was going, for a retry. */
  private chapterMove: { ref: ChapterRef; which: Which } | null = null;
  private disposed = false;
  private readonly released = new WeakSet<AudioSegment>();

  private readonly restartThreshold: number;
  private readonly prefetchLead: number;
  private readonly bufferingDelay: number;

  constructor(private readonly output: IAudioOutput, private readonly opts: AudioPlayerOptions) {
    this.restartThreshold = opts.restartThreshold ?? 2;
    this.prefetchLead = opts.prefetchLead ?? 30;
    this.bufferingDelay = opts.bufferingDelay ?? 250;
    this.offOutput.push(
      output.onTime(t => this.handleTime(t)),
      output.onEnded(() => { void this.handleEnded(); }),
      output.onError(e => this.handleOutputError(e)),
    );
  }

  get state(): PlayerState {
    return this._state;
  }

  // -- events ----------------------------------------------------------------

  on(e: 'state', cb: (s: PlayerState) => void): () => void;
  on(e: 'verse', cb: (v: VerseRef) => void): () => void;
  on(e: 'chapterEnd', cb: (next: ChapterRef | null) => void): () => void;
  on(e: 'state' | 'verse' | 'chapterEnd', cb: (arg: never) => void): () => void {
    const set = (e === 'state' ? this.stateListeners : e === 'verse' ? this.verseListeners : this.endListeners) as Set<typeof cb>;
    set.add(cb);
    return () => { set.delete(cb); };
  }

  private setState(patch: Partial<PlayerState>): void {
    this._state = { ...this._state, ...patch };
    for (const cb of [...this.stateListeners]) {
      try { cb(this._state); } catch (err) { console.error('[audio] state listener failed', err); }
    }
  }

  private emitVerse(v: VerseRef): void {
    if (sameVerse(v, this.lastEmitted)) return;
    this.lastEmitted = v;
    for (const cb of [...this.verseListeners]) {
      try { cb(v); } catch (err) { console.error('[audio] verse listener failed', err); }
    }
  }

  // -- public transport --------------------------------------------------------

  async play(from: VerseRef, provider: IAudioProvider, opts: OpenChapterOptions): Promise<void> {
    if (this.disposed) return;
    const { g, signal } = this.begin();
    this.discardPlayback();
    // Keep a prefetch that is fetching the very chapter we are about to play.
    if (this.provider !== provider || chapterKey(from) !== this.prefetchTarget) this.resetPrefetch();
    this.output.pause();
    this.provider = provider;
    this.openOpts = opts;
    this.chapterRef = { moduleAbbr: from.moduleAbbr, book: from.book, chapter: from.chapter };
    this.wantPlaying = true;
    this.target = null;
    this.lastEmitted = null;
    this.output.rate = provider.capabilities(from.moduleAbbr).rateMode === 'player' ? opts.rate : 1;
    this.setState({
      status: 'preparing', providerId: provider.id, voiceId: opts.voiceId ?? null, current: from,
      position: 0, duration: null, rate: opts.rate, progress: null, error: null,
    });
    await this.start(from, g, signal, true);
  }

  pause(): void {
    if (this.disposed) return;
    const s = this._state.status;
    if (s === 'idle' || s === 'error') return;
    this.wantPlaying = false;
    this.output.pause();
    this.setState({ status: 'paused' });
  }

  resume(): void {
    if (this.disposed) return;
    const s = this._state.status;
    if (s === 'idle') return;
    if (s === 'error') {
      const err = this._state.error;
      if (err?.code === 'autoplay' && this.segLoaded && this.seg) {
        this.wantPlaying = true;
        this.startOutput(this.gen);
      } else if (err?.retryable) {
        this.wantPlaying = true;
        this.retry();
      }
      return;
    }
    this.wantPlaying = true;
    if (s === 'paused' && this.segLoaded && this.seg && !this.segEnded) {
      // Synchronously, before any await: a browser only honours play() started
      // inside the user's gesture.
      this.startOutput(this.gen);
    } else if (s === 'paused') {
      // Either a load is still in flight, or the segment has ended and the next
      // is on its way (replaying the finished one would be audible). The
      // pipeline that is already running starts sound when it lands.
      this.setState({ status: this.chapter ? 'buffering' : 'preparing' });
    }
  }

  /** Try again after a retryable error, from where the failure left us. */
  private retry(): void {
    const { g, signal } = this.begin();
    this.setState({ status: 'buffering', error: null });
    if (this.chapterMove) {
      void this.goToChapter(this.chapterMove.ref, this.chapterMove.which);
      return;
    }
    const at = this.target ?? this._state.current;
    if (!at) return;
    void this.start(at, g, signal, this.chapter === null);
  }

  stop(): void {
    if (this.disposed) return;
    this.begin();
    this.resetPrefetch();
    this.output.pause();
    this.discardPlayback();
    this.provider = null;
    this.chapterRef = null;
    this.target = null;
    this.chapterMove = null;
    this.wantPlaying = false;
    this.lastEmitted = null;
    this.setState({
      ...IDLE_STATE, rate: this._state.rate,
    });
  }

  async seekVerse(delta: 1 | -1): Promise<void> {
    if (this.disposed || this._state.status === 'idle') return;
    const chapter = this.chapter;
    const base = this.target ?? this._state.current;
    if (!chapter || !base) return;

    const verses = chapter.verses;
    let idx = verses.indexOf(base.verse);
    if (idx < 0) idx = Math.max(0, verses.findIndex(v => v >= base.verse));
    let targetVerse: number;

    if (delta === -1) {
      const restart = this.target === null && this.elapsedInVerse(base.verse) > this.restartThreshold;
      if (restart) {
        targetVerse = verses[idx];
      } else if (idx > 0) {
        targetVerse = verses[idx - 1];
      } else {
        return this.previousChapterLastVerse(verses[idx]);
      }
    } else if (idx + 1 < verses.length) {
      targetVerse = verses[idx + 1];
    } else {
      return this.seekChapter(1);
    }
    return this.goToVerse({ ...base, verse: targetVerse });
  }

  async seekChapter(delta: 1 | -1): Promise<void> {
    if (this.disposed || !this.provider) return;
    if (this._state.status === 'idle') return;
    const base = this.target ?? this.chapterRef;
    if (!base) return;
    const ref = { moduleAbbr: base.moduleAbbr, book: base.book, chapter: base.chapter };
    const next = delta > 0 ? this.opts.nextChapter(ref) : this.opts.prevChapter(ref);
    if (!next) return;
    return this.goToChapter(next, 'first');
  }

  setRate(rate: number): void {
    if (this.disposed) return;
    this.openOpts = { ...this.openOpts, rate };
    this.setState({ rate });
    const provider = this.provider;
    const module = this.chapterRef?.moduleAbbr;
    const mode = provider && module ? provider.capabilities(module).rateMode : 'player';
    if (mode === 'player' || !provider) {
      this.output.rate = rate;
      return;
    }
    // Engine-side rate: the audio already made is at the old speed, so remake
    // it from the verse being read.
    this.output.rate = 1;
    const status = this._state.status;
    const current = this._state.current;
    if (status === 'idle' || !current) return;
    // Anything prefetched was made at the old rate.
    this.resetPrefetch();
    const { g, signal } = this.begin();
    this.output.pause();
    this.discardPlayback();
    this.setState({ status: this.wantPlaying ? 'buffering' : 'paused' });
    if (this.chapterMove) {
      void this.goToChapter(this.chapterMove.ref, this.chapterMove.which);
      return;
    }
    void this.start(this.target ?? current, g, signal, true);
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    for (const off of this.offOutput) off();
    this.offOutput.length = 0;
    this.stateListeners.clear();
    this.verseListeners.clear();
    this.endListeners.clear();
  }

  // -- generations ------------------------------------------------------------

  /** Start a new generation: everything still in flight for the old one is stale. */
  private begin(): { g: number; signal: AbortSignal } {
    this.gen++;
    this.ctrl.abort();
    this.ctrl = new AbortController();
    return { g: this.gen, signal: this.ctrl.signal };
  }

  private releaseOnce(seg: AudioSegment | null): void {
    if (!seg || this.released.has(seg)) return;
    this.released.add(seg);
    try { seg.release?.(); } catch { /* releasing must not break playback */ }
  }

  /** Drop the segment and chapter in hand (not the provider or user intent). */
  private discardPlayback(): void {
    this.segLoaded = false;
    this.segEnded = false;
    this.releaseOnce(this.seg);
    this.seg = null;
    this.chapter?.dispose();
    this.chapter = null;
  }

  private resetPrefetch(): void {
    this.prefetchCtrl.abort();
    this.prefetchCtrl = new AbortController();
    this.prefetchedFor = null;
    this.prefetchTarget = null;
  }

  // -- the loading pipeline -----------------------------------------------------

  /** Open the chapter (when asked) and load the segment for `at`. Never rejects. */
  private async start(at: VerseRef, g: number, signal: AbortSignal, openChapter: boolean): Promise<void> {
    const provider = this.provider;
    if (!provider) return;
    this.segLoaded = false;
    this.segEnded = false;
    try {
      if (openChapter) {
        const voiceId = this.openOpts.voiceId;
        if (!(await provider.isReady(voiceId))) {
          if (g !== this.gen) return;
          this.setState({ status: this.wantPlaying ? 'preparing' : 'paused', progress: null });
          await provider.prepare(voiceId, (p: LoadProgress) => {
            if (g === this.gen) this.setState({ progress: p });
          }, signal);
        }
        if (g !== this.gen) return;
        const chapter = await provider.openChapter(
          { moduleAbbr: at.moduleAbbr, book: at.book, chapter: at.chapter },
          { ...this.openOpts, onProgress: p => { if (g === this.gen) this.setState({ progress: p }); } },
          signal,
        );
        if (g !== this.gen) { chapter.dispose(); return; }
        this.chapter?.dispose();
        this.chapter = chapter;
        this.chapterRef = chapter.ref;
      }
      const chapter = this.chapter;
      if (!chapter) return;
      this.setState({ status: this.wantPlaying ? 'buffering' : 'paused', progress: null });
      // A verse the chapter lacks starts at the first one it has at or after it.
      const seg = await chapter.segmentFor(at.verse, signal);
      if (g !== this.gen) { if (this.seg !== seg) this.releaseOnce(seg); return; }
      await this.loadSegment(seg, at, g);
    } catch (e) {
      this.fail(e, g);
    }
  }

  /** Load `seg` into the output and (when the user wants sound) start it. */
  private async loadSegment(seg: AudioSegment, want: VerseRef | null, g: number): Promise<void> {
    const old = this.seg;
    this.seg = seg;
    this.segLoaded = false;
    const loading = this.output.load(seg);
    // `load` has pointed the element at the new source; the old blob URL is free.
    if (old && old !== seg) this.releaseOnce(old);
    try {
      await loading;
    } catch (e) {
      if (g !== this.gen) { if (this.seg !== seg) this.releaseOnce(seg); return; }
      throw e;
    }
    if (g !== this.gen) { if (this.seg !== seg) this.releaseOnce(seg); return; }
    this.segLoaded = true;
    this.segEnded = false;
    this.target = null;
    this.chapterMove = null;

    const ref = this.chapterRef!;
    const verse = verseAt(seg, seg.offset) ?? want?.verse ?? seg.verses[0]?.verse;
    if (verse !== undefined) {
      const v: VerseRef = { ...ref, verse };
      this.setState({ current: v });
      this.emitVerse(v);
    }
    this.setState({ ...this.positionPatch(this.output.currentTime), error: null });

    if (this.wantPlaying) {
      this.startOutput(g);
    } else {
      this.setState({ status: 'paused' });
    }
  }

  /** `output.play()` for generation `g`, translating the outcome into state. */
  private startOutput(g: number): void {
    this.setState({ status: 'playing', error: null });
    this.output.play().then(
      () => {
        // A newer generation now owns the status; nothing to do.
      },
      (e: unknown) => {
        if (g !== this.gen || isAbort(e)) return;
        this.fail(e, g);
      },
    );
  }

  private fail(e: unknown, g: number): void {
    if (g !== this.gen || this.disposed) return;
    // Keep a segment that loaded (an autoplay refusal resumes it); drop one that did not.
    if (!this.segLoaded && this.seg) {
      this.releaseOnce(this.seg);
      this.seg = null;
    }
    // An abort under the *current* generation is not the user moving on (that
    // would have made it stale): something below us gave up on its own, for
    // example a terminated worker. Never shown as "aborted", but the player must
    // not be left waiting for a segment that will never come.
    const error = isAbort(e)
      ? { code: 'unknown' as const, message: 'Audio playback was interrupted.', retryable: true }
      : toAudioError(e);
    this.setState({ status: 'error', error, progress: null });
  }

  // -- seeking ------------------------------------------------------------------

  private elapsedInVerse(verse: number): number {
    const seg = this.seg;
    if (!seg || !this.segLoaded) return 0;
    const timing = seg.verses.find(v => v.verse === verse);
    return this.output.currentTime - (timing?.start ?? 0);
  }

  private async goToVerse(target: VerseRef): Promise<void> {
    const seg = this.seg;
    const timing = seg?.verses.find(v => v.verse === target.verse);
    const status = this._state.status;
    // Recorded audio: the verse is inside the segment already loaded, so seek.
    if (seg && this.segLoaded && timing && (status === 'playing' || status === 'paused')) {
      const { g } = this.begin(); // cancels any fetch a previous, slower seek left in flight
      this.target = null;
      this.segEnded = false;
      this.output.seek(timing.start);
      this.setState({ current: target, ...this.positionPatch(timing.start) });
      this.emitVerse(target);
      // Sound must follow the seek: the element may have ended, or a `play()`
      // started under the generation just cancelled may still be pending (and
      // its rejection is ignored now). Playing an already-playing element is a no-op.
      if (this.wantPlaying) this.startOutput(g);
      return;
    }
    const { g, signal } = this.begin();
    this.target = target;
    // The audio in the element is about to be replaced: stop it, and stop
    // reading its clock, so the old verse cannot pull the highlight back.
    this.output.pause();
    this.segLoaded = false;
    this.setState({ current: target, status: this.wantPlaying ? 'buffering' : 'paused', error: null });
    this.emitVerse(target);
    await this.start(target, g, signal, this.chapter === null);
  }

  private async previousChapterLastVerse(firstVerse: number): Promise<void> {
    const ref = this.chapterRef;
    const prev = ref ? this.opts.prevChapter(ref) : null;
    if (!prev) {
      // Nothing before the first chapter of the Bible: restart it.
      if (ref) await this.goToVerse({ ...ref, verse: firstVerse });
      return;
    }
    return this.goToChapter(prev, 'last');
  }

  private async goToChapter(ref: ChapterRef, which: Which): Promise<void> {
    const provider = this.provider;
    if (!provider) return;
    const { g, signal } = this.begin();
    if (chapterKey(ref) !== this.prefetchTarget) this.resetPrefetch();
    this.output.pause();
    this.discardPlayback();
    this.chapterRef = ref;
    this.chapterMove = { ref, which };
    const placeholder: VerseRef = { ...ref, verse: 1 };
    this.target = placeholder;
    this.setState({
      status: this.wantPlaying ? 'buffering' : 'paused', current: placeholder, position: 0, duration: null, error: null,
    });
    try {
      const chapter = await provider.openChapter(ref, {
        ...this.openOpts,
        onProgress: p => { if (g === this.gen) this.setState({ progress: p }); },
      }, signal);
      if (g !== this.gen) { chapter.dispose(); return; }
      this.chapter = chapter;
      const verses = chapter.verses;
      const verse = which === 'last' ? verses[verses.length - 1] : verses[0];
      const at: VerseRef = { ...ref, verse: verse ?? 1 };
      this.target = at;
      const seg = await chapter.segmentFor(at.verse, signal);
      if (g !== this.gen) { if (this.seg !== seg) this.releaseOnce(seg); return; }
      await this.loadSegment(seg, at, g);
    } catch (e) {
      this.fail(e, g);
    }
  }

  // -- output events --------------------------------------------------------------

  private positionPatch(t: number): Partial<PlayerState> {
    const seg = this.seg;
    const chapter = this.chapter;
    // A recorded chapter is one segment covering every verse: time in it is
    // chapter time. A synthesized verse is a piece of the chapter of unknown
    // total length, so duration stays unknown there.
    const whole = !!seg && !!chapter && seg.verses.length === chapter.verses.length && seg.duration !== undefined;
    return { position: t, duration: whole ? seg!.duration ?? null : null };
  }

  private handleTime(t: number): void {
    const seg = this.seg;
    if (this.disposed || !seg || !this.segLoaded) return;
    // Silent bookkeeping first, so a verse change and its position arrive together.
    const verse = verseAt(seg, t);
    const ref = this.chapterRef;
    const patch: Partial<PlayerState> = {};
    let changed = false;
    if (Math.abs(t - this._state.position) >= POSITION_STEP) {
      Object.assign(patch, this.positionPatch(t));
      changed = true;
    }
    let newVerse: VerseRef | null = null;
    if (verse !== null && ref && this._state.current?.verse !== verse) {
      newVerse = { ...ref, verse };
      patch.current = newVerse;
      changed = true;
    }
    if (changed) this.setState(patch);
    if (newVerse) this.emitVerse(newVerse);
    this.maybePrefetch(t);
  }

  private maybePrefetch(t: number): void {
    const provider = this.provider;
    const chapter = this.chapter;
    const seg = this.seg;
    if (!provider?.prefetch || !chapter || !seg) return;
    const key = chapterKey(chapter.ref);
    if (this.prefetchedFor === key) return;
    const whole = seg.verses.length === chapter.verses.length && seg.duration !== undefined;
    const near = whole
      ? t >= (seg.duration as number) - this.prefetchLead
      : this._state.current?.verse === chapter.verses[chapter.verses.length - 1];
    if (!near) return;
    const next = this.opts.nextChapter(chapter.ref);
    this.prefetchedFor = key;
    if (!next) return;
    this.prefetchTarget = chapterKey(next);
    // Best effort: a failed prefetch only means the next chapter loads on demand.
    provider.prefetch(next, this.openOpts, this.prefetchCtrl.signal).catch(() => {});
  }

  private async handleEnded(): Promise<void> {
    const chapter = this.chapter;
    const seg = this.seg;
    if (this.disposed || !chapter || !seg || !this.segLoaded || this.segEnded) return;
    this.segEnded = true;
    const g = this.gen;
    const signal = this.ctrl.signal;
    // A verse-to-verse gap is normally instant: only show "buffering" if it is
    // not (and never over a pause: the user asked for silence).
    let pending = true;
    const timer = setTimeout(() => {
      if (pending && g === this.gen && this.wantPlaying) this.setState({ status: 'buffering' });
    }, this.bufferingDelay);
    let next: AudioSegment | null;
    try {
      next = await chapter.segmentAfter(seg, signal);
    } catch (e) {
      pending = false;
      clearTimeout(timer);
      // A retry must go to the verse that failed to load, not replay the one that finished.
      const verses = chapter.verses;
      const last = seg.verses[seg.verses.length - 1]?.verse;
      const nextVerse = last === undefined ? undefined : verses[verses.indexOf(last) + 1];
      if (g === this.gen && nextVerse !== undefined && this.chapterRef) {
        this.target = { ...this.chapterRef, verse: nextVerse };
      }
      this.fail(e, g);
      return;
    }
    pending = false;
    clearTimeout(timer);
    if (g !== this.gen) {
      if (next && this.seg !== next) this.releaseOnce(next);
      return;
    }
    try {
      if (next) {
        await this.loadSegment(next, null, g);
        return;
      }
    } catch (e) {
      this.fail(e, g);
      return;
    }

    // End of the chapter.
    const nextRef = this.opts.nextChapter(chapter.ref);
    this.setState({ status: 'buffering' });
    for (const cb of [...this.endListeners]) {
      try { cb(nextRef); } catch (err) { console.error('[audio] chapterEnd listener failed', err); }
    }
    if (g === this.gen && !this.disposed) {
      // Nobody continued: stop, keeping the last verse as the place we finished.
      this.begin();
      this.output.pause();
      this.discardPlayback();
      this.wantPlaying = false;
      this.target = null;
      this.setState({ status: 'idle', position: 0, duration: null, progress: null, error: null });
    }
  }

  private handleOutputError(e: AudioError): void {
    if (this.disposed || !this.segLoaded) return;
    this.fail(e, this.gen);
  }
}
