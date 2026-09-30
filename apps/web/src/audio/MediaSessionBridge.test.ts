import { describe, it, expect, vi } from 'vitest';
import type { AudioMediaMetadata, PlayerState, VerseRef } from '@bible/core/browser';
import { MediaSessionBridge, type MediaSessionLike } from './MediaSessionBridge';
import { AudioPlayer } from './AudioPlayer';
import { FakeOutput, FakeProvider } from './testing';

function fakeSession() {
  const handlers = new Map<string, (() => void) | null>();
  const session: MediaSessionLike & { positions: unknown[] } = {
    metadata: null,
    playbackState: 'none',
    positions: [],
    setActionHandler: (a, h) => { handlers.set(a, h); },
    setPositionState: s => { session.positions.push(s); },
  };
  return { session, handlers };
}

const describeVerse = (v: VerseRef): AudioMediaMetadata => ({
  title: `Book ${v.book} ${v.chapter}`, artist: v.moduleAbbr, album: 'Keep Thy Heart Bible',
});
const at = (verse: number, chapter = 3): VerseRef => ({ moduleAbbr: 'KJV', book: 43, chapter, verse });
const nextCh = (r: { moduleAbbr: string; book: number; chapter: number }) => ({ ...r, chapter: r.chapter + 1 });

function rig() {
  const out = new FakeOutput();
  const provider = new FakeProvider();
  const player = new AudioPlayer(out, { nextChapter: nextCh, prevChapter: r => (r.chapter > 1 ? { ...r, chapter: r.chapter - 1 } : null) });
  const { session, handlers } = fakeSession();
  const createMetadata = vi.fn((init: AudioMediaMetadata) => ({ ...init }));
  const bridge = new MediaSessionBridge({ session, createMetadata });
  return { out, provider, player, session, handlers, createMetadata, bridge };
}

describe('MediaSessionBridge', () => {
  it('is a no-op where the API does not exist', () => {
    const { player } = rig();
    const off = new MediaSessionBridge({ session: null }).attach(player, describeVerse);
    expect(() => off()).not.toThrow();
  });

  it('publishes metadata and state as playback starts, and rebuilds metadata only on a new chapter', async () => {
    const { player, provider, session, bridge, createMetadata } = rig();
    bridge.attach(player, describeVerse);
    await player.play(at(1), provider, { rate: 1 });
    expect(session.playbackState).toBe('playing');
    expect(session.metadata).toMatchObject({ title: 'Book 43 3', artist: 'KJV' });
    await player.seekVerse(1);
    expect(createMetadata).toHaveBeenCalledTimes(1);
    await player.seekChapter(1);
    expect(createMetadata).toHaveBeenCalledTimes(2);
    expect(session.metadata).toMatchObject({ title: 'Book 43 4' });
  });

  it('reflects pause and stop', async () => {
    const { player, provider, session, bridge } = rig();
    bridge.attach(player, describeVerse);
    await player.play(at(1), provider, { rate: 1 });
    player.pause();
    expect(session.playbackState).toBe('paused');
    player.stop();
    expect(session.playbackState).toBe('none');
    expect(session.metadata).toBeNull();
  });

  it('reports position state only when the duration is known and in range', async () => {
    const { player, provider, session, bridge, out } = rig();
    bridge.attach(player, describeVerse);
    await player.play(at(1), provider, { rate: 1.5 });
    out.tick(5);
    expect(session.positions.at(-1)).toEqual({ duration: 50, position: 5, playbackRate: 1.5 });
    out.tick(70); // beyond the end: clamped, not rejected
    expect(session.positions.at(-1)).toMatchObject({ position: 50 });
  });

  it('does not report position for a synthesized verse (unknown chapter length)', async () => {
    const { out, player, session, bridge } = rig();
    const tts = new FakeProvider('tts:fake', 'engine');
    bridge.attach(player, describeVerse);
    await player.play(at(1), tts, { rate: 1 });
    out.tick(2);
    expect(session.positions).toEqual([]);
  });

  it('routes actions to the transport', async () => {
    const { player, provider, handlers, bridge } = rig();
    bridge.attach(player, describeVerse);
    await player.play(at(2), provider, { rate: 1 });
    handlers.get('pause')!();
    expect(player.state.status).toBe('paused');
    handlers.get('play')!();
    expect(player.state.status).toBe('playing');
    handlers.get('nexttrack')!();
    await Promise.resolve();
    expect(player.state.current?.verse).toBe(3);
    handlers.get('seekforward')!();
    await Promise.resolve();
    expect(player.state.current?.verse).toBe(4);
    handlers.get('previoustrack')!();
    await Promise.resolve();
    expect(player.state.current?.verse).toBe(3);
    handlers.get('stop')!();
    expect(player.state.status).toBe('idle');
  });

  it('detach unhooks everything', async () => {
    const { player, provider, session, handlers, bridge } = rig();
    const off = bridge.attach(player, describeVerse);
    await player.play(at(1), provider, { rate: 1 });
    off();
    expect([...handlers.values()].every(h => h === null)).toBe(true);
    expect(session.metadata).toBeNull();
    const states: PlayerState[] = [];
    player.on('state', s => states.push(s));
    player.pause();
    expect(session.playbackState).toBe('none');
  });

  it('survives a browser that throws on unsupported actions or metadata', async () => {
    const { player, provider } = rig();
    const session: MediaSessionLike = {
      metadata: null, playbackState: 'none',
      setActionHandler: () => { throw new TypeError('unsupported'); },
    };
    const bridge = new MediaSessionBridge({ session, createMetadata: () => { throw new Error('bad'); } });
    bridge.attach(player, describeVerse);
    await expect(player.play(at(1), provider, { rate: 1 })).resolves.toBeUndefined();
    expect(session.playbackState).toBe('playing');
  });
});
