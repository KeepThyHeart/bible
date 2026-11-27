import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/preact';

vi.mock('react-i18next', async importOriginal => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string, o?: Record<string, unknown>) => (o ? `${key} ${JSON.stringify(o)}` : key), i18n: { language: 'en' } }),
}));

import { audioStore } from '../audioStore';
import { bibleStore } from '../../../stores/bibleStore';
import { moduleStore } from '../../../stores/moduleStore';
import { openChapter } from '../lib/uiRig';
import { AudioFinished, nextChapterOf } from './AudioFinished';

describe('AudioFinished', () => {
  beforeEach(async () => {
    audioStore.reset();
    audioStore.enabled = true;
    await openChapter(43, 3);
    // Real chapter counts (the fixture Bible is short).
    const counts: Record<number, number> = { 43: 21, 66: 22 };
    vi.spyOn(moduleStore, 'getBookByNumber').mockImplementation(n => ({ chapter_count: counts[n] ?? 10 }) as ReturnType<typeof moduleStore.getBookByNumber>);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); audioStore.reset(); });

  it('shows nothing until a chapter was read to its end', () => {
    render(<AudioFinished variant="phone" />);
    expect(screen.queryByTestId('audio-finished')).toBeNull();
  });

  it('offers the next chapter: turns the page, opens the phone player and plays; the cross dismisses', async () => {
    const tabId = bibleStore.activeTabId!;
    audioStore.finished = { tabId, moduleAbbr: 'KJV', book: 43, chapter: 3 };
    const nav = vi.spyOn(bibleStore, 'navigateTo').mockResolvedValue();
    const play = vi.spyOn(audioStore, 'play').mockResolvedValue();
    render(<AudioFinished variant="phone" />);
    expect(screen.getByTestId('audio-finished').textContent).toContain('"ref":"John 3"');
    fireEvent.click(screen.getByTestId('audio-finished-next'));
    await waitFor(() => expect(play).toHaveBeenCalledWith(tabId));
    expect(nav).toHaveBeenCalledWith(43, 4, undefined, { tabId });
    expect(audioStore.playerOpen).toBe(true);
    cleanup();
    render(<AudioFinished variant="desktop" />);
    fireEvent.click(screen.getByLabelText('audio.action.dismiss'));
    expect(audioStore.finished).toBeNull();
  });

  it('the next chapter crosses into the next book, and there is none after Revelation 22', () => {
    expect(nextChapterOf(43, 3)).toEqual({ book: 43, chapter: 4 });
    expect(nextChapterOf(43, 21)).toEqual({ book: 44, chapter: 1 });
    expect(nextChapterOf(66, 22)).toBeNull();
  });
});
