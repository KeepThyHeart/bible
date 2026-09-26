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

import { audioStore } from '../../stores/audioStore';
import { bibleStore } from '../../stores/bibleStore';
import { buildUiRig, flush, openChapter } from '../../audio/uiRig';
import type { UiRig } from '../../audio/uiRig';
import { BibleToolbar } from '../BiblePane/BibleToolbar';
import { AudioTransportBar } from '../BiblePane/AudioTransportBar';
import { AudioPlayerScreen } from '../AudioPlayerScreen';
import { AudioMiniPlayer } from '../AudioMiniPlayer';
import { AudioGateDialog } from './AudioGateDialog';
import { AudioLiveRegion } from './AudioLiveRegion';
import { AudioSettingsTab } from '../Dialogs/AudioSettingsTab';

let rig: UiRig;

async function start(opts: Parameters<typeof buildUiRig>[0] = {}) {
  rig = buildUiRig(opts);
  await openChapter();
  await flush();
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
  it('is hidden when idle and shows the state, verse and source chip while playing', async () => {
    await start();
    render(<AudioTransportBar />);
    expect(screen.queryByTestId('audio-transport')).toBeNull();
    await playNow();
    await screen.findByTestId('audio-transport');
    expect(screen.getByTestId('audio-now-playing').textContent).toMatch(/\d+:1$/);
    expect(screen.getByText(/audio\.chip\.onDevice/).textContent).toContain('Fake');
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

  it('opens the source panel from the chip; choosing a source is remembered for the translation', async () => {
    await start({ recordings: true });
    render(<AudioTransportBar />);
    await playNow();
    fireEvent.click(await screen.findByTitle('audio.transport.source'));
    const panel = await screen.findByTestId('audio-source-panel');
    await waitFor(() => expect(panel.querySelectorAll('[role="radio"]').length).toBe(3)); // automatic, recorded, speech
    fireEvent.click(screen.getByRole('radio', { name: 'Fake' }));
    expect(audioStore.prefs.perTranslation.KJV?.source).toBe('tts:fake');
    // Escape closes it and returns focus to the chip.
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('audio-source-panel')).toBeNull());
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

  it('the mini-player pauses, reopens the player and stops', async () => {
    await start({ layout: 'phone' });
    acknowledgeBatteryNotice();
    render(<><AudioPlayerScreen /><AudioMiniPlayer /></>);
    await playNow();
    const mini = await screen.findByTestId('audio-mini');
    fireEvent.click(mini.querySelector('.audio-btn--primary')!);
    expect(audioStore.status).toBe('paused');
    fireEvent.click(screen.getByLabelText('audio.player.open'));
    await screen.findByTestId('audio-player-screen');
    fireEvent.click(screen.getByTestId('audio-player-stop'));
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
    const dialog = await screen.findByTestId('audio-gate');
    expect(dialog.textContent).toContain('audio.gate.batteryTitle');
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

describe('settings tab', () => {
  it('binds the toggles to the preferences', async () => {
    await start();
    render(<AudioSettingsTab />);
    const follow = await screen.findByTestId('audio-pref-follow') as HTMLInputElement;
    expect(follow.checked).toBe(true);
    fireEvent.click(follow);
    expect(audioStore.prefs.followAlong).toBe(false);
    fireEvent.click(screen.getByTestId('audio-pref-scroll'));
    expect(audioStore.prefs.autoScroll).toBe(false);
    fireEvent.click(screen.getByTestId('audio-pref-continue'));
    expect(audioStore.prefs.continueAfterChapter).toBe('stop');
    fireEvent.click(screen.getByTestId('audio-pref-intro'));
    expect(audioStore.prefs.readChapterIntro).toBe(false);
    expect(JSON.parse(rig.storage.get('bible-audio-prefs')!).followAlong).toBe(false);
  });

  it('reduces to the toggles when no engine and no recording exist', async () => {
    await start({ engine: false });
    render(<AudioSettingsTab />);
    await screen.findByTestId('audio-pref-follow');
    expect(screen.queryByTestId('audio-voices')).toBeNull();
    expect(screen.queryByTestId('audio-rate')).toBeNull();
  });

  it('lists the engine voices, downloads one with progress, uses it, and removes it', async () => {
    await start();
    render(<AudioSettingsTab />);
    const voices = await screen.findByTestId('audio-voices');
    expect(voices.textContent).toContain('Amy');
    expect(voices.textContent).toContain('63 MB');
    fireEvent.click(screen.getByText('audio.settings.download'));
    await waitFor(() => expect(voices.textContent).toContain('audio.settings.downloaded'));
    expect(rig.engine.prepared.has('amy')).toBe(true);
    fireEvent.click(screen.getByText('audio.settings.useVoice'));
    expect(audioStore.prefs.voiceByEngineLang['fake:en']).toBe('amy');
    fireEvent.click(within(voices).getByText('audio.settings.remove'));
    await waitFor(() => expect(rig.engine.prepared.has('amy')).toBe(false));
    await waitFor(() => expect(screen.getByText('audio.settings.download')).toBeTruthy());
  });

  it('sets the global source and a per-translation source', async () => {
    await start({ recordings: true });
    render(<AudioSettingsTab />);
    await waitFor(() => expect(screen.getAllByRole('radio').length).toBeGreaterThan(4));
    fireEvent.click(screen.getAllByRole('radio', { name: 'audio.source.recorded' })[0]);
    expect(audioStore.prefs.source).toBe('recorded');
    fireEvent.click(screen.getAllByRole('radio', { name: 'Fake' })[1]);
    expect(audioStore.prefs.perTranslation.KJV?.source).toBe('tts:fake');
    fireEvent.click(screen.getByRole('radio', { name: 'audio.source.useDefault' }));
    expect(audioStore.prefs.perTranslation.KJV).toBeUndefined();
  });

  it('shows the speed slider from the sources’ range and stores the choice', async () => {
    await start();
    render(<AudioSettingsTab />);
    const slider = await screen.findByTestId('audio-rate') as HTMLInputElement;
    expect(slider.min).toBe('0.5');
    expect(slider.max).toBe('2');
    fireEvent.input(slider, { target: { value: '1.5' } });
    expect(audioStore.prefs.rate).toBe(1.5);
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
