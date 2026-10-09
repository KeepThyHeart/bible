/**
 * One chapter of on-device speech: an `IChapterAudio` that synthesizes verses
 * ahead of the listener.
 *
 * Shape: one segment per verse (a WAV blob), so verse timing is exact by
 * construction. The chapter intro ("John, chapter 3.") is folded into the first
 * verse's text and does not get a segment of its own.
 *
 * ## Scheduling
 *
 * A single lazy pump runs at most one engine call at a time (a WASM engine is
 * single-threaded; queued calls would only fight each other). It picks, in
 * order: a verse somebody is waiting on (a "demand" jumps the queue, waiting at
 * most for the call already running, which cannot be interrupted), otherwise
 * the next verse from the playhead until the look-ahead window is full. The
 * window is 3 verses AND 30 s of audio while the page is visible; while it is
 * hidden it is the rest of the chapter, because a background tab throttles
 * timers and the queue may not get another chance.
 *
 * ## Ownership of blob URLs (the rule everything else follows from)
 *
 * The chapter keeps Blobs, never URLs. Every segment it hands out gets a fresh
 * object URL, and that segment's `release()` revokes exactly that URL, once.
 * The chapter never revokes a URL it handed out, not even in `dispose()`: the
 * player owns handed-out segments. Evicting or disposing only drops Blob
 * references (a Blob behind a live URL stays valid). Consequently no URL is
 * revoked twice, none is revoked while the element is playing it, and a
 * synthesis that finishes after an abort never creates a URL at all.
 *
 * ## Cancellation
 *
 * The chapter has its own AbortController, aborted only by `dispose()`. A
 * caller's signal (the player aborts one on every seek) only cancels that
 * caller's wait; the synthesis it was waiting for continues and is memoized.
 */

import type {
  AudioSegment,
  ChapterRef,
  IChapterAudio,
  ITextPreparer,
  ITtsEngine,
  VerseText,
} from '@bible/core/browser';
import { joinPcm, pcmSeconds, wavBlob } from '../wav';
import { abortedError, toTtsError } from './ttsErrors';
import type { PageVisibility } from './visibility';

export interface LookAhead {
  /** Verses to keep synthesized ahead of the playhead while visible. */
  verses: number;
  /** ...and at least this many seconds of audio. */
  seconds: number;
}

export interface TtsChapterOptions {
  ref: ChapterRef;
  language: string;
  bookName: string;
  voiceId: string;
  /** The rate passed to the engine (1 when the media element does the speeding up). */
  rate: number;
  readIntro: boolean;
  engine: ITtsEngine;
  text: ITextPreparer;
  verses: VerseText[];
  lookAhead: LookAhead;
  /** Verses longer than this many characters are synthesized sentence by sentence. */
  longVerseChars: number;
  visibility: PageVisibility;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
}

interface Entry {
  state: 'queued' | 'running' | 'done' | 'failed';
  promise: Promise<Done>;
  resolve(d: Done): void;
  reject(e: unknown): void;
  done?: Done;
}

interface Done {
  blob: Blob;
  duration: number;
}

/** Shortest clip handed to the element, so it always has something playable that ends. */
const MIN_SECONDS = 0.05;
const SENTENCE_GAP_SECONDS = 0.25;
const MIN_PIECE_CHARS = 40;

/** Split after sentence punctuation, merging tiny pieces into the previous one. */
export function splitSentences(text: string): string[] {
  const raw = text.split(/(?<=[.!?;:])\s+/).map(s => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const piece of raw) {
    if (out.length > 0 && piece.length < MIN_PIECE_CHARS) out[out.length - 1] += ` ${piece}`;
    else out.push(piece);
  }
  return out.length > 0 ? out : [text];
}

export class TtsChapterAudio implements IChapterAudio {
  readonly ref: ChapterRef;
  readonly verses: readonly number[];

  private readonly texts = new Map<number, string>();
  private readonly entries = new Map<number, Entry>();
  private readonly demandQueue: number[] = [];
  private readonly ctrl = new AbortController();
  private readonly o: TtsChapterOptions;
  private readonly unsubscribeVisibility: () => void;
  private playhead = 0;
  private running = false;
  private pumpScheduled = false;
  private disposed = false;

  constructor(opts: TtsChapterOptions) {
    this.o = opts;
    this.ref = opts.ref;
    const order: number[] = [];
    for (const raw of opts.verses) {
      if (this.texts.has(raw.verse)) continue; // a source repeating a verse number must not loop the chapter
      const spoken = opts.text.verse(raw, opts.language).trim();
      if (spoken) { this.texts.set(raw.verse, spoken); order.push(raw.verse); }
    }
    order.sort((a, b) => a - b);
    this.verses = order;
    if (opts.readIntro && order.length > 0) {
      const first = order[0];
      const intro = opts.text.chapterIntro(opts.ref, opts.bookName, opts.language).trim();
      if (intro) this.texts.set(first, `${intro} ${this.texts.get(first)}`);
    }
    this.unsubscribeVisibility = opts.visibility.subscribe(() => this.schedulePump());
  }

  // -- IChapterAudio -----------------------------------------------------------

  segmentFor(verse: number, signal: AbortSignal): Promise<AudioSegment> {
    const target = this.verses.find(v => v >= verse) ?? this.verses[this.verses.length - 1];
    return this.deliver(target, signal);
  }

  async segmentAfter(seg: AudioSegment, signal: AbortSignal): Promise<AudioSegment | null> {
    const last = seg.verses[seg.verses.length - 1]?.verse;
    const i = last === undefined ? -1 : this.verses.indexOf(last);
    const next = this.verses[i + 1];
    if (i < 0 || next === undefined) return null;
    return this.deliver(next, signal);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ctrl.abort();
    this.unsubscribeVisibility();
    for (const entry of this.entries.values()) {
      if (entry.state !== 'done') entry.reject(abortedError());
    }
    this.entries.clear();
    this.demandQueue.length = 0;
  }

  /** Start synthesizing `verse` (the first one, for a warm-up) without waiting for it. */
  warm(verse = this.verses[0]): void {
    if (verse === undefined || this.disposed) return;
    this.setPlayhead(verse);
    this.ensure(verse, true);
  }

  // -- delivery ----------------------------------------------------------------

  private async deliver(verse: number, signal: AbortSignal): Promise<AudioSegment> {
    if (this.disposed) throw abortedError();
    if (signal.aborted) throw abortedError();
    this.setPlayhead(verse);
    const entry = this.ensure(verse, true);
    const done = await this.raceAbort(entry.promise, signal);
    // The caller may have moved on, or the chapter may be gone, while we waited:
    // in either case do not mint a URL nobody will release.
    if (signal.aborted || this.disposed) throw abortedError();
    return this.handOut(verse, done);
  }

  private raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(abortedError());
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
      p.then(
        v => { signal.removeEventListener('abort', onAbort); resolve(v); },
        e => { signal.removeEventListener('abort', onAbort); reject(e); },
      );
    });
  }

  private handOut(verse: number, done: Done): AudioSegment {
    const url = this.o.createObjectURL(done.blob);
    let released = false;
    const { ref, voiceId, rate } = this.o;
    return {
      id: `${ref.moduleAbbr}:${ref.book}:${ref.chapter}:${voiceId}:${rate}:${verse}`,
      url,
      mime: 'audio/wav',
      offset: 0,
      duration: done.duration,
      verses: [{ verse, start: 0, end: done.duration }],
      release: () => {
        if (released) return;
        released = true;
        this.o.revokeObjectURL(url);
      },
    };
  }

  // -- scheduling --------------------------------------------------------------

  private setPlayhead(verse: number): void {
    const i = this.verses.indexOf(verse);
    if (i < 0) return;
    this.playhead = i;
    // Demands for verses now behind the listener were abandoned by a seek: they
    // must not keep their place in front of the verse actually wanted.
    for (let k = this.demandQueue.length - 1; k >= 0; k--) {
      if (this.verses.indexOf(this.demandQueue[k]) < i) this.demandQueue.splice(k, 1);
    }
    // Drop finished audio well behind the listener (one verse is kept for "previous verse").
    for (const [v, entry] of this.entries) {
      if (entry.state === 'done' && this.verses.indexOf(v) < i - 1) this.entries.delete(v);
    }
    this.schedulePump();
  }

  /** The entry for `verse`, creating a queued one (and a demand, when asked) if there is none. */
  private ensure(verse: number, demand: boolean): Entry {
    let entry = this.entries.get(verse);
    if (entry && entry.state === 'failed' && demand) {
      this.entries.delete(verse); // only a demand retries a failure
      entry = undefined;
    }
    if (!entry) {
      let resolve!: (d: Done) => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise<Done>((res, rej) => { resolve = res; reject = rej; });
      promise.catch(() => {}); // a look-ahead nobody awaits must not raise "unhandled rejection"
      entry = { state: 'queued', promise, resolve, reject };
      this.entries.set(verse, entry);
      if (demand) this.demandQueue.push(verse);
    } else if (demand && entry.state === 'queued' && !this.demandQueue.includes(verse)) {
      this.demandQueue.push(verse);
    }
    this.schedulePump();
    return entry;
  }

  private schedulePump(): void {
    if (this.pumpScheduled || this.disposed) return;
    this.pumpScheduled = true;
    queueMicrotask(() => { this.pumpScheduled = false; this.pump(); });
  }

  private nextVerse(): number | undefined {
    // A verse somebody is waiting on comes first, the newest ask first: a
    // listener who skipped ahead wants the verse they landed on, not the ones
    // they passed on the way.
    while (this.demandQueue.length > 0) {
      const v = this.demandQueue.pop()!;
      const e = this.entries.get(v);
      if (e && e.state === 'queued') return v;
    }
    // Otherwise the next verse from the playhead, until the window is full.
    const hidden = this.o.visibility.isHidden();
    if (!hidden) {
      let count = 0;
      let seconds = 0;
      // Only the unbroken run of finished verses right after the playhead counts:
      // audio for verses further on does not cover a gap in front of them.
      for (let i = this.playhead + 1; i < this.verses.length; i++) {
        const e = this.entries.get(this.verses[i]);
        if (e?.state === 'done') { count++; seconds += e.done!.duration; }
        else if (e?.state === 'failed') continue; // skipped by look-ahead; do not stall the window on it
        else break;
      }
      if (count >= this.o.lookAhead.verses && seconds >= this.o.lookAhead.seconds) return undefined;
    }
    for (let i = this.playhead; i < this.verses.length; i++) {
      const v = this.verses[i];
      const e = this.entries.get(v);
      if (!e) { this.ensure(v, false); return v; }
      if (e.state === 'queued') return v;
      // 'running' cannot happen (one at a time), 'done' is fine, 'failed' is skipped.
    }
    return undefined;
  }

  private pump(): void {
    if (this.running || this.disposed) return;
    const verse = this.nextVerse();
    if (verse === undefined) return;
    const entry = this.entries.get(verse);
    if (!entry || entry.state !== 'queued') { this.schedulePump(); return; }
    this.running = true;
    entry.state = 'running';
    this.synthesize(verse).then(
      done => {
        this.running = false;
        if (this.disposed) return; // late result after dispose: no URL, no bookkeeping
        entry.state = 'done';
        entry.done = done;
        // Already behind the listener by the time it finished: nothing wants it.
        if (this.verses.indexOf(verse) < this.playhead - 1) this.entries.delete(verse);
        entry.resolve(done);
        this.schedulePump();
      },
      err => {
        this.running = false;
        if (this.disposed) return;
        entry.state = 'failed';
        entry.reject(toTtsError(err));
        this.schedulePump();
      },
    );
  }

  // -- synthesis ---------------------------------------------------------------

  private async synthesize(verse: number): Promise<Done> {
    const signal = this.ctrl.signal;
    const text = this.texts.get(verse)!;
    const pieces = text.length > this.o.longVerseChars ? splitSentences(text) : [text];
    const results: Float32Array[] = [];
    let sampleRate = 0;
    for (const piece of pieces) {
      if (signal.aborted) throw abortedError();
      const r = await this.o.engine.synthesize({ text: piece, voiceId: this.o.voiceId, rate: this.o.rate }, signal);
      if (signal.aborted) throw abortedError();
      if (sampleRate !== 0 && r.sampleRate !== sampleRate) {
        throw { code: 'engine', message: 'The speech engine changed sample rate mid-verse.', retryable: false };
      }
      sampleRate = r.sampleRate;
      results.push(r.pcm);
    }
    let pcm = results.length === 1 ? results[0] : joinPcm(results, sampleRate, SENTENCE_GAP_SECONDS);
    const minSamples = Math.ceil(MIN_SECONDS * sampleRate);
    if (pcm.length < minSamples) {
      const padded = new Float32Array(minSamples);
      padded.set(pcm);
      pcm = padded;
    }
    let blob: Blob;
    try {
      blob = wavBlob(pcm, sampleRate);
    } catch (e) {
      throw { code: 'engine', message: e instanceof Error ? e.message : 'Could not encode the audio.', retryable: false };
    }
    return { blob, duration: pcmSeconds(pcm.length, sampleRate) };
  }
}
