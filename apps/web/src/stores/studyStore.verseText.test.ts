/**
 * The Study pane's interlinear is built from the *translation's* own words, so
 * it needs the selected verse's `text_html`. That text used to come only from
 * the Bible pane's open chapter, which meant that any time the pane was
 * somewhere else the section silently degraded to a list of the module's
 * glosses — different wording, different order, blank where a row has no gloss.
 *
 * These tests pin the replacement: fetch the verse, through the tab's own
 * translation, and never hand back text belonging to another verse or module.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const fetchVerse = vi.fn();
let activeTab: { moduleAbbr: string; verses: Array<{ verse_id: number; text_html: string }> } | null =
  { moduleAbbr: 'KJV', verses: [] };

vi.mock('./bibleStore', () => ({
  bibleStore: {
    getActiveTab: () => activeTab,
    fetchVerse: (module: string, verseId: number) => fetchVerse(module, verseId),
  },
}));

import { studyStore } from './studyStore';

/**
 * Select the verse *and* mount the interlinear section, then give the promise a
 * turn to settle.
 *
 * The two steps are separate because only the interlinear section needs this
 * text, and it is collapsed until the reader opens it — so `loadForVerse` marks
 * it stale and `ensureInterlinear` is what actually fetches. See the test below
 * that pins the selection alone fetching nothing.
 */
async function selectJohn316(): Promise<void> {
  studyStore.loadForVerse(43003016, 43, 3, 16);
  studyStore.ensureInterlinear();
  await Promise.resolve();
  await Promise.resolve();
}

describe('studyStore verse text', () => {
  beforeEach(() => {
    fetchVerse.mockReset();
    fetchVerse.mockResolvedValue({ verse_id: 43003016, text_html: 'For God so loved the world' });
    activeTab = { moduleAbbr: 'KJV', verses: [] };
    studyStore.pinned = false;
    studyStore.verseId = null;
    (studyStore as unknown as { verseHtml: string | null }).verseHtml = null;
    (studyStore as unknown as { verseHtmlKey: string }).verseHtmlKey = '';
    studyStore.verseHtmlLoading = false;
  });

  it('fetches the verse text when the Bible pane is on another chapter', async () => {
    activeTab = { moduleAbbr: 'KJV', verses: [{ verse_id: 41001001, text_html: 'Mark 1:1' }] };
    await selectJohn316();

    expect(fetchVerse).toHaveBeenCalledWith('KJV', 43003016);
    expect(studyStore.getVerseHtml()).toBe('For God so loved the world');
    expect(studyStore.verseHtmlLoading).toBe(false);
  });

  it('does not fetch until the interlinear section asks for it', async () => {
    activeTab = { moduleAbbr: 'KJV', verses: [{ verse_id: 41001001, text_html: 'Mark 1:1' }] };
    studyStore.loadForVerse(43003016, 43, 3, 16);
    await Promise.resolve();
    await Promise.resolve();

    // Selecting a verse happens on every chapter change, whether or not the
    // Study pane is the one on screen; paying for this text there was the
    // waste. Nothing has rendered the interlinear yet, so nothing is owed.
    expect(fetchVerse).not.toHaveBeenCalled();
  });

  it("asks for the tab's own translation, not a default", async () => {
    activeTab = { moduleAbbr: 'ASV', verses: [] };
    await selectJohn316();
    expect(fetchVerse).toHaveBeenCalledWith('ASV', 43003016);
  });

  it('does not fetch when the Bible pane already has the verse', async () => {
    activeTab = {
      moduleAbbr: 'KJV',
      verses: [{ verse_id: 43003016, text_html: 'For God so loved the world,' }],
    };
    await selectJohn316();

    expect(fetchVerse).not.toHaveBeenCalled();
    expect(studyStore.getVerseHtml()).toBe('For God so loved the world,');
  });

  it("prefers the Bible pane's copy once that chapter is open", async () => {
    activeTab = { moduleAbbr: 'KJV', verses: [] };
    await selectJohn316();
    activeTab.verses = [{ verse_id: 43003016, text_html: '<span>For God so loved</span>' }];

    expect(studyStore.getVerseHtml()).toBe('<span>For God so loved</span>');
  });

  it('does not hand back text fetched for a different translation', async () => {
    activeTab = { moduleAbbr: 'KJV', verses: [] };
    await selectJohn316();
    expect(studyStore.getVerseHtml()).not.toBeNull();

    // The reader switched translations; the KJV text no longer describes the
    // word space the ASV's interlinear rows index into.
    activeTab.moduleAbbr = 'ASV';
    expect(studyStore.getVerseHtml()).toBeNull();
  });

  it('does not hand back text fetched for a different verse', async () => {
    activeTab = { moduleAbbr: 'KJV', verses: [] };
    await selectJohn316();

    studyStore.verseId = 43003017;
    expect(studyStore.getVerseHtml()).toBeNull();
  });

  it('reports no text rather than throwing when the fetch fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchVerse.mockRejectedValue(new Error('offline'));
    await selectJohn316();

    expect(studyStore.getVerseHtml()).toBeNull();
    expect(studyStore.verseHtmlLoading).toBe(false);
    error.mockRestore();
  });
});
