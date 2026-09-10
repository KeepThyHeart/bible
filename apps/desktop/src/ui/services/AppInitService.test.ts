/**
 * Unit tests for AppInitService's first-run defaults.
 *
 * `pickDefaultCommentary` is the shipping-critical bit: the previous
 * implementation looked for a Wesley module that only exists in the
 * developer's data directory, so installed builds (which ship six modules,
 * see scripts/stage-build-data.js) opened no commentary at all.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { pickDefaultCommentary, restoreFileNotesFromSession } from './AppInitService';
import { DEFAULT_COMMENTARY_PREFERENCE } from '../constants';
import type { CommentaryModule } from '../stores/useCommentaryStore';
import { useFileNotesStore, getNotesPanelNavState } from '../stores/useFileNotesStore';

function mod(abbreviation: string, name = abbreviation): CommentaryModule {
  return {
    abbreviation,
    name,
    database_path: `commentary_${abbreviation.toLowerCase()}.db`,
  };
}

describe('pickDefaultCommentary', () => {
  it('prefers human-authored commentaries, Gill before MHC', () => {
    expect(DEFAULT_COMMENTARY_PREFERENCE).toEqual(['Gill', 'MHC']);
  });

  it('prefers Gill even when it is not listed first', () => {
    const chosen = pickDefaultCommentary([
      mod('MHC', "Matthew Henry's Complete Commentary"),
      mod('Gill', "John Gill's Exposition of the Entire Bible"),
      mod('WESLEY', "Wesley's Notes"),
    ]);
    expect(chosen?.abbreviation).toBe('Gill');
  });

  it('takes MHC when Gill is not installed', () => {
    const chosen = pickDefaultCommentary([
      mod('WESLEY', "Wesley's Notes"),
      mod('MHC', "Matthew Henry's Complete Commentary"),
    ]);
    expect(chosen?.abbreviation).toBe('MHC');
  });

  it('matches the abbreviation case-insensitively', () => {
    const chosen = pickDefaultCommentary([
      mod('Barnes', "Barnes' Notes"),
      mod('gill', "John Gill's Exposition of the Entire Bible"),
    ]);
    expect(chosen?.abbreviation).toBe('gill');
  });

  it('does not match on the (localizable) display name', () => {
    // Only the abbreviation is stable across locales; a module merely *named*
    // "Gill" must not be treated as the preferred default.
    const chosen = pickDefaultCommentary([
      mod('ISBE', 'International Standard Bible Encyclopedia'),
      mod('Barnes', 'Gill'),
    ]);
    expect(chosen?.abbreviation).toBe('ISBE');
  });

  it('falls back to the first available commentary when no preferred one is installed', () => {
    // A fresh development checkout may have neither - the pane must still
    // open something rather than sit silently empty.
    const chosen = pickDefaultCommentary([
      mod('Barnes', "Barnes' Notes"),
      mod('Clarke', "Adam Clarke's Commentary"),
    ]);
    expect(chosen?.abbreviation).toBe('Barnes');
  });

  it('passes over the generated digest in the fallback', () => {
    const chosen = pickDefaultCommentary([
      mod('SYNTHESIS', 'Commentary Synthesis'),
      mod('Barnes', "Barnes' Notes"),
    ]);
    expect(chosen?.abbreviation).toBe('Barnes');
  });

  it('opens the digest only when it is the sole commentary installed', () => {
    const chosen = pickDefaultCommentary([mod('SYNTHESIS', 'Commentary Synthesis')]);
    expect(chosen?.abbreviation).toBe('SYNTHESIS');
  });

  it('returns undefined when no commentaries are installed', () => {
    expect(pickDefaultCommentary([])).toBeUndefined();
  });
});

/**
 * Startup restore of the Writing pane's position (SessionData.ui.notesPanels).
 * Tested through the extracted step rather than `initializeApp`, which would
 * need most of the app mocked to reach this line.
 */
describe('restoreFileNotesFromSession', () => {
  const NAV = {
    view: 'editor' as const,
    sideTab: 'recent' as const,
    currentPath: 'Documents/Sermons',
    currentNotePath: 'Documents/Sermons/Romans 8.bn',
  };

  const layoutWith = (...notesPanelIds: string[]) => ({
    panels: {
      bible_default: { params: { contentType: 'bible' } },
      ...Object.fromEntries(notesPanelIds.map(id => [id, { params: { contentType: 'notes' } }])),
    },
  });

  beforeEach(() => {
    useFileNotesStore.setState({ notesDirectory: '', recentFiles: [], panelNavStates: {} });
  });

  it('restores each notes panel into the id the layout actually has', () => {
    restoreFileNotesFromSession(
      { notesDirectory: 'C:/Users/pete/Notes', notesPanels: { notes_default: NAV } },
      layoutWith('notes_default')
    );

    expect(useFileNotesStore.getState().notesDirectory).toBe('C:/Users/pete/Notes');
    expect(getNotesPanelNavState('notes_default')).toEqual(NAV);
  });

  it('prunes entries for notes panels the restored layout no longer contains', () => {
    restoreFileNotesFromSession(
      { notesPanels: { notes_default: NAV, notes_closed: NAV } },
      layoutWith('notes_default')
    );

    expect(getNotesPanelNavState('notes_default')).toEqual(NAV);
    expect(getNotesPanelNavState('notes_closed')).toBeUndefined();
  });

  it('keeps every entry when the restored layout has no notes panel at all', () => {
    // An absent/notes-less layout is equally consistent with a session that
    // predates layout persistence - dropping the entries would lose the
    // position of a pane the default layout is about to recreate.
    restoreFileNotesFromSession({ notesPanels: { notes_default: NAV } }, layoutWith());
    expect(getNotesPanelNavState('notes_default')).toEqual(NAV);

    restoreFileNotesFromSession({ notesPanels: { notes_default: NAV } }, undefined);
    expect(getNotesPanelNavState('notes_default')).toEqual(NAV);
  });

  it('does nothing for a session with no file-notes state', () => {
    restoreFileNotesFromSession(undefined, layoutWith('notes_default'));
    restoreFileNotesFromSession({}, layoutWith('notes_default'));

    expect(useFileNotesStore.getState().notesDirectory).toBe('');
    expect(useFileNotesStore.getState().panelNavStates).toEqual({});
  });
});
