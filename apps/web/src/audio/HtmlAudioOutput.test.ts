import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AudioSegment } from '@bible/core/browser';
import { HtmlAudioOutput, mediaErrorToAudioError } from './HtmlAudioOutput';
import { FakeMediaElement, asAudioElement } from './testing';

const seg = (over: Partial<AudioSegment> = {}): AudioSegment => ({
  id: 's1', url: '/audio/v1/KJV/x/0/43/003.ogg', mime: 'audio/ogg', offset: 0, verses: [], ...over,
});

let el: FakeMediaElement;
let out: HtmlAudioOutput;

beforeEach(() => {
  vi.useFakeTimers();
  el = new FakeMediaElement();
  out = new HtmlAudioOutput(asAudioElement(el));
});
afterEach(() => {
  out.dispose();
  vi.useRealTimers();
});

describe('load', () => {
  it('sets the source, waits for metadata and seeks to the segment offset', async () => {
    const p = out.load(seg({ offset: 42.5 }));
    await vi.advanceTimersByTimeAsync(0);
    await p;
    expect(el.src).toBe('/audio/v1/KJV/x/0/43/003.ogg');
    expect(el.currentTime).toBe(42.5);
  });

  it('does not seek when the offset is 0', async () => {
    el.currentTime = 7;
    const p = out.load(seg());
    await vi.advanceTimersByTimeAsync(0);
    await p;
    expect(el.currentTime).toBe(0); // the load reset it; no seek applied
  });

  it('rejects the earlier load with "aborted" when a newer one starts', async () => {
    el.autoReady = false;
    const first = out.load(seg({ id: 'a' }));
    const firstResult = first.catch(e => e);
    el.autoReady = true;
    const second = out.load(seg({ id: 'b', url: '/b.ogg' }));
    await vi.advanceTimersByTimeAsync(0);
    await second;
    expect(await firstResult).toMatchObject({ code: 'aborted' });
    expect(el.src).toBe('/b.ogg');
  });

  it('rejects with a mapped error when the element fails to load', async () => {
    el.autoReady = false;
    const p = out.load(seg());
    const caught = p.catch(e => e);
    el.fail(4);
    expect(await caught).toMatchObject({ code: 'decode', retryable: false });
  });

  it('does not also report a load failure through onError', async () => {
    const errors: unknown[] = [];
    out.onError(e => errors.push(e));
    el.autoReady = false;
    const caught = out.load(seg()).catch(e => e);
    el.fail(2);
    await caught;
    expect(errors).toEqual([]);
  });

  it('reapplies the playback rate after the source changes', async () => {
    out.rate = 1.5;
    const p = out.load(seg());
    el.playbackRate = 1; // what a src change does in a browser
    await vi.advanceTimersByTimeAsync(0);
    await p;
    expect(el.playbackRate).toBe(1.5);
  });
});

describe('rate', () => {
  it('sets playbackRate, the default rate and pitch preservation', () => {
    out.rate = 0.75;
    expect(el.playbackRate).toBe(0.75);
    expect(el.defaultPlaybackRate).toBe(0.75);
    expect(el.preservesPitch).toBe(true);
    expect(out.rate).toBe(0.75);
  });
});

describe('play', () => {
  it('starts the element', async () => {
    await out.play();
    expect(el.paused).toBe(false);
  });

  it('maps a blocked autoplay to an autoplay error', async () => {
    el.playBehaviour = 'NotAllowedError';
    await expect(out.play()).rejects.toMatchObject({ code: 'autoplay', retryable: true });
  });

  it('maps an interrupted play() to aborted', async () => {
    el.playBehaviour = 'AbortError';
    await expect(out.play()).rejects.toMatchObject({ code: 'aborted' });
  });

  it('maps anything else to a media error', async () => {
    el.playBehaviour = 'other';
    el.error = { code: 3, message: '' };
    await expect(out.play()).rejects.toMatchObject({ code: 'decode' });
  });
});

describe('time, end and errors', () => {
  it('reports time on timeupdate and on a steady tick while playing', async () => {
    const times: number[] = [];
    out.onTime(t => times.push(t));
    await out.play();
    el.currentTime = 1;
    await vi.advanceTimersByTimeAsync(250);
    expect(times.length).toBeGreaterThanOrEqual(2);
    expect(times.every(t => t === 1)).toBe(true);
    el.pause();
    const n = times.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(times.length).toBe(n);
  });

  it('seek moves the clock and reports it immediately', () => {
    const times: number[] = [];
    out.onTime(t => times.push(t));
    out.seek(12);
    expect(out.currentTime).toBe(12);
    expect(times).toEqual([12]);
    out.seek(-5);
    expect(out.currentTime).toBe(0);
  });

  it('notifies ended, stops the tick, and lets listeners unsubscribe', async () => {
    const ended = vi.fn();
    const off = out.onEnded(ended);
    await out.play();
    el.finish();
    expect(ended).toHaveBeenCalledTimes(1);
    off();
    el.finish();
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('reports a mid-playback stream error through onError', async () => {
    const errors: unknown[] = [];
    out.onError(e => errors.push(e));
    await out.play();
    el.fail(2);
    expect(errors).toEqual([expect.objectContaining({ code: 'network', retryable: true })]);
  });
});

describe('dispose', () => {
  it('rejects a pending load, clears the source and ignores later events', async () => {
    el.autoReady = false;
    const caught = out.load(seg()).catch(e => e);
    out.dispose();
    expect(await caught).toMatchObject({ code: 'aborted' });
    expect(el.src).toBe('');
    const ended = vi.fn();
    out.onEnded(ended);
    el.finish();
    expect(ended).not.toHaveBeenCalled();
  });
});

describe('mediaErrorToAudioError', () => {
  it.each([
    [2, 'network', true],
    [3, 'decode', false],
    [4, 'decode', false],
    [1, 'unknown', true],
  ])('code %i maps to %s', (code, mapped, retryable) => {
    const e = mediaErrorToAudioError({ error: { code, message: '' } } as unknown as HTMLMediaElement);
    expect(e.code).toBe(mapped);
    expect(e.retryable).toBe(retryable);
  });
});
