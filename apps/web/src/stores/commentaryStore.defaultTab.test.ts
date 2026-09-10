/**
 * The commentary tab a fresh profile opens.
 *
 * It is chosen once the module manifest has loaded, from what the server
 * actually offers: the generated digest may not be installed at all, so nothing
 * here may assume it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { HOME_TAB_ID, commentaryStore, pickDefaultCommentary } from './commentaryStore';
import type { ModuleInfo } from '../types';

function mod(abbreviation: string, name = abbreviation): ModuleInfo {
  return { module_id: 0, abbreviation, name, type: 'commentary', language_code: 'en' };
}

/**
 * `commentaryStore` is a singleton and `init()` does not clear tabs it already
 * holds, so each test starts from a profile with nothing but the Overview tab.
 */
function freshProfile(): void {
  localStorage.clear();
  commentaryStore.tabs = [];
  commentaryStore.activeTabId = '';
  commentaryStore.init({
    getCommentary: async () => ({ entries: [] }) as never,
    getAllCommentary: async () => ({ modules: [] }) as never,
    getAvailability: async () => ({ modules: [] }) as never,
    getHomeData: async () => ({ modules: [], chapterModules: [] }) as never,
    getModuleInfo: async () => null,
    getChapterOverview: async () => ({}) as never,
  });
}

describe('pickDefaultCommentary', () => {
  it('prefers Gill, then MHC, whatever order the server lists them in', () => {
    expect(pickDefaultCommentary([mod('MHC'), mod('Barnes'), mod('Gill')])?.abbreviation).toBe('Gill');
    expect(pickDefaultCommentary([mod('Barnes'), mod('MHC')])?.abbreviation).toBe('MHC');
  });

  it('matches the abbreviation case-insensitively, never the display name', () => {
    expect(pickDefaultCommentary([mod('Barnes'), mod('gill')])?.abbreviation).toBe('gill');
    expect(pickDefaultCommentary([mod('Clarke'), mod('Barnes', 'Gill')])?.abbreviation).toBe('Clarke');
  });

  it('falls back past the generated digest to the first human-authored commentary', () => {
    expect(pickDefaultCommentary([mod('SYNTHESIS'), mod('Barnes')])?.abbreviation).toBe('Barnes');
  });

  it('opens the digest only when it is the sole commentary', () => {
    expect(pickDefaultCommentary([mod('SYNTHESIS')])?.abbreviation).toBe('SYNTHESIS');
  });

  it('returns undefined when the server offers no commentaries', () => {
    expect(pickDefaultCommentary([])).toBeUndefined();
  });
});

describe('commentaryStore.openDefaultTab', () => {
  beforeEach(freshProfile);

  it('opens no module tab of its own during init', () => {
    expect(commentaryStore.tabs.map(t => t.id)).toEqual([HOME_TAB_ID]);
  });

  it('opens and activates the preferred commentary', () => {
    commentaryStore.openDefaultTab([mod('Barnes'), mod('Gill', "John Gill's Exposition")]);

    const opened = commentaryStore.tabs.filter(t => t.id !== HOME_TAB_ID);
    expect(opened.map(t => t.moduleAbbr)).toEqual(['Gill']);
    expect(commentaryStore.activeTabId).toBe(opened[0].id);
  });

  it('opens nothing when the server offers no commentaries', () => {
    commentaryStore.openDefaultTab([]);
    expect(commentaryStore.tabs.map(t => t.id)).toEqual([HOME_TAB_ID]);
  });

  it('leaves a session that already has commentary tabs alone', () => {
    commentaryStore.addTab('Clarke', "Adam Clarke's Commentary");
    commentaryStore.openDefaultTab([mod('Gill')]);

    expect(commentaryStore.tabs.filter(t => t.id !== HOME_TAB_ID).map(t => t.moduleAbbr)).toEqual(['Clarke']);
  });
});
