import { describe, it, expect, vi, afterEach } from 'vitest';
import { audioStore } from './audioStore';
import { bibleStore } from '../../stores/bibleStore';
import { buildUiRig, flush, openChapter } from './lib/uiRig';
import { watchVerseClicks } from './verseClicks';

afterEach(() => { audioStore.reset(); vi.restoreAllMocks(); });

describe('watchVerseClicks', () => {
  it('in the playing tab, a clicked verse of the chapter being read is read next; nothing while idle', async () => {
    buildUiRig({});
    await openChapter();
    await flush();
    const off = watchVerseClicks();
    const jump = vi.spyOn(audioStore, 'jumpToVerse').mockImplementation(() => {});
    const tab = bibleStore.getActiveTab()!;
    const base = tab.verses[0].verse_id - (tab.verses[0].verse_id % 1000);

    bibleStore.setStudyVerse(base + 2); // idle: only selects
    expect(jump).not.toHaveBeenCalled();

    const p = audioStore.play();
    await flush();
    await p;
    await flush();
    expect(audioStore.follow.verseId).not.toBeNull();
    bibleStore.setStudyVerse(base + 3);
    expect(jump).toHaveBeenCalledWith(3);
    off();
  });
});
