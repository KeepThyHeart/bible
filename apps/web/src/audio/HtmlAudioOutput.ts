/**
 * `IAudioOutput` backed by one shared `<audio>` element.
 *
 * One element for both channels is what gives background playback, lock-screen
 * controls and `playbackRate` (with pitch preserved) for free: the browser
 * treats it as a normal media player. A Web Audio output could replace this
 * behind the same interface if gaps between synthesized verses ever prove
 * audible.
 *
 * The output is deliberately dumb. It plays whatever segment it is handed and
 * reports time, end and errors; it does not know about verses, chapters, queues
 * or who owns a segment's blob URL (the player releases segments).
 */

import type { AudioError, AudioSegment, IAudioOutput } from '@bible/core/browser';

/** How often the position is reported while playing, in milliseconds. */
const TICK_MS = 100;

type PitchAudio = HTMLAudioElement & { preservesPitch?: boolean; webkitPreservesPitch?: boolean };

/** Map a media element failure to the app's error vocabulary. */
export function mediaErrorToAudioError(el: HTMLMediaElement): AudioError {
  const code = el.error?.code;
  // MediaError: 1 aborted, 2 network, 3 decode, 4 source not supported.
  if (code === 2) return { code: 'network', message: 'The audio could not be downloaded.', retryable: true };
  if (code === 3 || code === 4) {
    return { code: 'decode', message: 'This browser could not play the audio.', retryable: false };
  }
  return { code: 'unknown', message: el.error?.message || 'The audio failed to play.', retryable: true };
}

export class HtmlAudioOutput implements IAudioOutput {
  private readonly el: PitchAudio;
  private readonly timeListeners = new Set<(t: number) => void>();
  private readonly endedListeners = new Set<() => void>();
  private readonly errorListeners = new Set<(e: AudioError) => void>();
  private tick: ReturnType<typeof setInterval> | null = null;
  private loadToken = 0;
  private cancelPendingLoad: (() => void) | null = null;
  private _rate = 1;
  private disposed = false;

  constructor(element?: HTMLAudioElement) {
    this.el = (element ?? new Audio()) as PitchAudio;
    this.el.preload = 'auto';
    this.applyRate();
    this.el.addEventListener('ended', this.handleEnded);
    this.el.addEventListener('error', this.handleError);
    this.el.addEventListener('play', this.startTicking);
    this.el.addEventListener('playing', this.startTicking);
    this.el.addEventListener('pause', this.stopTicking);
    this.el.addEventListener('seeked', this.emitTime);
    this.el.addEventListener('timeupdate', this.emitTime);
  }

  get currentTime(): number {
    return this.el.currentTime;
  }

  get rate(): number {
    return this._rate;
  }

  set rate(value: number) {
    this._rate = value;
    this.applyRate();
  }

  /**
   * Point the element at `seg` and resolve once it can play from `seg.offset`.
   * A newer `load` (or `dispose`) rejects this one with an `aborted` error, so
   * a stale segment can never start playing after the caller has moved on.
   */
  load(seg: AudioSegment): Promise<void> {
    this.cancelPendingLoad?.();
    const token = ++this.loadToken;
    const el = this.el;

    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        el.removeEventListener('loadedmetadata', onReady);
        el.removeEventListener('error', onError);
        if (this.cancelPendingLoad === cancel) this.cancelPendingLoad = null;
      };
      const cancel = () => {
        cleanup();
        reject({ code: 'aborted', message: 'Superseded by a newer load.', retryable: false } satisfies AudioError);
      };
      const onReady = () => {
        if (token !== this.loadToken) return;
        cleanup();
        // Setting `src` reset the playback rate to the default; put it back.
        this.applyRate();
        if (seg.offset > 0) {
          try { el.currentTime = seg.offset; } catch { /* not seekable yet; playback starts at 0 */ }
        }
        resolve();
      };
      const onError = () => {
        if (token !== this.loadToken) return;
        cleanup();
        reject(mediaErrorToAudioError(el));
      };
      this.cancelPendingLoad = cancel;
      el.addEventListener('loadedmetadata', onReady);
      el.addEventListener('error', onError);
      el.pause();
      el.src = seg.url;
      el.load();
    });
  }

  async play(): Promise<void> {
    try {
      await this.el.play();
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      if (name === 'AbortError') {
        // play() interrupted by a pause() or a new load(): not a failure.
        throw { code: 'aborted', message: 'Playback was interrupted.', retryable: false } satisfies AudioError;
      }
      if (name === 'NotAllowedError') {
        throw {
          code: 'autoplay',
          message: 'The browser blocked playback. Tap Play to start.',
          retryable: true,
        } satisfies AudioError;
      }
      throw mediaErrorToAudioError(this.el);
    }
  }

  pause(): void {
    this.el.pause();
  }

  seek(seconds: number): void {
    try {
      this.el.currentTime = Math.max(0, seconds);
    } catch { /* metadata not loaded yet */ }
    this.emitTime();
  }

  onTime(cb: (t: number) => void): () => void {
    this.timeListeners.add(cb);
    return () => this.timeListeners.delete(cb);
  }

  onEnded(cb: () => void): () => void {
    this.endedListeners.add(cb);
    return () => this.endedListeners.delete(cb);
  }

  onError(cb: (e: AudioError) => void): () => void {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }

  /** Stop, drop the source and detach every listener. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelPendingLoad?.();
    this.stopTicking();
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
    this.el.removeEventListener('ended', this.handleEnded);
    this.el.removeEventListener('error', this.handleError);
    this.el.removeEventListener('play', this.startTicking);
    this.el.removeEventListener('playing', this.startTicking);
    this.el.removeEventListener('pause', this.stopTicking);
    this.el.removeEventListener('seeked', this.emitTime);
    this.el.removeEventListener('timeupdate', this.emitTime);
    this.timeListeners.clear();
    this.endedListeners.clear();
    this.errorListeners.clear();
  }

  private applyRate(): void {
    this.el.defaultPlaybackRate = this._rate;
    this.el.playbackRate = this._rate;
    // Keep the pitch when speeding up or slowing down (on by default in current
    // browsers; the prefixed flag covers older Safari).
    this.el.preservesPitch = true;
    this.el.webkitPreservesPitch = true;
  }

  private readonly emitTime = (): void => {
    const t = this.el.currentTime;
    for (const cb of this.timeListeners) cb(t);
  };

  private readonly startTicking = (): void => {
    if (this.tick !== null) return;
    this.tick = setInterval(this.emitTime, TICK_MS);
  };

  private readonly stopTicking = (): void => {
    if (this.tick === null) return;
    clearInterval(this.tick);
    this.tick = null;
  };

  private readonly handleEnded = (): void => {
    this.stopTicking();
    for (const cb of this.endedListeners) cb();
  };

  private readonly handleError = (): void => {
    // Errors raised while a `load()` is pending are reported through its
    // promise; only report the rest (a stream failing mid-playback).
    if (this.cancelPendingLoad) return;
    const err = mediaErrorToAudioError(this.el);
    for (const cb of this.errorListeners) cb(err);
  };
}
