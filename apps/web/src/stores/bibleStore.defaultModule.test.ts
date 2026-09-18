/**
 * Tabs have to open in a translation the server actually has.
 *
 * A fresh session used to open in a hard-coded KJV, and a restored session
 * kept whatever translation it was saved with. On an install without that
 * translation both fetched a chapter that 404s, and the reader's first screen
 * was "Failed to load chapter". The session is restored before the module list
 * has loaded, so the check happens in a second step once it has
 * (`fallBackFromMissingModules`), and must do nothing when the list never
 * arrives -- offline, the translation may well be downloaded.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bibleStore } from './bibleStore';
import { settingsStore } from './settingsStore';
import { moduleStore } from './moduleStore';
import type { ModuleInfo, VerseData } from '../types';

const SESSION_KEY = 'bible-reader-session';

function makeVerse(module: string, book: number, chapter: number, verse = 1): VerseData {
  return {
    verse_id: book * 1000000 + chapter * 1000 + verse,
    book_number: book,
    chapter,
    verse,
    text: `${module} text ${verse}`,
    text_html: `${module} text ${verse}`,
    is_paragraph_start: false,
    words_of_christ: false,
  };
}

function makeProvider() {
  return {
    getChapter: vi.fn(async (module: string, book: number, chapter: number) => ({
      verses: [makeVerse(module, book, chapter)],
      hasInterlinearData: false,
      coveredBooks: undefined,
    })),
    getVerseOfTheDay: vi.fn(async () => null),
  };
}

function bible(abbreviation: string): ModuleInfo {
  return { module_id: 0, abbreviation, name: abbreviation, type: 'bible', language_code: 'en' };
}

/** Stand in for moduleStore.loadManifest() having answered with these Bibles. */
function install(...abbreviations: string[]): void {
  moduleStore.availableModules = abbreviations.map(bible);
  moduleStore.loaded = true;
}

/** A session saved while reading John 3 in `module`, cached text included. */
function saveStaleSession(module: string): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    tabs: [{
      moduleAbbr: module,
      book: 43,
      chapter: 3,
      displayMode: 'standard',
      history: [{ moduleAbbr: module, book: 43, chapter: 3 }],
      historyIndex: 0,
      verses: [makeVerse(module, 43, 3)],
      versesModule: module,
      hasInterlinearData: false,
    }],
    activeTabIndex: 0,
  }));
}

let provider: ReturnType<typeof makeProvider>;

beforeEach(() => {
  localStorage.clear();
  bibleStore.tabs = [];
  bibleStore.activeTabId = '';
  settingsStore.serverDefaultModule = null;
  settingsStore.serverDefaultDisplayMode = null;
  moduleStore.availableModules = [];
  moduleStore.loaded = false;
  provider = makeProvider();
});

describe('a fresh session', () => {
  it('opens on the translation it is given', () => {
    bibleStore.init(provider as never, 'WEB');
    expect(bibleStore.getActiveTab()?.moduleAbbr).toBe('WEB');
  });

  it('opens on the configured default when none is given', () => {
    settingsStore.serverDefaultModule = 'ASV';
    bibleStore.init(provider as never);
    expect(bibleStore.getActiveTab()?.moduleAbbr).toBe('ASV');
  });

  it('moves off a configured default that turns out not to be installed', () => {
    settingsStore.serverDefaultModule = 'KJV';
    bibleStore.init(provider as never);
    install('ASV');
    bibleStore.fallBackFromMissingModules();
    expect(bibleStore.getActiveTab()?.moduleAbbr).toBe('ASV');
  });

  it('starts in the configured display mode', () => {
    settingsStore.serverDefaultDisplayMode = 'reading';
    bibleStore.init(provider as never, 'ASV');
    expect(bibleStore.getActiveTab()?.displayMode).toBe('reading');
  });

  it('ignores a configured display mode that does not exist', () => {
    settingsStore.serverDefaultDisplayMode = 'sideways';
    bibleStore.init(provider as never, 'ASV');
    expect(bibleStore.getActiveTab()?.displayMode).toBe('standard');
  });
});

describe('a restored session naming a translation that is not installed', () => {
  it('reopens the same passage in the installed translation', async () => {
    saveStaleSession('KJV');
    bibleStore.init(provider as never);
    install('ASV');

    bibleStore.fallBackFromMissingModules();

    const tab = bibleStore.getActiveTab()!;
    expect(tab.moduleAbbr).toBe('ASV');
    expect([tab.book, tab.chapter]).toEqual([43, 3]);
    // The cached KJV text must not be shown under the ASV name.
    expect(tab.verses).toEqual([]);

    await bibleStore.loadRestoredTabs();

    expect(provider.getChapter).toHaveBeenCalledWith('ASV', 43, 3);
    expect(provider.getChapter).not.toHaveBeenCalledWith('KJV', expect.anything(), expect.anything());
    expect(tab.verses[0].text).toBe('ASV text 1');
    expect(tab.versesModule).toBe('ASV');
    expect(tab.loadError).toBeUndefined();
  });

  it('points history at the installed translation, so Back does not fail either', () => {
    saveStaleSession('KJV');
    bibleStore.init(provider as never);
    install('ASV');

    bibleStore.fallBackFromMissingModules();

    expect(bibleStore.getActiveTab()!.history.map(h => h.moduleAbbr)).toEqual(['ASV']);
  });

  it('saves the corrected session, so the next start does not repeat the detour', () => {
    saveStaleSession('KJV');
    bibleStore.init(provider as never);
    install('ASV');

    bibleStore.fallBackFromMissingModules();

    const saved = JSON.parse(localStorage.getItem(SESSION_KEY)!);
    expect(saved.tabs[0].moduleAbbr).toBe('ASV');
  });
});

describe('a restored session that needs no correction', () => {
  it('keeps an installed translation and its cached text', () => {
    saveStaleSession('KJV');
    bibleStore.init(provider as never);
    install('ASV', 'KJV');

    bibleStore.fallBackFromMissingModules();

    const tab = bibleStore.getActiveTab()!;
    expect(tab.moduleAbbr).toBe('KJV');
    expect(tab.verses).toHaveLength(1);
  });

  it('is left alone when the module list never loaded (offline)', () => {
    saveStaleSession('KJV');
    bibleStore.init(provider as never);

    bibleStore.fallBackFromMissingModules();

    const tab = bibleStore.getActiveTab()!;
    expect(tab.moduleAbbr).toBe('KJV');
    expect(tab.verses).toHaveLength(1);
  });
});

describe('with no tab to take a translation from', () => {
  it('a new tab opens on the default Bible', () => {
    install('ASV');
    bibleStore.addTab();
    expect(bibleStore.getActiveTab()?.moduleAbbr).toBe('ASV');
  });

  it('getActiveModule answers with the default Bible', () => {
    install('ASV');
    expect(bibleStore.getActiveModule()).toBe('ASV');
  });
});

describe('a deep link naming a translation that is not installed', () => {
  it('opens the linked passage in the default Bible instead', async () => {
    install('ASV');
    bibleStore.init(provider as never);

    await bibleStore.navigateFromHash('#/KJV/43/3');

    expect(provider.getChapter).toHaveBeenCalledWith('ASV', 43, 3);
    expect(bibleStore.getActiveTab()?.loadError).toBeUndefined();
  });
});
