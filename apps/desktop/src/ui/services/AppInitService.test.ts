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
import { DEFAULT_COMMENTARY_ABBREVIATION } from '../constants';
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
  it('uses the AI-synthesized commentary as the shipped default', () => {
    expect(DEFAULT_COMMENTARY_ABBREVIATION).toBe('SYNTHESIS');
  });

  it('prefers SYNTHESIS even when it is not listed first', () => {
    const chosen = pickDefaultCommentary([
      mod('MHC', 'Matthew Henry Concise'),
      mod('SYNTHESIS', 'Commentary Synthesis'),
      mod('WESLEY', "Wesley's Notes"),
    ]);
    expect(chosen?.abbreviation).toBe('SYNTHESIS');
  });

  it('matches the abbreviation case-insensitively', () => {
    const chosen = pickDefaultCommentary([
      mod('MHC', 'Matthew Henry Concise'),
      mod('synthesis', 'Commentary Synthesis'),
    ]);
    expect(chosen?.abbreviation).toBe('synthesis');
  });

  it('does not match on the (localizable) display name', () => {
    // Only the abbreviation is stable across locales; a module merely *named*
    // "Commentary Synthesis" must not be treated as the preferred default.
    const chosen = pickDefaultCommentary([
      mod('ISBE', 'International Standard Bible Encyclopedia'),
      mod('MHC', 'Commentary Synthesis'),
    ]);
    expect(chosen?.abbreviation).toBe('ISBE');
  });

  it('falls back to the first available commentary when SYNTHESIS is absent', () => {
    // Lean / KJV-only builds may not ship the synthesis module - the pane must
    // still open something rather than sit silently empty.
    const chosen = pickDefaultCommentary([
      mod('MHC', 'Matthew Henry Concise'),
      mod('ISBE', 'International Standard Bible Encyclopedia'),
    ]);
    expect(chosen?.abbreviation).toBe('MHC');
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
