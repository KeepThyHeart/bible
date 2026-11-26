import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../services/electronAPI', () => ({
  bibleAPI: {
    getAvailableBibles: vi.fn().mockResolvedValue([]),
    getInitialData: vi.fn().mockResolvedValue(null),
    getBookName: vi.fn().mockResolvedValue('John'),
    getChapter: vi.fn().mockResolvedValue({ verses: [{ verse_id: 43003001, verse: 1, text: 'x' }] }),
    getVerse: vi.fn().mockResolvedValue(null),
  },
  commentaryAPI: { getAvailableCommentaries: vi.fn().mockResolvedValue([]), getEntriesForVerse: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../stores/helpers/sessionNotifier', () => ({ markSessionDirty: vi.fn() }));

import { useBibleStore } from '../../stores/useBibleStore';
import { collectSessionData, declareSessionKeys, resetSessionSectionsForTests, stashRestoredSessionUi, declaredSessionSections } from '../../stores/helpers/sessionRegistry';
import { audioStore } from './audioState';
import { installAudioBookmarksSession, parseAudioSession, serializeAudioSession } from './audioBookmarksSession';

const P = 'audio_session_pane';
const KJV = { abbreviation: 'KJV', name: 'King James Version', database_path: 'k.db', module_id: 1 };
const saved = (extra = {}) => ({ audio: { v: 1, tabs: { [P]: { moduleAbbr: 'KJV', book: 43, chapter: 3, verse: 16, ...extra } } } });

describe('audio bookmarks session', () => {
  beforeEach(() => {
    resetSessionSectionsForTests();
    declareSessionKeys(['audio']);
    useBibleStore.setState({ panels: new Map(), availableBibles: [KJV], initialLoadComplete: false });
    audioStore.restoreBookmarks({});
  });

  it('parse rejects other shapes', () => {
    expect(parseAudioSession(null)).toBeNull();
    expect(parseAudioSession({ v: 2, tabs: {} })).toBeNull();
    expect(parseAudioSession({ v: 1, tabs: [] })).toBeNull();
    expect(parseAudioSession({ v: 1, tabs: { a: 1 } })).toEqual({ a: 1 });
  });

  it('restores sanitized bookmarks, round-trips through the serializer', () => {
    const d = install(() => stashRestoredSessionUi({ audio: { v: 1, tabs: { [P]: { moduleAbbr: 'KJV', book: 43, chapter: 3, verse: 16 }, bad: { book: 99, chapter: 1 } } } }));
    expect(serializeAudioSession().tabs[P]).toMatchObject({ book: 43, chapter: 3, verse: 16 });
    expect(serializeAudioSession().tabs.bad).toBeUndefined();
    expect((declaredSessionSections().audio as { tabs: object }).tabs).toHaveProperty(P);
    d.dispose();
  });

  it('selects the verse when the pane reports ready and selection still equals the persisted one', async () => {
    const d = install(() => stashRestoredSessionUi(saved({ selAtSave: 43003001 })));
    useBibleStore.getState().initPanel(P);
    useBibleStore.getState().openBible(P, 'KJV', KJV.name);
    await useBibleStore.getState().loadChapter(P, 43, 3);
    await vi.waitFor(() => expect(useBibleStore.getState().getPanelState(P).selectedVerseId).toBe(43003016));
    d.dispose();
  });

  it('leaves a selection the reader changed since', async () => {
    const d = install(() => stashRestoredSessionUi(saved({ selAtSave: 43003001 })));
    useBibleStore.getState().initPanel(P);
    useBibleStore.getState().openBible(P, 'KJV', KJV.name);
    await useBibleStore.getState().loadChapter(P, 43, 3);
    useBibleStore.getState().setSelectedVerse(P, 43003005);
    await Promise.resolve();
    expect(useBibleStore.getState().getPanelState(P).selectedVerseId).toBe(43003005);
    d.dispose();
  });

  it('keeps writing the last resume points after dispose', () => {
    const d = install(() => stashRestoredSessionUi(saved()));
    d.dispose();
    expect(collectSessionData()).toHaveProperty('audio');
  });
});

function install(restore: () => void) {
  const d = installAudioBookmarksSession();
  restore();
  return d;
}
