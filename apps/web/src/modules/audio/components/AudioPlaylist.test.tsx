import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';

vi.mock('react-i18next', async importOriginal => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string, o?: Record<string, unknown>) => (o ? `${key} ${JSON.stringify(o)}` : key), i18n: { language: 'en' } }),
}));

import { audioStore } from '../audioStore';
import { bibleStore } from '../../../stores/bibleStore';
import { AudioPlaylist } from './AudioPlaylist';
import { PassageOptions } from './PassageOptions';
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

  it('shows the current chapter, and the editor opens on Change', () => {
    render(<AudioPlaylist />);
    expect(screen.getByTestId('audio-playlist-current').textContent).toContain('3');
    expect(screen.queryByTestId('audio-passages-input')).toBeNull();
    fireEvent.click(screen.getByTestId('audio-playlist-edit'));
    expect((screen.getByTestId('audio-passages-input') as HTMLInputElement).value).toContain('3');
  });

  it('parses a typed list into chips and plays it on Enter', async () => {
    const spy = vi.spyOn(audioStore, 'playPassages').mockResolvedValue();
    render(<AudioPlaylist startExpanded />);
    const input = screen.getByTestId('audio-passages-input');
    fireEvent.input(input, { target: { value: 'Ps 23; Rom 8:28-39' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(spy).toHaveBeenCalledTimes(1);
    const passages = spy.mock.calls[0][1];
    expect(passages).toEqual([
      { book: 19, chapter: 23 },
      { book: 45, chapter: 8, verse: 28, endVerse: 39 },
    ]);
    expect(spy.mock.calls[0][0]).toBe(bibleStore.activeTabId);
  });

  it('shows an error and does not play for a bad reference', () => {
    const spy = vi.spyOn(audioStore, 'playPassages').mockResolvedValue();
    render(<AudioPlaylist startExpanded />);
    const input = screen.getByTestId('audio-passages-input');
    fireEvent.input(input, { target: { value: 'Flurb 3' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByTestId('audio-passages-error').textContent).toContain('audio.passages.error.noBook');
    expect((screen.getByTestId('audio-passages-play') as HTMLButtonElement).disabled).toBe(true);
  });

  it('the continue checkbox and the loop control write the shared prefs', () => {
    render(<PassageOptions prefix="audio-quick" />);
    const before = audioStore.prefs.continueAfterChapter;
    fireEvent.click(screen.getByTestId('audio-quick-continue'));
    expect(audioStore.prefs.continueAfterChapter).toBe(before === 'stop' ? 'next-chapter' : 'stop');
    fireEvent.click(screen.getByTestId('audio-quick-loop-passage'));
    expect(audioStore.prefs.passageLoop).toBe('passage');
    expect(screen.getByTestId('audio-quick-loop-passage').getAttribute('aria-checked')).toBe('true');
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
