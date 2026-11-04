// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dictionaryStore } from './dictionaryStore';

// B-165: typing "G26" in the Hebrew tab (or "H430" in the Greek tab) opens the
// other lexicon instead of searching the wrong one for a number it can't have.
describe('dictionary tab search routes a Strong\'s number to its own lexicon', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    dictionaryStore.modules = [];
    dictionaryStore.modulesLoaded = true;
    dictionaryStore.tabs = [{ id: 'dtab-home', moduleAbbr: '__home__', moduleName: 'Home' }];
    dictionaryStore.tabStates.clear();
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ entry_key: '00026', word: 'x' }) })) as any;
  });
  afterEach(() => vi.useRealTimers());

  it('G26 typed in the Hebrew tab offers "Open G26 in Strong\'s Greek" and opens it only when picked', async () => {
    dictionaryStore.addTab('StrongsHebrew', 'Strong\'s Hebrew');
    const hebrewId = dictionaryStore.activeTabId;
    dictionaryStore.setTabSearchQuery(hebrewId, 'G26');
    await vi.advanceTimersByTimeAsync(400);
    // Nothing navigates on the pause alone
    expect(dictionaryStore.activeTabId).toBe(hebrewId);
    const top = dictionaryStore.getTabState(hebrewId).suggestions[0];
    expect(top.word).toBe("Open G26 in Strong's Greek");
    await dictionaryStore.pickTabSuggestion(hebrewId, top);
    const active = dictionaryStore.tabs.find(t => t.id === dictionaryStore.activeTabId)!;
    expect(active.moduleAbbr.toLowerCase()).toBe('strongsgreek');
    const urls = (globalThis.fetch as any).mock.calls.map((c: any[]) => String(c[0]));
    expect(urls.some((u: string) => /StrongsHebrew\/search/i.test(u))).toBe(false);
    expect(urls.some((u: string) => /entry\/00026/.test(u))).toBe(true);
  });

  it('slow typing of G2..6 does not hijack the tab at G2', async () => {
    dictionaryStore.addTab('StrongsHebrew', 'Strong\'s Hebrew');
    const hebrewId = dictionaryStore.activeTabId;
    dictionaryStore.setTabSearchQuery(hebrewId, 'G2');
    await vi.advanceTimersByTimeAsync(500);
    expect(dictionaryStore.activeTabId).toBe(hebrewId);
    expect(dictionaryStore.getTabState(hebrewId).searchQuery).toBe('G2');
    dictionaryStore.setTabSearchQuery(hebrewId, 'G26');
    await vi.advanceTimersByTimeAsync(500);
    expect(dictionaryStore.activeTabId).toBe(hebrewId);
    expect(dictionaryStore.getTabState(hebrewId).suggestions[0].word).toBe("Open G26 in Strong's Greek");
  });

  it('H430 typed in the Greek tab offers the Hebrew lexicon', async () => {
    dictionaryStore.addTab('StrongsGreek', 'Strong\'s Greek');
    const greekId = dictionaryStore.activeTabId;
    dictionaryStore.setTabSearchQuery(greekId, 'h430');
    await vi.advanceTimersByTimeAsync(400);
    const top = dictionaryStore.getTabState(greekId).suggestions[0];
    expect(top.word).toBe("Open H430 in Strong's Hebrew");
    await dictionaryStore.pickTabSuggestion(greekId, top);
    const active = dictionaryStore.tabs.find(t => t.id === dictionaryStore.activeTabId)!;
    expect(active.moduleAbbr.toLowerCase()).toBe('strongshebrew');
  });

  it('the matching prefix still searches in place', async () => {
    dictionaryStore.addTab('StrongsGreek', 'Strong\'s Greek');
    const id = dictionaryStore.activeTabId;
    dictionaryStore.setTabSearchQuery(id, 'G26');
    await vi.advanceTimersByTimeAsync(400);
    expect(dictionaryStore.tabs.find(t => t.id === dictionaryStore.activeTabId)!.id).toBe(id);
  });
});
