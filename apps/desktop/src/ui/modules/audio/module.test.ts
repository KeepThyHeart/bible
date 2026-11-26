import { describe, it, expect, vi, beforeEach } from 'vitest';

const info = vi.fn();
vi.mock('./audioClient', () => ({ audioClient: { getInfo: () => info() } }));
vi.mock('./audioSystem', () => ({ createDesktopAudioSystem: vi.fn(() => ({ fake: true })) }));
const init = vi.fn();
const dispose = vi.fn();
vi.mock('./audioState', () => ({ audioStore: { init: (s: unknown) => init(s), dispose: () => dispose(), enabled: false, status: 'idle' }, useAudio: vi.fn(), useFollow: vi.fn() }));
vi.mock('./audioBookmarksSession', () => ({ installAudioBookmarksSession: vi.fn(() => ({ dispose: vi.fn() })) }));
vi.mock('./shortcuts', () => ({ installAudioShortcuts: vi.fn(() => vi.fn()) }));
vi.mock('./components/ListenButton', () => ({ ListenButton: () => null }));
vi.mock('./components/AudioTransportBar', () => ({ AudioTransportBar: () => null }));
vi.mock('./components/AudioPlayerPopup', () => ({ AudioPlayerPopup: () => null }));
vi.mock('./components/AudioGateDialog', () => ({ AudioGateDialog: () => null }));
vi.mock('./components/AudioLiveRegion', () => ({ AudioLiveRegion: () => null }));

import { readerBars, readerPaintControllers, readerToolbarItems, shellOverlays } from '../host/slots';
import { activate } from './module';

const playable = { audio: { base: 'kth-audio://app/audio', recorded: false, tts: { engines: [{ id: 'piper', voices: [{ id: 'v', language: 'en' }] }] } }, recordingsBase: null, runtimeBytes: 1 };
const ctx = () => ({ moduleId: 'audio', platform: 'desktop', activationEvent: 'onStartupFinished', subscriptions: [] as Array<{ dispose(): void }> }) as never as Parameters<typeof activate>[0];

beforeEach(() => { info.mockReset(); init.mockReset(); dispose.mockReset(); });

describe('audio module activate', () => {
  it('registers the slots and disposes cleanly', async () => {
    info.mockResolvedValue(playable);
    const c = ctx();
    const sizes = [readerToolbarItems, readerBars, shellOverlays, readerPaintControllers].map(s => s.list().length);
    await activate(c);
    expect(init).toHaveBeenCalledOnce();
    expect(readerToolbarItems.list().length).toBe(sizes[0] + 1);
    expect(readerBars.list().length).toBe(sizes[1] + 1);
    expect(shellOverlays.list().length).toBe(sizes[2] + 3);
    expect(readerPaintControllers.list().length).toBe(sizes[3] + 1);
    for (const d of c.subscriptions) d.dispose();
    expect(dispose).toHaveBeenCalled();
    expect(shellOverlays.list().length).toBe(sizes[2]);
  });

  it('adds no UI when the config fails or nothing can play', async () => {
    const c = ctx();
    info.mockRejectedValueOnce(new Error('x'));
    await activate(c);
    info.mockResolvedValueOnce({ audio: { base: 'kth-audio://app/audio', recorded: false, tts: { engines: [] } }, recordingsBase: null, runtimeBytes: 0 });
    await activate(c);
    expect(init).not.toHaveBeenCalled();
    expect(c.subscriptions).toHaveLength(0);
  });
});
