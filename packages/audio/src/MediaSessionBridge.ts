/**
 * `IMediaSessionBridge` over the Media Session API: lock-screen and hardware
 * media-key controls, and the "now playing" card on phones.
 *
 * It only translates. Metadata and playback state flow from the player to the
 * session; the session's actions flow back to the player's transport calls. It
 * has no state of its own beyond what it must undo on `detach`.
 *
 * Mapping (the player has no "seek by seconds", and a chapter recording is
 * navigated by verse, so both channels behave alike):
 *   play / pause / stop            resume / pause / stop
 *   previoustrack / nexttrack      previous / next verse
 *   seekbackward / seekforward     previous / next verse
 *
 * Where the API does not exist (older browsers, tests) `attach` does nothing
 * and returns a no-op.
 */

import type { AudioMediaMetadata, IAudioPlayer, IMediaSessionBridge, PlayerState, VerseRef } from '@bible/core/browser';

type MediaAction = 'play' | 'pause' | 'stop' | 'previoustrack' | 'nexttrack' | 'seekbackward' | 'seekforward';

/** The slice of `navigator.mediaSession` this bridge uses. */
export interface MediaSessionLike {
  metadata: unknown;
  playbackState: 'none' | 'paused' | 'playing';
  setActionHandler(action: MediaAction, handler: (() => void) | null): void;
  setPositionState?(state?: { duration: number; position: number; playbackRate: number }): void;
}

export interface MediaSessionBridgeOptions {
  session?: MediaSessionLike | null;
  /** Builds the platform metadata object; default `new MediaMetadata(init)`. */
  createMetadata?: (init: AudioMediaMetadata) => unknown;
}

const ACTIONS: MediaAction[] = ['play', 'pause', 'stop', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward'];

function defaultSession(): MediaSessionLike | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as { mediaSession?: MediaSessionLike }).mediaSession ?? null;
}

export class MediaSessionBridge implements IMediaSessionBridge {
  private readonly session: MediaSessionLike | null;
  private readonly createMetadata: (init: AudioMediaMetadata) => unknown;

  constructor(opts: MediaSessionBridgeOptions = {}) {
    this.session = opts.session === undefined ? defaultSession() : opts.session;
    this.createMetadata = opts.createMetadata ?? (init => new MediaMetadata(init));
  }

  attach(player: IAudioPlayer, describe: (v: VerseRef) => AudioMediaMetadata): () => void {
    const session = this.session;
    if (!session) return () => {};

    let lastKey = '';
    const publish = (s: PlayerState) => {
      const current = s.current;
      if (s.status === 'idle' || !current) {
        session.playbackState = 'none';
        session.metadata = null;
        lastKey = '';
        return;
      }
      session.playbackState = s.status === 'playing' || s.status === 'buffering' || s.status === 'preparing' ? 'playing' : 'paused';
      // Rebuild the metadata only when the passage changes: it can flash the
      // lock screen, and the chapter, not the verse, is what it names.
      const key = `${current.moduleAbbr}:${current.book}:${current.chapter}:${s.voiceId ?? ''}`;
      if (key !== lastKey) {
        lastKey = key;
        try { session.metadata = this.createMetadata(describe(current)); } catch { /* metadata is decoration */ }
      }
      if (session.setPositionState && s.duration !== null && Number.isFinite(s.duration) && s.duration > 0) {
        try {
          session.setPositionState({
            duration: s.duration,
            position: Math.min(Math.max(0, s.position), s.duration),
            playbackRate: s.rate > 0 ? s.rate : 1,
          });
        } catch { /* out-of-range values are rejected by some browsers */ }
      }
    };

    const handlers: Record<MediaAction, () => void> = {
      play: () => player.resume(),
      pause: () => player.pause(),
      stop: () => player.stop(),
      previoustrack: () => { void player.seekVerse(-1); },
      nexttrack: () => { void player.seekVerse(1); },
      seekbackward: () => { void player.seekVerse(-1); },
      seekforward: () => { void player.seekVerse(1); },
    };
    for (const action of ACTIONS) {
      try { session.setActionHandler(action, handlers[action]); } catch { /* an unsupported action throws in some browsers */ }
    }

    const off = player.on('state', publish);
    publish(player.state);

    return () => {
      off();
      for (const action of ACTIONS) {
        try { session.setActionHandler(action, null); } catch { /* ignore */ }
      }
      session.playbackState = 'none';
      session.metadata = null;
    };
  }
}
