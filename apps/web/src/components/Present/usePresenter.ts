import { useStore } from '../../hooks/useStore';
import { bibleStore } from '../../stores/bibleStore';
import { moduleStore } from '../../stores/moduleStore';
import { presentStore, type PresentConnectionStatus } from '../../stores/presentStore';
import { formatPassageRef } from '../../constants';
import { parseVerseId } from '../../utils/verseId';
import type { PresentItem, PresentPassageItem, PresentState } from '../../present/protocol';

/**
 * The two things a presenter is holding in their head at once: what the room
 * can see, and what they are looking at.
 *
 * Keeping them separate is the whole point of session mode. The reading app is
 * already the preview -- a preacher can chase a cross-reference, look ahead to
 * the next passage, or check a word mid-sentence, and the wall does not move
 * until they say so. Everything here exists to make the difference between the
 * two visible at a glance, because a presenter who cannot tell what is on the
 * screen behind them will not trust the tool.
 */

/** A passage the presenter could send, drawn from the tab they are reading. */
export interface StagedPassage {
  item: PresentPassageItem;
  /** Verse number to anchor on: what the study pane is focused on. */
  index: number;
  /** For a button label -- "John 3:16", localized. */
  label: string;
}

export interface PresenterView {
  presenting: boolean;
  wall: PresentState | null;
  connection: PresentConnectionStatus;
  busy: boolean;
  error: string | null;
  panelOpen: boolean;
  /** What the presenter is reading, or null on the home screen. */
  staged: StagedPassage | null;
  /** Reference of what is on the wall, or null when the wall is empty. */
  liveLabel: string | null;
  /** True when the wall already shows what is staged, verse and all. */
  stagedIsLive: boolean;
  viewers: number;
}

/** A localized reference for whatever kind of thing is on the wall. */
export function describeItem(item: PresentItem | null, index: number): string | null {
  if (!item) return null;
  if (item.kind === 'passage') {
    return formatPassageRef(item.book, item.chapter, index || null,
      moduleStore.getBookName(item.book));
  }
  if (item.kind === 'text') return item.title ?? 'Text';
  return item.hymnId;
}

export function usePresenter(): PresenterView {
  const session = useStore(presentStore, () => presentStore.session);
  const wall = useStore(presentStore, () => presentStore.wall);
  const connection = useStore(presentStore, () => presentStore.connection);
  const busy = useStore(presentStore, () => presentStore.busy);
  const error = useStore(presentStore, () => presentStore.error);
  const panelOpen = useStore(presentStore, () => presentStore.panelOpen);
  const tab = useStore(bibleStore, () => bibleStore.getActiveTab());
  const showHome = useStore(bibleStore, () => bibleStore.showHome);

  let staged: StagedPassage | null = null;
  if (tab?.book && tab.chapter && !showHome) {
    // The verse the study tools are on is the one the presenter is thinking
    // about, so it is the one that gets sent. `previewVerse` deliberately does
    // not count: hovering a cross-reference must not change what would be sent.
    const verse = tab.studyVerse ? parseVerseId(tab.studyVerse).verse : 1;
    staged = {
      item: { kind: 'passage', module: tab.moduleAbbr, book: tab.book, chapter: tab.chapter },
      index: verse,
      label: formatPassageRef(tab.book, tab.chapter, verse, moduleStore.getBookName(tab.book)),
    };
  }

  const live = wall?.live ?? null;
  const stagedIsLive = Boolean(
    staged && live?.kind === 'passage'
    && live.module === staged.item.module
    && live.book === staged.item.book
    && live.chapter === staged.item.chapter
    && wall?.position.index === staged.index,
  );

  return {
    presenting: session !== null,
    wall,
    connection,
    busy,
    error,
    panelOpen,
    staged,
    liveLabel: describeItem(live, wall?.position.index ?? 0),
    stagedIsLive,
    viewers: wall?.session.viewerCount ?? 0,
  };
}
