/**
 * The audio UI, rendered against the real audio store and Bible store with fake
 * providers (see audio/uiRig.ts). `t()` echoes keys (with their parameters), so
 * these tests assert that the right message is shown; a separate test checks that
 * every key used exists in the English catalog.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/preact';

vi.mock('react-i18next', async importOriginal => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}${JSON.stringify(opts)}` : key),
    i18n: { language: 'en' },
  }),
}));

import { audioStore } from '../audioStore';
import { bibleStore } from '../../../stores/bibleStore';
import { buildUiRig, flush, openChapter } from '../lib/uiRig';
import type { UiRig } from '../lib/uiRig';
import { BibleToolbar } from '../../../components/BiblePane/BibleToolbar';
import { readerToolbarActions } from '../../../host/slots';
import { ListenButton } from './ListenButton';
import { AudioTransportBar } from './AudioTransportBar';
import { AudioPlayerPopup } from './AudioPlayerPopup';
import { AudioPlayerScreen } from './AudioPlayerScreen';
import { AudioMiniPlayer } from './AudioMiniPlayer';
import { AudioGateDialog } from './AudioGateDialog';
import { AudioLiveRegion } from './AudioLiveRegion';
import { AudioQuickSettings } from './AudioQuickSettings';

let rig: UiRig;

async function start(opts: Parameters<typeof buildUiRig>[0] = {}) {
  rig = buildUiRig(opts);
  await openChapter();
  await flush();
  audioStore.setPlayerStyle('bar'); // the desktop bar tests below; the pop-up has its own tests
}

/** The phone's battery notice is asked once per engine; these tests are not about it. */
const acknowledgeBatteryNotice = () => audioStore.setPrefs({ phoneBatteryNoticeSeen: { fake: true } });

async function playNow() {
  const p = audioStore.play();
  await flush();
  await p;
  await flush();
}

beforeEach(() => { audioStore.reset(); });
afterEach(() => { cleanup(); audioStore.reset(); vi.restoreAllMocks(); });

describe('Listen button', () => {
  // The module registers the button in the host's toolbar slot on activation; the toolbar itself knows nothing of audio.
  let unregister: { dispose(): void };
  beforeEach(() => { unregister = readerToolbarActions.register(ListenButton); });
  afterEach(() => { unregister.dispose(); });

  it('is absent when the feature is off', async () => {
    await openChapter();
    render(<BibleToolbar />);
    expect(screen.queryByTestId('audio-listen')).toBeNull();
  });

  it('is disabled, with the reason as its tooltip, when nothing can play the translation (zero recordings, no engine)', async () => {
    await start({ engine: false });
    render(<BibleToolbar />);
    const btn = await screen.findByTestId('audio-listen');
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(true));
    expect(btn.getAttribute('title')).toBe('audio.notice.noAudio');
  });

  it('desktop: plays with speech when there are no recordings, then toggles to Pause and back', async () => {
    await start();
    render(<BibleToolbar />);
    const btn = await screen.findByTestId('audio-listen') as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    expect(btn.textContent).toContain('audio.listen');
    fireEvent.click(btn);
    await flush();
    await waitFor(() => expect(audioStore.status).toBe('playing'));
    expect(audioStore.providerId).toBe('tts:fake');
    await waitFor(() => expect(btn.getAttribute('aria-pressed')).toBe('true'));
    expect(btn.textContent).toContain('audio.pause');
    fireEvent.click(btn);
    expect(audioStore.status).toBe('paused');
  });

  it('desktop: passes its own tab to togglePlay (never pauses another tab)', async () => {
    await start();
    const spy = vi.spyOn(audioStore, 'togglePlay');
    render(<BibleToolbar />);
    const btn = await screen.findByTestId('audio-listen') as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    fireEvent.click(btn);
    expect(spy).toHaveBeenCalledWith(bibleStore.activeTabId);
  });

  it('phone: opens the full-screen player and starts playback', async () => {
    await start({ layout: 'phone' });
    render(<BibleToolbar />);
    const btn = await screen.findByTestId('audio-listen') as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    fireEvent.click(btn);
    expect(audioStore.playerOpen).toBe(true);
    await flush();
    await waitFor(() => expect(audioStore.status).not.toBe('idle'));
  });
});

describe('desktop transport bar', () => {
  it('is hidden when idle and shows the state, verse and progress while playing', async () => {
    await start();
    render(<AudioTransportBar />);
    expect(screen.queryByTestId('audio-transport')).toBeNull();
    await playNow();
    await screen.findByTestId('audio-transport');
    expect(screen.getByTestId('audio-now-playing').textContent).toMatch(/\d+:1$/);
    expect(screen.getByLabelText('audio.transport.progress')).toBeTruthy();
    expect(screen.getByTestId('audio-progress-label').textContent).toContain('audio.transport.verseOf');
  });

  it('its buttons drive the store: pause, verse and chapter skipping, close', async () => {
    await start();
    render(<AudioTransportBar />);
    await playNow();
    const seekVerse = vi.spyOn(audioStore, 'seekVerse');
    const seekChapter = vi.spyOn(audioStore, 'seekChapter');
    fireEvent.click(await screen.findByLabelText('audio.transport.nextVerse'));
    fireEvent.click(screen.getByLabelText('audio.transport.prevVerse'));
    fireEvent.click(screen.getByLabelText('audio.transport.nextChapter'));
    fireEvent.click(screen.getByLabelText('audio.transport.prevChapter'));
    expect(seekVerse.mock.calls).toEqual([[1], [-1]]);
    expect(seekChapter.mock.calls).toEqual([[1], [-1]]);
    fireEvent.click(screen.getByTestId('audio-play-pause'));
    expect(audioStore.status).toBe('paused');
    fireEvent.click(screen.getByTestId('audio-close'));
    expect(audioStore.status).toBe('idle');
    await waitFor(() => expect(screen.queryByTestId('audio-transport')).toBeNull());
  });

  it('the progress slider jumps to the verse it is released on', async () => {
    await start();
    render(<AudioTransportBar />);
    await playNow();
    const jump = vi.spyOn(audioStore, 'jumpToVerse').mockImplementation(() => {});
    const slider = await screen.findByTestId('audio-progress') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '3' } });
    expect(jump).toHaveBeenCalledWith(4);
  });

  it('shows a network error with Retry, and "use on-device speech" only when a speech source exists', async () => {
    await start();
    render(<AudioTransportBar />);
    await playNow();
    rig.out.error({ code: 'network', message: 'x', retryable: true });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('audio.error.network');
    expect(screen.getByText('audio.action.retry')).toBeTruthy();
  });

  it('the simple bar: Settings and pop-out, no other tools; pop-out opens the full player', async () => {
    await start({ recordings: true });
    render(<AudioTransportBar />);
    await playNow();
    await screen.findByTestId('audio-transport');
    expect(screen.queryByTestId('audio-speed')).toBeNull();
    fireEvent.click(screen.getByTestId('audio-gear'));
    await screen.findByTestId('audio-quick-settings');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('audio-quick-settings')).toBeNull());
    fireEvent.click(screen.getByTestId('audio-popout'));
    expect(audioStore.prefs.playerStyle).toBe('popup');
  });

  it('the full player opens the settings from its Settings tile (the Voice select, recordings first), and Escape closes it', async () => {
    await start({ recordings: true });
    audioStore.setPlayerStyle('popup');
    render(<AudioPlayerPopup />);
    await playNow();
    expect(screen.queryByTestId('audio-verse-pane')).toBeNull(); // the Bible text is on screen beside it
    fireEvent.click(await screen.findByTestId('audio-gear'));
    await screen.findByTestId('audio-quick-settings');
    // Choosing from it is covered in audioQuick.test.tsx (with a stand-in Popover).
    await waitFor(() => expect(Array.from((screen.getByTestId('audio-quick-source') as HTMLSelectElement).options).map(o => o.value)).toEqual(['recorded', 'tts:fake']));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('audio-quick-settings')).toBeNull());
  });

  it('the full player keeps the speed as a tile and picks it from a pop-up', async () => {
    await start();
    audioStore.setPlayerStyle('popup');
    render(<AudioPlayerPopup />);
    await playNow();
    const speed = await screen.findByTestId('audio-speed');
    fireEvent.click(within(speed).getByTestId('audio-speed-button'));
    const opt = (await screen.findAllByRole('option')).find(o => o.textContent === '1.25×')!;
    fireEvent.click(opt);
    expect(audioStore.prefs.rate).toBe(1.25);
  });

  it('is replaced by the pop-up while playing when the player style is pop-up', async () => {
    await start();
    render(<AudioTransportBar />);
    await playNow();
    await screen.findByTestId('audio-transport');
    audioStore.setPlayerStyle('popup');
    await waitFor(() => expect(screen.queryByTestId('audio-transport')).toBeNull());
  });

  it('with no audio for the translation, says so instead of showing a bar', async () => {
    await start({ engine: false });
    render(<AudioTransportBar />);
    await playNow();
    expect(audioStore.notice?.key).toBe('audio.notice.noAudio');
    // Nothing is playing: only the notice is shown.
    const status = await screen.findByTestId('audio-status');
    expect(status.textContent).toContain('audio.notice.noAudio');
    fireEvent.click(screen.getByText('audio.action.dismiss'));
    await waitFor(() => expect(screen.queryByTestId('audio-transport')).toBeNull());
  });
});

describe('phone player', () => {
  it('opens full screen, closes with the button and Escape, and playback continues', async () => {
    await start({ layout: 'phone' });
    acknowledgeBatteryNotice();
    render(<><AudioPlayerScreen /><AudioMiniPlayer /></>);
    await playNow();
    expect(screen.queryByTestId('audio-mini')).toBeTruthy(); // player closed: mini-player shows
    audioStore.openPlayer();
    const screenEl = await screen.findByTestId('audio-player-screen');
    expect(screenEl.getAttribute('role')).toBe('dialog');
    expect(screenEl.getAttribute('aria-modal')).toBe('true');
    expect(screen.queryByTestId('audio-mini')).toBeNull();
    fireEvent.click(screen.getByTestId('audio-player-close'));
    await waitFor(() => expect(screen.queryByTestId('audio-player-screen')).toBeNull());
    expect(audioStore.status).toBe('playing');
    audioStore.openPlayer();
    await screen.findByTestId('audio-player-screen');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('audio-player-screen')).toBeNull());
    expect(audioStore.status).toBe('playing');
  });

  it('the mini-player pauses, reopens the player, and stops (the player itself has no Stop)', async () => {
    await start({ layout: 'phone' });
    acknowledgeBatteryNotice();
    render(<><AudioPlayerScreen /><AudioMiniPlayer /></>);
    await playNow();
    const mini = await screen.findByTestId('audio-mini');
    fireEvent.click(mini.querySelector('.audio-btn--primary')!);
    expect(audioStore.status).toBe('paused');
    fireEvent.click(screen.getByLabelText('audio.player.open'));
    await screen.findByTestId('audio-player-screen');
    expect(screen.queryByTestId('audio-player-stop')).toBeNull();
    fireEvent.click(screen.getByTestId('audio-player-close'));
    fireEvent.click(within(await screen.findByTestId('audio-mini')).getByLabelText('audio.transport.close'));
    expect(audioStore.status).toBe('idle');
    await waitFor(() => expect(screen.queryByTestId('audio-player-screen')).toBeNull());
    expect(screen.queryByTestId('audio-mini')).toBeNull();
  });

  it('is not shown on the desktop layout', async () => {
    await start();
    render(<><AudioPlayerScreen /><AudioMiniPlayer /></>);
    await playNow();
    audioStore.openPlayer();
    await flush();
    expect(screen.queryByTestId('audio-player-screen')).toBeNull();
    expect(screen.queryByTestId('audio-mini')).toBeNull();
  });
});

describe('gate dialog', () => {
  it('asks before downloading a voice; cancel downloads nothing, confirm plays', async () => {
    await start();
    rig.tts.needsDownload = true;
    rig.tts.ready = false;
    render(<AudioGateDialog />);
    const p = audioStore.play();
    await flush();
    const dialog = await screen.findByTestId('audio-gate');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain('audio.gate.voiceSize');
    expect(dialog.textContent).toContain('63 MB');
    fireEvent.click(screen.getByText('audio.action.cancel'));
    await p;
    expect(rig.tts.prepareCalls).toBe(0);
    expect(audioStore.status).toBe('idle');
    await waitFor(() => expect(screen.queryByTestId('audio-gate')).toBeNull());

    const q = audioStore.play();
    await flush();
    fireEvent.click(await screen.findByTestId('audio-gate-confirm'));
    await q;
    await flush();
    expect(rig.tts.prepareCalls).toBe(1);
    expect(audioStore.status).toBe('playing');
  });

  it('Escape declines', async () => {
    await start();
    rig.tts.needsDownload = true;
    rig.tts.ready = false;
    render(<AudioGateDialog />);
    const p = audioStore.play();
    await flush();
    await screen.findByTestId('audio-gate');
    fireEvent.keyDown(window, { key: 'Escape' });
    await p;
    expect(audioStore.status).toBe('idle');
  });

  it('phone: one battery notice offers "download and play" with the size', async () => {
    await start({ layout: 'phone' });
    rig.tts.needsDownload = true;
    rig.tts.ready = false;
    render(<AudioGateDialog />);
    const p = audioStore.play();
    await flush();
    await screen.findByTestId('audio-gate');
    // The shared bottom sheet carries the title.
    expect(screen.getByRole('dialog').textContent).toContain('audio.gate.batteryTitle');
    expect(screen.getByTestId('audio-gate-confirm').textContent).toBe('audio.gate.downloadAndPlay');
    fireEvent.click(screen.getByTestId('audio-gate-confirm'));
    await p;
    await flush();
    expect(audioStore.status).toBe('playing');
  });
});

describe('live region', () => {
  it('announces state changes in words, not the position', async () => {
    await start();
    render(<AudioLiveRegion />);
    const live = await screen.findByTestId('audio-live');
    expect(live.getAttribute('aria-live')).toBe('polite');
    await playNow();
    await waitFor(() => expect(live.textContent).toContain('audio.announce.playing'));
    audioStore.pause();
    await waitFor(() => expect(live.textContent).toBe('audio.announce.paused'));
    audioStore.resume();
    await waitFor(() => expect(live.textContent).toContain('audio.announce.resumed'));
    audioStore.stop();
    await waitFor(() => expect(live.textContent).toBe('audio.announce.stopped'));
  });

  it('announces an error', async () => {
    await start();
    render(<AudioLiveRegion />);
    await playNow();
    rig.out.error({ code: 'decode', message: 'x', retryable: false });
    await waitFor(() => expect(screen.getByTestId('audio-live').textContent).toContain('audio.error.decode'));
  });

  it('renders nothing when the feature is off', async () => {
    render(<AudioLiveRegion />);
    expect(screen.queryByTestId('audio-live')).toBeNull();
  });
});

describe('settings in the player gear', () => {
  it('binds the while-playing switches to the preferences', async () => {
    await start();
    render(<AudioQuickSettings moduleAbbr="KJV" variant="phone" />);
    const follow = await waitFor(() => { if (!document.getElementById('audio-quick-phone-followAlong')) throw new Error('no toggle'); }).then(() => document.getElementById('audio-quick-phone-followAlong') as HTMLInputElement);
    expect(follow.checked).toBe(true);
    fireEvent.click(follow);
    expect(audioStore.prefs.followAlong).toBe(false);
    fireEvent.click(document.getElementById('audio-quick-phone-autoScroll')!);
    expect(audioStore.prefs.autoScroll).toBe(false);
    fireEvent.click(document.getElementById('audio-quick-phone-readChapterIntro')!);
    expect(audioStore.prefs.readChapterIntro).toBe(false);
    // Continue is a toggle on the player, not here.
    expect(document.getElementById('audio-quick-phone-continueToNextChapter')).toBeNull();
    expect(JSON.parse(rig.storage.get('bible-audio-prefs')!).followAlong).toBe(false);
  });

  it('under Generated: the voice size and state, and Remove once it is on the device', async () => {
    await start();
    audioStore.setPrefs({ source: 'tts:fake' });
    render(<AudioQuickSettings moduleAbbr="KJV" variant="phone" />);
    const state = await screen.findByTestId('audio-quick-voice-state');
    await waitFor(() => expect(state.textContent).toContain('audio.settings.downloadsOnPlay'));
    expect(state.textContent).toContain('Amy');
    expect(state.textContent).toContain('63 MB');
    await rig.engine.prepare('amy', () => {}, new AbortController().signal);
    cleanup();
    render(<AudioQuickSettings moduleAbbr="KJV" variant="phone" />);
    const ready = await screen.findByTestId('audio-quick-voice-state');
    await waitFor(() => expect(ready.textContent).toContain('audio.settings.onDevice'));
    fireEvent.click(within(ready).getByText('audio.settings.remove'));
    await waitFor(() => expect(rig.engine.prepared.has('amy')).toBe(false));
  });
});

describe('the Bible store is never touched by playback', () => {
  it('following along moves the highlight but not the selected verse', async () => {
    await start();
    const tab = bibleStore.getActiveTab()!;
    tab.studyVerse = 43003002;
    await playNow();
    const before = audioStore.follow.verseId;
    await rig.player.seekVerse(1);
    await flush();
    expect(audioStore.follow.verseId).not.toBe(before); // the highlight moved
    expect(bibleStore.getActiveTab()!.studyVerse).toBe(43003002); // the selection did not
  });
});
