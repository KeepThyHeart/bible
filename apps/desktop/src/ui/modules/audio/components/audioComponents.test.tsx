/**
 * The audio components against a real AudioStore with fake providers (see audioTestRig). Strings are the real
 * English catalog (`locales/en/audio.json`), so these assert what the reader reads.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';

vi.mock('../audioState', async () => (await import('./audioTestRig')).audioStateMock());
vi.mock('../../../services/electronAPI', () => ({
  assetsAPI: {
    list: vi.fn(async () => ({
      entries: [
        { id: 'tts-voice:en_US-amy-low', kind: 'tts-voice', title: 'Amy', status: 'installed', storedBytes: 63_000_000, size: 63_000_000 },
        { id: 'module:kjv', kind: 'module', title: 'KJV', status: 'installed', storedBytes: 5_000_000, size: 5_000_000 },
      ],
      storedBytes: 68_000_000,
      active: 0,
    })),
    remove: vi.fn(async () => ({ removed: true })),
  },
}));

import enAudio from '../../../../../locales/en/audio.json';
import { PANEL, buildRig, flush, playNow, renderAudio, seedPane, store } from './audioTestRig';
import type { Rig } from './audioTestRig';
import { assetsAPI } from '../../../services/electronAPI';
import { ListenButton } from './ListenButton';
import { AudioTransportBar } from './AudioTransportBar';
import { AudioPlayerPopup } from './AudioPlayerPopup';
import { AudioGateDialog } from './AudioGateDialog';
import { AudioLiveRegion } from './AudioLiveRegion';
import { AudioQuickSettings } from './AudioQuickSettings';
import { AudioSection } from './AudioSection';
import { BiblePaneProvider } from '../../../components/BiblePaneContext';
import type { BiblePaneContextValue } from '../../../components/BiblePaneContext';
import { markAudioRequestedPane } from './paneRequest';

const en = enAudio as Record<string, string>;
let rig: Rig;

async function start(opts: Parameters<typeof buildRig>[0] = {}, style: 'bar' | 'popup' = 'bar') {
  rig = buildRig(opts);
  seedPane();
  store.setPlayerStyle(style);
  await store.sources('KJV');
  await flush();
}

beforeEach(() => { store.reset(); markAudioRequestedPane(null); });
afterEach(() => { cleanup(); store.reset(); vi.clearAllMocks(); });

const BarProps = { currentBook: 43, currentChapter: 3 };

describe('Listen button', () => {
  it('renders nothing while audio is off', () => {
    store.reset();
    seedPane();
    renderAudio(<ListenButton tabId="tab-1" />);
    expect(screen.queryByTestId('audio-listen')).toBeNull();
  });

  it('is disabled, with the reason as its tooltip, when nothing can play', async () => {
    await start({ engine: false });
    renderAudio(<ListenButton tabId="tab-1" />);
    const btn = await screen.findByTestId('audio-listen');
    await waitFor(() => expect(btn).toBeDisabled());
    expect(btn).toHaveAttribute('title', en['audio.notice.noAudio']);
  });

  it('plays, shows pressed state, the speaker badge, then Pause and Resume labels', async () => {
    await start();
    renderAudio(<ListenButton tabId="tab-1" />);
    const btn = await screen.findByTestId('audio-listen');
    await waitFor(() => expect(btn).toBeEnabled());
    expect(btn).toHaveAttribute('aria-label', en['audio.listen']);
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('audio-speaker-badge')).toBeNull();

    await act(async () => { fireEvent.click(btn); await flush(); });
    await waitFor(() => expect(store.status).toBe('playing'));
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(btn).toHaveAttribute('aria-label', en['audio.pause']);
    expect(screen.getByTestId('audio-speaker-badge')).toBeInTheDocument();

    await act(async () => { fireEvent.click(btn); await flush(); });
    expect(store.status).toBe('paused');
    expect(btn).toHaveAttribute('aria-label', en['audio.action.resume']);
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('player styles', () => {
  it('bar style: the transport bar shows in the playing pane; the pop-up does not', async () => {
    await start({}, 'bar');
    renderAudio(<><AudioTransportBar {...BarProps} /><AudioPlayerPopup /></>);
    expect(screen.queryByTestId('audio-transport')).toBeNull();
    await playNow();
    const bar = await screen.findByTestId('audio-transport');
    expect(bar).toHaveAttribute('role', 'toolbar');
    expect(screen.queryByTestId('audio-popup')).toBeNull();
    expect(screen.getByTestId('audio-now-playing')).toHaveTextContent('John 3:1');
    const slider = screen.getByTestId('audio-progress') as HTMLInputElement;
    expect(slider.type).toBe('range');
    expect(slider).toHaveAttribute('aria-valuetext', 'verse 1 of 5');
  });

  it('pop-up style: the pop-up shows, the bar does not, and it never steals focus', async () => {
    await start({}, 'popup');
    renderAudio(<><AudioTransportBar {...BarProps} /><AudioPlayerPopup /></>);
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    await playNow();
    const popup = await screen.findByTestId('audio-popup');
    expect(popup).toHaveAttribute('aria-modal', 'false');
    expect(screen.queryByTestId('audio-transport')).toBeNull();
    expect(document.activeElement).toBe(outside);
    expect(within(popup).getByTestId('audio-verse-pane')).toBeInTheDocument();
    const selected = within(popup).getAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent('Text of verse 1');
    outside.remove();
  });

  it('clicking a verse in the pop-up moves reading to it', async () => {
    await start({}, 'popup');
    renderAudio(<AudioPlayerPopup />);
    await playNow();
    const jump = vi.spyOn(store, 'jumpToVerse');
    fireEvent.click(await screen.findByText('Text of verse 3'));
    expect(jump).toHaveBeenCalledWith(3);
  });

  it('switching the style in the quick settings swaps bar and pop-up', async () => {
    await start({}, 'bar');
    renderAudio(<><AudioTransportBar {...BarProps} /><AudioPlayerPopup /></>);
    await playNow();
    await screen.findByTestId('audio-transport');
    await act(async () => { store.setPlayerStyle('popup'); });
    expect(screen.queryByTestId('audio-transport')).toBeNull();
    expect(screen.getByTestId('audio-popup')).toBeInTheDocument();
  });

  it('the idle "no audio" strip shows once, in the pane that asked, in either style', async () => {
    // Pressed before the availability check settled, so play() runs the check and ends in the "no audio" notice.
    rig = buildRig({ engine: false });
    seedPane();
    store.setPlayerStyle('popup');
    renderAudio(<AudioTransportBar {...BarProps} />);
    markAudioRequestedPane(PANEL);
    await act(async () => { await store.play(PANEL); });
    const strip = await screen.findByTestId('audio-transport');
    expect(strip).toHaveTextContent(en['audio.notice.noAudio']);
    fireEvent.click(screen.getByText(en['audio.action.dismiss']));
    expect(screen.queryByTestId('audio-transport')).toBeNull();
  });
});

describe('speed popover', () => {
  it('shows the rate and picks another from the source speeds', async () => {
    await start();
    renderAudio(<AudioTransportBar {...BarProps} />);
    await playNow();
    const btn = await screen.findByTestId('audio-speed-button');
    expect(btn).toHaveTextContent('1.0×');
    fireEvent.click(btn);
    const list = await screen.findByRole('listbox', { name: en['audio.speed.label'] });
    expect(within(list).getAllByRole('option').length).toBeGreaterThan(3);
    fireEvent.click(within(list).getByText('1.5×'));
    expect(store.prefs.rate).toBe(1.5);
    await waitFor(() => expect(screen.getByTestId('audio-speed-button')).toHaveTextContent('1.5×'));
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('gate dialog', () => {
  it('asks before downloading a voice: cancel downloads nothing, confirm plays', async () => {
    await start();
    rig.tts.needsDownload = true;
    rig.tts.ready = false;
    renderAudio(<AudioGateDialog />);
    const p = store.play(PANEL);
    await flush();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(en['audio.gate.downloadTitle']);
    expect(dialog).toHaveTextContent('63 MB');
    fireEvent.click(screen.getByText(en['audio.action.cancel']));
    await p;
    expect(rig.tts.prepareCalls).toBe(0);
    expect(store.status).toBe('idle');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const q = store.play(PANEL);
    await flush();
    fireEvent.click(await screen.findByText(en['audio.gate.downloadAndPlay']));
    await q;
    await flush();
    expect(rig.tts.prepareCalls).toBe(1);
    expect(store.status).toBe('playing');
  });
});

describe('live region', () => {
  it('announces started, paused, resumed and stopped, never the position', async () => {
    await start();
    renderAudio(<AudioLiveRegion />);
    const live = screen.getByTestId('audio-live');
    expect(live).toHaveAttribute('aria-live', 'polite');
    await playNow();
    await waitFor(() => expect(live).toHaveTextContent('Playing John 3'));
    await act(async () => { store.pause(); await flush(); });
    expect(live).toHaveTextContent(en['audio.announce.paused']);
    await act(async () => { store.resume(); await flush(); });
    expect(live).toHaveTextContent(/Resumed at John 3/);
    await act(async () => { store.stop(); await flush(); });
    expect(live).toHaveTextContent(en['audio.announce.stopped']);
  });
});

describe('quick settings', () => {
  it('changes the source for the translation and the player style', async () => {
    await start();
    renderAudio(<AudioQuickSettings moduleAbbr="KJV" />, { pane: false });
    const group = await screen.findByRole('radiogroup', { name: 'Source for KJV' });
    // Recorded is unusable (no recording) and says why; Generated can be picked.
    const recorded = within(group).getByRole('radio', { name: en['audio.source.recorded'] });
    expect(recorded).toBeDisabled();
    expect(screen.getByTestId('audio-source-reasons')).toHaveTextContent('No recording for KJV.');
    fireEvent.click(within(group).getByRole('radio', { name: en['audio.source.generated'] }));
    expect(store.prefs.perTranslation.KJV?.source).toBe('tts:fake');
    fireEvent.click(screen.getByRole('radio', { name: en['audio.style.popup'] }));
    expect(store.prefs.playerStyle).toBe('popup');
  });

  it('"All audio settings" opens Preferences at the Audio section', async () => {
    await start();
    const seen: unknown[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener('open-preferences-section', on);
    renderAudio(<AudioQuickSettings moduleAbbr="KJV" />, { pane: false });
    fireEvent.click(await screen.findByTestId('audio-all-settings'));
    window.removeEventListener('open-preferences-section', on);
    expect(seen).toEqual(['audio']);
  });
});

describe('Preferences > Audio section', () => {
  it('renders the toggles, storage and the Phase 5 slot; toggles write the prefs', async () => {
    await start();
    renderAudio(<AudioSection />, { pane: false });
    const section = await screen.findByTestId('audio-section');
    expect(within(section).getByTestId('audio-downloads-slot')).toBeInTheDocument();
    const follow = within(section).getByLabelText(en['audio.settings.followAlong']) as HTMLInputElement;
    expect(follow.checked).toBe(true);
    fireEvent.click(follow);
    expect(store.prefs.followAlong).toBe(false);
    expect(within(section).getByLabelText(en['audio.settings.continue'])).toBeInTheDocument();
    expect(within(section).getByLabelText(en['audio.settings.autoScroll'])).toBeInTheDocument();
    expect(within(section).getByLabelText(en['audio.settings.intro'])).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('audio-storage-voices')).toHaveTextContent('63 MB'));
  });

  it('lists voices with their size and downloads one', async () => {
    await start();
    renderAudio(<AudioSection />, { pane: false });
    const row = await screen.findByTestId('audio-voice-row');
    expect(row).toHaveTextContent('Amy');
    expect(row).toHaveTextContent('63 MB');
    fireEvent.click(within(row).getByText(en['audio.settings.download']));
    await waitFor(() => expect(within(screen.getByTestId('audio-voice-row')).getByText(en['audio.settings.remove'])).toBeInTheDocument());
    expect(rig.engine.prepared.has('amy')).toBe(true);
  });

  it('removes downloaded voices through the asset store', async () => {
    await start();
    renderAudio(<AudioSection />, { pane: false });
    await waitFor(() => expect(screen.getByTestId('audio-storage-voices')).toHaveTextContent('63 MB'));
    fireEvent.click(screen.getByText(en['audio.settings.removeVoices']));
    await waitFor(() => expect(assetsAPI.remove).toHaveBeenCalledWith('tts-voice:en_US-amy-low'));
    expect(assetsAPI.remove).not.toHaveBeenCalledWith('module:kjv');
  });
});

describe('passages playlist', () => {
  const typeList = async (text: string) => {
    const input = await screen.findByTestId('audio-passages-input');
    fireEvent.change(input, { target: { value: text } });
    return input;
  };

  it('the Listen chevron opens the pop-up idle, with the editor prefilled with the current chapter', async () => {
    await start({}, 'bar');
    renderAudio(<><ListenButton tabId="tab-1" /><AudioPlayerPopup /></>);
    expect(screen.queryByTestId('audio-popup')).toBeNull();
    fireEvent.click(await screen.findByTestId('audio-passages-open'));
    expect(await screen.findByTestId('audio-popup')).toBeInTheDocument();
    expect(store.targetTabId).toBe(PANEL);
    expect(screen.getByTestId('audio-passages-input')).toHaveValue('John 3');
    await waitFor(() => expect(screen.getByTestId('audio-passages-play')).toBeEnabled());
    expect(screen.queryByTestId('audio-play-pause')).toBeNull();
  });

  it('shows chips, an error for a bad name, and disables Play until the list parses', async () => {
    await start({}, 'bar');
    store.openPlayer();
    renderAudio(<AudioPlayerPopup />);
    await typeList('Ps 23; Rom 8:28-39');
    await waitFor(() => expect(screen.getAllByTestId('audio-passage-chip')).toHaveLength(2));
    expect(screen.getByTestId('audio-passages-play')).toBeEnabled();
    await typeList('Ps 23; Blorp 3');
    await waitFor(() => expect(screen.getByTestId('audio-passages-error')).toHaveTextContent('“Blorp 3” does not name a book of the Bible.'));
    expect(screen.getByTestId('audio-passages-error')).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('audio-passages-play')).toBeDisabled();
    await typeList('Ps 999');
    await waitFor(() => expect(screen.getByTestId('audio-passages-error')).toHaveTextContent('past the end'));
  });

  it('Enter plays the typed list through the store', async () => {
    await start({}, 'popup');
    store.openPlayer();
    renderAudio(<AudioPlayerPopup />);
    const play = vi.spyOn(store, 'playPassages').mockResolvedValue();
    const input = await typeList('John 3:16-18; John 4');
    await waitFor(() => expect(screen.getAllByTestId('audio-passage-chip')).toHaveLength(2));
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(play).toHaveBeenCalledTimes(1);
    expect(play.mock.calls[0][1]).toEqual([{ book: 43, chapter: 3, verse: 16, endVerse: 18 }, { book: 43, chapter: 4 }]);
    play.mockRestore();
  });

  it('removing a chip rewrites the list', async () => {
    await start({}, 'bar');
    store.openPlayer();
    renderAudio(<AudioPlayerPopup />);
    await typeList('Ps 23; John 3');
    await waitFor(() => expect(screen.getAllByTestId('audio-passage-chip')).toHaveLength(2));
    fireEvent.click(within(screen.getAllByTestId('audio-passage-chip')[0]).getByRole('button'));
    await waitFor(() => expect(screen.getAllByTestId('audio-passage-chip')).toHaveLength(1));
    expect(screen.getByTestId('audio-passages-input')).toHaveValue('John 3');
  });

  it('plays a list: progress, prev/next passage, no chapter buttons', async () => {
    await start({}, 'popup');
    renderAudio(<AudioPlayerPopup />);
    await act(async () => { await store.playPassages(PANEL, [{ book: 43, chapter: 3, verse: 2, endVerse: 4 }, { book: 43, chapter: 3, verse: 5 }]); await flush(); });
    await screen.findByTestId('audio-popup');
    expect(screen.getByTestId('audio-passage-progress')).toHaveTextContent('1 of 2 · John 3:2-4');
    expect(screen.queryByTestId('audio-prev-chapter')).toBeNull();
    expect(screen.queryByTestId('audio-next-chapter')).toBeNull();
    expect(screen.getByTestId('audio-prev-passage')).toBeDisabled();
    await act(async () => { fireEvent.click(screen.getByTestId('audio-next-passage')); await flush(); });
    expect(screen.getByTestId('audio-passage-progress')).toHaveTextContent('2 of 2 · John 3:5');
    expect(screen.getByTestId('audio-next-passage')).toBeDisabled();
    expect(screen.getByTestId('audio-prev-passage')).toBeEnabled();
  });

  it('the continue checkbox and loop control are the shared prefs', async () => {
    await start({}, 'bar');
    store.openPlayer();
    renderAudio(<AudioPlayerPopup />);
    const cont = await screen.findByTestId('audio-continue');
    expect(cont).toBeChecked();
    fireEvent.click(cont);
    expect(store.prefs.continueAfterChapter).toBe('stop');
    fireEvent.click(screen.getByTestId('audio-loop-list'));
    expect(store.prefs.passageLoop).toBe('list');
    expect(screen.getByTestId('audio-loop-list')).toHaveAttribute('aria-checked', 'true');
  });

  it('quick settings carry the same loop and continue controls', async () => {
    await start({}, 'bar');
    renderAudio(<AudioQuickSettings moduleAbbr="KJV" />);
    fireEvent.click(await screen.findByTestId('audio-quick-loop-passage'));
    expect(store.prefs.passageLoop).toBe('passage');
    fireEvent.click(screen.getByTestId('audio-quick-continue'));
    expect(store.prefs.continueAfterChapter).toBe('stop');
  });

  it('in a pane that is not the one being read, the bar shows the elsewhere strip', async () => {
    await start({}, 'bar');
    await playNow();
    const other = { panelId: 'pane-2', activeTab: { tabId: 'tab-2', abbreviation: 'KJV' }, currentVerses: [], isLoading: false } as unknown as BiblePaneContextValue;
    renderAudio(<BiblePaneProvider value={other}><AudioTransportBar {...BarProps} /></BiblePaneProvider>, { pane: false });
    const strip = await screen.findByTestId('audio-elsewhere');
    expect(strip).toHaveTextContent('Reading in another tab');
    const reveal = vi.spyOn(store, 'revealPlayingTab');
    fireEvent.click(screen.getByTestId('audio-goto-tab'));
    expect(reveal).toHaveBeenCalled();
    expect(screen.queryByTestId('audio-transport')).toBeNull();
  });
});
