import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/preact';

vi.mock('react-i18next', async importOriginal => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}${JSON.stringify(opts)}` : key),
    i18n: { language: 'en' },
  }),
}));

import { audioStore } from '../../stores/audioStore';
import { bibleStore } from '../../stores/bibleStore';
import { commentaryStore } from '../../stores/commentaryStore';
import { buildUiRig, flush, openChapter, chapterVerses } from '../../audio/uiRig';
import { USER_SCROLL_PAUSE_MS } from '../../hooks/useFollowScroll';
import { AudioVersePane } from './AudioVersePane';

const V = (n: number, chapter = 3) => 43_000_000 + chapter * 1_000 + n;
let clock = 0;
let scrollTo: ReturnType<typeof vi.fn>;
/** Viewport top of each verse, by verse id; the scroller spans 0..400. */
let verseTop: (id: number) => number;
let tabId: string;

const rect = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

beforeEach(async () => {
  clock = 1_000_000;
  verseTop = id => ((id % 1000) - 1) * 100 - 200; // verse 3 sits at 0, verse 5 at 200...
  scrollTo = vi.fn();
  HTMLElement.prototype.scrollTo = scrollTo as unknown as typeof HTMLElement.prototype.scrollTo;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.classList.contains('audio-verses')) return rect(0, 400);
    const id = this.getAttribute('data-verse-id');
    return id ? rect(verseTop(Number(id)), 40) : rect(0, 0);
  };
  for (const [prop, value] of [['clientHeight', 400], ['scrollHeight', 2000]] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { value, configurable: true });
  }
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  buildUiRig();
  const tab = await openChapter();
  tabId = tab.id;
  const p = audioStore.play();
  await flush();
  await p;
  await flush();
  audioStore.follow.set(tabId, V(2));
});
afterEach(() => { cleanup(); audioStore.reset(); vi.restoreAllMocks(); });

const pane = () => render(<AudioVersePane variant="popup" now={() => clock} />);
const verseEl = (n: number) => document.querySelector<HTMLElement>(`[data-verse-id="${V(n)}"]`)!;
const listbox = () => screen.getByRole('listbox');
const lastCall = () => scrollTo.mock.calls[scrollTo.mock.calls.length - 1][0] as { top: number; behavior: string };

const notifyBible = () => (bibleStore as unknown as { notify(): void }).notify();

async function settle() { await act(async () => { await new Promise(r => setTimeout(r, 30)); }); }

describe('AudioVersePane', () => {
  it('renders the verses as options and highlights the one being read', async () => {
    pane();
    await settle();
    expect(screen.getAllByRole('option')).toHaveLength(5);
    expect(verseEl(2).classList.contains('verse--playing')).toBe(true);
    expect(verseEl(3).classList.contains('verse--playing')).toBe(false);
    expect(listbox().getAttribute('aria-activedescendant')).toBe(`audio-v-${V(2)}`);
  });

  it('follows the reading verse with a smooth scrollTo on the pane only', async () => {
    pane();
    await settle();
    scrollTo.mockClear();
    act(() => { audioStore.follow.set(tabId, V(4)); });
    await settle();
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(lastCall().behavior).toBe('smooth');
  });

  it('uses instant scrolling under reduced motion', async () => {
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    pane();
    await settle();
    scrollTo.mockClear();
    act(() => { audioStore.follow.set(tabId, V(4)); });
    await settle();
    expect(lastCall().behavior).toBe('auto');
  });

  it('shows a spinner during a chapter turn, then lands once, instantly', async () => {
    pane();
    await settle();
    scrollTo.mockClear();
    act(() => { audioStore.follow.set(tabId, V(1, 4)); });
    await settle();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(document.querySelector('.audio-verses__spinner')).not.toBeNull();
    expect(scrollTo).not.toHaveBeenCalled();
    const tab = bibleStore.tabs.find(x => x.id === tabId)!;
    // The store's own page turn records its target before the tab navigates.
    const owner = audioStore as unknown as { followTarget: { chapter: number } };
    owner.followTarget = { ...owner.followTarget, chapter: 4 };
    tab.chapter = 4;
    tab.verses = chapterVerses(43, 4);
    act(() => { notifyBible(); });
    await settle();
    expect(screen.getAllByRole('option')).toHaveLength(5);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(lastCall().behavior).toBe('auto');
  });

  it('does not follow for 8 s after the reader scrolls, shows "Back to", then resumes', async () => {
    pane();
    await settle();
    fireEvent.wheel(listbox());
    scrollTo.mockClear();
    verseTop = id => ((id % 1000) - 1) * 100 + 600; // the reading verse is below the fold
    act(() => { audioStore.follow.set(tabId, V(3)); });
    await settle();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(screen.getByText(`audio.verses.backTo${JSON.stringify({ verse: 3 })}`)).toBeTruthy();

    clock += USER_SCROLL_PAUSE_MS + 1;
    act(() => { audioStore.follow.set(tabId, V(4)); });
    await settle();
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/audio.verses.backTo/)).toBeNull();
  });

  it('"Back to" recentres at once and clears the pause', async () => {
    pane();
    await settle();
    fireEvent.pointerDown(listbox());
    verseTop = id => ((id % 1000) - 1) * 100 + 600;
    act(() => { audioStore.follow.set(tabId, V(3)); });
    await settle();
    scrollTo.mockClear();
    fireEvent.click(screen.getByText(/audio.verses.backTo/));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(lastCall().behavior).toBe('auto');
    act(() => { audioStore.follow.set(tabId, V(4)); });
    await settle();
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it('keys in the main pane do not pause it', async () => {
    pane();
    await settle();
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    scrollTo.mockClear();
    act(() => { audioStore.follow.set(tabId, V(4)); });
    await settle();
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('a click jumps to the verse and leaves the Bible pane and commentary alone', async () => {
    const jump = vi.spyOn(audioStore, 'jumpToVerse').mockImplementation(() => {});
    const load = vi.spyOn(commentaryStore, 'loadForChapter');
    const tab = bibleStore.tabs.find(x => x.id === tabId)!;
    const before = { s: tab.studyVerse, p: tab.previewVerse, h: bibleStore.tabs.length };
    pane();
    await settle();
    fireEvent.click(verseEl(5));
    expect(jump).toHaveBeenCalledWith(5);
    expect(tab.studyVerse).toBe(before.s);
    expect(tab.previewVerse).toBe(before.p);
    expect(bibleStore.tabs.length).toBe(before.h);
    expect(load).not.toHaveBeenCalled();
  });

  it('ignores a click while text is selected', async () => {
    const jump = vi.spyOn(audioStore, 'jumpToVerse').mockImplementation(() => {});
    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'some words' } as unknown as Selection);
    pane();
    await settle();
    fireEvent.click(verseEl(5));
    expect(jump).not.toHaveBeenCalled();
  });

  it('moves a cursor with the arrows and jumps with Enter', async () => {
    const jump = vi.spyOn(audioStore, 'jumpToVerse').mockImplementation(() => {});
    pane();
    await settle();
    fireEvent.keyDown(listbox(), { key: 'ArrowDown' });
    fireEvent.keyDown(listbox(), { key: 'ArrowDown' });
    expect(listbox().getAttribute('aria-activedescendant')).toBe(`audio-v-${V(4)}`);
    expect(document.getElementById(`audio-v-${V(4)}`)!.classList.contains('audio-verses__opt--cursor')).toBe(true);
    fireEvent.keyDown(listbox(), { key: 'Enter' });
    expect(jump).toHaveBeenCalledWith(4);
  });

  it('shows "Read from" only when the selection is in this chapter and differs from the verse read', async () => {
    const tab = bibleStore.tabs.find(x => x.id === tabId)!;
    tab.studyVerse = null;
    pane();
    await settle();
    expect(screen.queryByText(/audio.verses.readFrom/)).toBeNull();
    act(() => { tab.studyVerse = V(2); notifyBible(); });
    expect(screen.queryByText(/audio.verses.readFrom/)).toBeNull(); // same as the verse being read
    act(() => { tab.studyVerse = V(5); notifyBible(); });
    const pill = screen.getByText(/audio.verses.readFrom/);
    const jump = vi.spyOn(audioStore, 'jumpToVerse').mockImplementation(() => {});
    fireEvent.click(pill);
    expect(jump).toHaveBeenCalledWith(5);
    act(() => { tab.studyVerse = V(5, 9); notifyBible(); });
    expect(screen.queryByText(/audio.verses.readFrom/)).toBeNull(); // another chapter
  });

  it('does not offer "Read from" for the selection playback started from, only for a later change', async () => {
    const tab = bibleStore.tabs.find(x => x.id === tabId)!;
    tab.studyVerse = V(1); // play-from-selection: the reading moves on, the selection stays
    pane();
    await settle();
    expect(screen.queryByText(/audio.verses.readFrom/)).toBeNull();
    act(() => { audioStore.follow.set(tabId, V(3)); });
    expect(screen.queryByText(/audio.verses.readFrom/)).toBeNull();
    act(() => { tab.studyVerse = V(6); notifyBible(); });
    expect(screen.queryByText(/audio.verses.readFrom/)).not.toBeNull();
  });
});
