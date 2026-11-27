import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/preact';

vi.mock('react-i18next', async importOriginal => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string, o?: Record<string, unknown>) => (o ? `${key} ${JSON.stringify(o)}` : key), i18n: { language: 'en' } }),
}));

import { audioStore } from '../audioStore';
import { bibleStore } from '../../../stores/bibleStore';
import { AudioPlaylist, PassagesButton } from './AudioPlaylist';
import { PlaybackToggles } from './PlaybackToggles';
import { AudioPassageProgress } from './AudioPassageProgress';
import { AudioTransportButtons } from './AudioTransportButtons';
import { openChapter } from '../lib/uiRig';

describe('AudioPlaylist', () => {
  beforeEach(async () => {
    audioStore.reset();
    audioStore.enabled = true;
    await openChapter(43, 3);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); audioStore.reset(); });

  const noop = () => {};

  it('is closed until asked for (the current chapter is read); the button toggles it', () => {
    let open = false;
    const { rerender } = render(<><PassagesButton open={open} onToggle={() => { open = !open; }} /><AudioPlaylist open={open} onClose={noop} /></>);
    expect(screen.queryByTestId('audio-passages-input')).toBeNull();
    fireEvent.click(screen.getByTestId('audio-playlist-toggle'));
    rerender(<><PassagesButton open={open} onToggle={() => { open = !open; }} /><AudioPlaylist open={open} onClose={noop} /></>);
    expect((screen.getByTestId('audio-passages-input') as HTMLInputElement).value).toBe('');
    expect(screen.getByTestId('audio-playlist-toggle').getAttribute('aria-expanded')).toBe('true');
  });

  it('plays a typed list on Enter and closes', () => {
    const spy = vi.spyOn(audioStore, 'playPassages').mockResolvedValue();
    const onClose = vi.fn();
    render(<AudioPlaylist open onClose={onClose} />);
    const input = screen.getByTestId('audio-passages-input');
    fireEvent.input(input, { target: { value: 'Ps 23; Rom 8:28-39' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toEqual([
      { book: 19, chapter: 23 },
      { book: 45, chapter: 8, verse: 28, endVerse: 39 },
    ]);
    expect(spy.mock.calls[0][0]).toBe(bibleStore.activeTabId);
    expect(onClose).toHaveBeenCalled();
  });

  it('Play targets the pane picked on the Listen button over the playing tab', () => {
    const spy = vi.spyOn(audioStore, 'playPassages').mockResolvedValue();
    audioStore.playingTabId = 'playing-tab';
    audioStore.targetTabId = 'picked-tab';
    render(<AudioPlaylist open onClose={noop} />);
    const input = screen.getByTestId('audio-passages-input');
    fireEvent.input(input, { target: { value: 'Ps 23' } });
    fireEvent.click(screen.getByTestId('audio-passages-play'));
    expect(spy.mock.calls[0][0]).toBe('picked-tab');
  });

  it('says plainly what was not understood, plays nothing, and clears the message on typing', () => {
    const spy = vi.spyOn(audioStore, 'playPassages').mockResolvedValue();
    render(<AudioPlaylist open onClose={noop} />);
    const input = screen.getByTestId('audio-passages-input');
    expect((screen.getByTestId('audio-passages-play') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.input(input, { target: { value: 'Flurb 3' } });
    expect(screen.queryByTestId('audio-passages-error')).toBeNull(); // nothing while typing
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByTestId('audio-passages-error').textContent).toContain('audio.passages.error.noBook');
    fireEvent.input(input, { target: { value: 'Ps 23' } });
    expect(screen.queryByTestId('audio-passages-error')).toBeNull();
  });

  it('"Just this chapter" shows only for a typed list and goes back to the chapter', async () => {
    const { rerender } = render(<AudioPlaylist open onClose={noop} />);
    expect(screen.queryByTestId('audio-playlist-chapter')).toBeNull();
    audioStore.status = 'playing';
    audioStore.queue = { kind: 'list', passages: [{ book: 19, chapter: 23 }], index: 0 };
    audioStore.setPassageLoop('list'); // notifies
    rerender(<AudioPlaylist open onClose={noop} />);
    const spy = vi.spyOn(audioStore, 'useChapterList').mockImplementation(() => {});
    const just = await screen.findByTestId('audio-playlist-chapter');
    expect(just.textContent).toContain('audio.passages.useChapter');
    fireEvent.click(just);
    expect(spy).toHaveBeenCalled();
  });

  it('Repeat and Continue are on/off switches that write the shared prefs', () => {
    render(<PlaybackToggles />);
    const repeat = screen.getByTestId('audio-repeat');
    expect(repeat.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(repeat);
    expect(audioStore.prefs.passageLoop).toBe('list');
    expect(repeat.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('audio.loop.on');
    fireEvent.click(repeat);
    expect(audioStore.prefs.passageLoop).toBe('once');
    const cont = screen.getByTestId('audio-continue');
    const before = audioStore.prefs.continueAfterChapter;
    fireEvent.click(cont);
    expect(audioStore.prefs.continueAfterChapter).toBe(before === 'stop' ? 'next-chapter' : 'stop');
    expect(cont.getAttribute('aria-checked')).toBe(String(before === 'stop'));
  });

  it('with a typed list: shown read-only with an edit button; editing shows Save and Cancel', () => {
    audioStore.status = 'playing';
    audioStore.queue = { kind: 'list', passages: [{ book: 19, chapter: 23 }], index: 0 };
    render(<AudioPlaylist open onClose={noop} />);
    expect(screen.queryByTestId('audio-passages-input')).toBeNull();
    expect(screen.getByTestId('audio-playlist-current').textContent).toContain('23');
    fireEvent.click(screen.getByTestId('audio-playlist-edit'));
    expect((screen.getByTestId('audio-passages-input') as HTMLInputElement).value).toContain('23');
    expect(screen.getByTestId('audio-passages-play').textContent).toBe('audio.passages.save');
    fireEvent.click(screen.getByTestId('audio-passages-cancel'));
    expect(screen.queryByTestId('audio-passages-input')).toBeNull();
  });

  it('Continue is disabled while a typed list plays', async () => {
    render(<PlaybackToggles />);
    audioStore.status = 'playing';
    audioStore.queue = { kind: 'list', passages: [{ book: 19, chapter: 23 }], index: 0 };
    audioStore.setPassageLoop('list'); // notifies
    await waitFor(() => expect((screen.getByTestId('audio-continue') as HTMLButtonElement).disabled).toBe(true));
  });

  it('progress and prev/next passage show only for a typed list', async () => {
    render(<><AudioPassageProgress /><AudioTransportButtons /></>);
    expect(screen.queryByTestId('audio-passage-progress')).toBeNull();
    expect(screen.queryByTestId('audio-next-passage')).toBeNull();
    audioStore.status = 'playing';
    audioStore.queue = { kind: 'list', passages: [{ book: 19, chapter: 23 }, { book: 45, chapter: 8 }], index: 0 };
    audioStore.setPassageLoop('list'); // notifies
    expect((await screen.findByTestId('audio-passage-progress')).textContent).toContain('"index":1');
    expect((screen.getByTestId('audio-prev-passage') as HTMLButtonElement).disabled).toBe(true);
    const next = vi.spyOn(audioStore, 'nextPassage').mockImplementation(() => {});
    fireEvent.click(screen.getByTestId('audio-next-passage'));
    expect(next).toHaveBeenCalled();
  });
});
