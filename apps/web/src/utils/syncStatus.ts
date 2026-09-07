import { bibleStore } from '../stores/bibleStore';
import { formatPassageRef } from '../constants';
import { getLocalizedBookName } from './bookNames';

export type SyncStatus = 'synced' | 'pinned-mismatch' | 'preview-available';

export interface SyncStatusInfo {
  status: SyncStatus;
  /** Label for the pinned/current verse (e.g. "Genesis 1:1") */
  currentLabel: string;
  /** Label for the verse to sync to (e.g. "Proverbs 6:1") */
  syncLabel: string;
  /** The verse ID to sync to when the user clicks the banner */
  syncVerseId: number | null;
}

/**
 * Compute the sync status for a study pane (commentary or study).
 *
 * @param pinned Whether the pane is currently pinned
 * @param pinnedBook/Chapter/Verse The pinned passage (if pinned)
 * @param currentVerseId The verse the pane is currently showing data for
 */
export function getSyncStatus(opts: {
  pinned: boolean;
  pinnedBook: number | null;
  pinnedChapter: number | null;
  pinnedVerse: number | null;
  currentVerseId: number | null;
}): SyncStatusInfo {
  const tab = bibleStore.getActiveTab();
  const { pinned, pinnedBook, pinnedChapter, pinnedVerse, currentVerseId } = opts;

  // Build current pane label
  let currentLabel = '';
  if (pinned && pinnedBook && pinnedChapter) {
    currentLabel = formatPassageRef(pinnedBook, pinnedChapter, pinnedVerse ?? undefined);
  } else if (currentVerseId) {
    const b = Math.floor(currentVerseId / 1000000);
    const c = Math.floor((currentVerseId % 1000000) / 1000);
    const v = currentVerseId % 1000;
    currentLabel = formatPassageRef(b, c, v || undefined);
  }

  if (!tab) {
    return { status: 'synced', currentLabel, syncLabel: '', syncVerseId: null };
  }

  const studyVerse = tab.studyVerse;
  const previewVerse = tab.previewVerse;

  // 1. Pinned mismatch: pane is pinned, but Bible pane has moved to a different study verse
  if (pinned && studyVerse) {
    const pinnedVerseId = pinnedBook && pinnedChapter
      ? (pinnedBook * 1000000) + (pinnedChapter * 1000) + (pinnedVerse ?? 0)
      : null;
    if (pinnedVerseId !== studyVerse) {
      const sb = Math.floor(studyVerse / 1000000);
      const sc = Math.floor((studyVerse % 1000000) / 1000);
      const sv = studyVerse % 1000;
      return {
        status: 'pinned-mismatch',
        currentLabel,
        syncLabel: formatPassageRef(sb, sc, sv || undefined),
        syncVerseId: studyVerse,
      };
    }
  }

  // 2. Preview available: user navigated via link/search, study pane could sync
  if (previewVerse && previewVerse !== currentVerseId) {
    const pb = Math.floor(previewVerse / 1000000);
    const pc = Math.floor((previewVerse % 1000000) / 1000);
    const pv = previewVerse % 1000;
    return {
      status: 'preview-available',
      currentLabel,
      syncLabel: formatPassageRef(pb, pc, pv || undefined),
      syncVerseId: previewVerse,
    };
  }

  return { status: 'synced', currentLabel, syncLabel: '', syncVerseId: null };
}
