/**
 * Pane Type Configuration
 *
 * Defines configuration for each detachable pane type.
 * This is used by the WindowManager to create appropriately sized and titled windows.
 */

import { t } from '../services/MainI18n';

/**
 * The pane types that can be detached into their own OS window.
 *
 * Deliberately not the same list as `PanelContentType`: a *dictionary* has no
 * entry here. Dictionaries and books share one component, so
 * both `POP_OUT_PANE_TYPE` (DockviewTabRenderer) and `popOutModuleToWindow` detach a
 * dictionary as `'book'` and let `paneKind` in the payload make it one. A
 * `'dictionary'` config was therefore unreachable - and, because it named a
 * `DictionaryPane` component that renders without the surrounding tab strip,
 * would have opened a different window than the docked pane it replaced.
 *
 * `'document'` and `'journal'` are gone for the same reason plus one more: no
 * panel of either kind can be created in the first place (`POP_OUT_PANE_TYPE` in
 * DockviewTabRenderer never emits them), and the standalone Documents and
 * Journal tabs they named were scaffolding for features cut from v1.
 */
export type PaneType = 'bible' | 'commentary' | 'book' | 'verse-notes' | 'prayer' | 'study' | 'topics';

export interface PaneTypeConfig {
  defaultWidth: number;
  defaultHeight: number;
  titleFormat: (state: any) => string;
  component: string; // React component name to render
  minWidth?: number;
  minHeight?: number;
  syncState?: Record<string, boolean>; // What state fields to sync
}

/**
 * Configuration for all pane types
 *
 * Each pane type has:
 * - Default window dimensions
 * - Title format function
 * - Component name (matches React component)
 * - Optional sync configuration (link toggle)
 */
export const PANE_CONFIGS: Record<PaneType, PaneTypeConfig> = {
  /**
   * Bible Pane Configuration
   */
  bible: {
    defaultWidth: 900,
    defaultHeight: 700,
    titleFormat: (state) => {
      const translation = state?.activeTab?.abbreviation || t('main.window.bibleFallback');
      const bookName = state?.currentBookName || '';
      const chapter = state?.currentChapter || '';
      return bookName && chapter
        ? t('main.window.bibleWithPassage', { translation, book: bookName, chapter })
        : t('main.window.bible', { translation });
    },
    component: 'BiblePane',
    minWidth: 600,
    minHeight: 400,
    syncState: {
      verseId: true, // Syncs verse navigation
      currentBook: true,
      currentChapter: true,
      selectedVerseId: true
      // translation, displayMode, etc. don't sync - each window can have different settings
    }
  },

  /**
   * Commentary Pane Configuration
   */
  commentary: {
    defaultWidth: 800,
    defaultHeight: 600,
    /**
     * Named from the handed-over tab list, with `commentaryName` kept only as
     * an override. No pop-out path has ever set `commentaryName`, so reading it
     * alone titled every commentary window "Commentary - Commentary".
     */
    titleFormat: (state) => {
      const tabs = state?.openTabs ?? [];
      const name = state?.commentaryName || tabs[state?.activeTabIndex ?? 0]?.name;
      return t('main.window.commentary', {
        name: name || t('main.window.commentaryFallback'),
      });
    },
    component: 'CommentaryPane',
    minWidth: 500,
    minHeight: 400,
    syncState: {
      verseId: true, // Follow Bible navigation when linked
      // commentaryName doesn't sync - can view different commentary
    }
  },

  /**
   * Book Pane Configuration
   */
  book: {
    defaultWidth: 800,
    defaultHeight: 700,
    /**
     * One window type, two panes.
     *
     * A dictionary detaches as a Books window (see the `PaneType` note above),
     * so this is the only place that can tell the two apart - from `paneKind`,
     * the same flag `BookPane` itself reads. Without the split, popping out
     * Easton's opened a window titled "Books".
     *
     * The name comes off the handed-over tab list rather than
     * `state.selectedBook`, a field no pop-out path has ever put in the
     * payload: every Books window was therefore titled "Book - Book".
     */
    titleFormat: (state) => {
      const isDictionary = state?.paneKind === 'dictionary';
      const tabs = (isDictionary ? state?.dictOpenTabs : state?.openTabs) ?? [];
      const index = (isDictionary ? state?.dictActiveTabIndex : state?.activeTabIndex) ?? 0;
      const name = tabs[index]?.name;
      return isDictionary
        ? t('main.window.dictionary', { name: name || t('main.window.dictionaryFallback') })
        : t('main.window.book', { name: name || t('main.window.bookFallback') });
    },
    component: 'BookPane',
    minWidth: 600,
    minHeight: 500,
    syncState: {
      sectionId: false // Each window can view different sections
    }
  },

  /**
   * Verse Notes Pane Configuration
   */
  'verse-notes': {
    defaultWidth: 800,
    defaultHeight: 600,
    /**
     * Named from the note the window opened on. `noteName` is not sent by
     * either pop-out path, so the file's own basename (minus its extension) is
     * what stops every notes window from being called "My Verse Notes".
     */
    titleFormat: (state) => {
      const path: unknown = state?.initialCurrentNotePath;
      const fileName = typeof path === 'string'
        ? path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '')
        : undefined;
      return t('main.window.verseNotes', {
        name: state?.noteName || fileName || t('main.window.verseNotesFallback'),
      });
    },
    component: 'UserNotesPane',
    minWidth: 600,
    minHeight: 400,
    syncState: {
      noteId: false,
      verseId: true, // Can follow Bible navigation
      content: false
    }
  },

  /**
   * Prayer Pane Configuration
   */
  prayer: {
    defaultWidth: 800,
    defaultHeight: 700,
    titleFormat: (state) =>
      t('main.window.prayer', { name: state?.prayerListName || t('main.window.prayerFallback') }),
    component: 'PrayerTab',
    minWidth: 600,
    minHeight: 400,
    syncState: {
      prayerListId: false,
      content: false
    }
  },

  /**
   * Study Pane Configuration
   */
  study: {
    defaultWidth: 800,
    defaultHeight: 700,
    titleFormat: (state) =>
      t('main.window.study', { name: state?.verseName || t('main.window.studyFallback') }),
    component: 'StudyPane',
    minWidth: 500,
    minHeight: 400,
    syncState: {
      verseId: true
    }
  },

  /**
   * Topics Pane Configuration
   */
  topics: {
    defaultWidth: 800,
    defaultHeight: 700,
    titleFormat: (state) =>
      t('main.window.topics', { name: state?.topicName || t('main.window.topicsFallback') }),
    component: 'TopicsPane',
    minWidth: 500,
    minHeight: 400,
    syncState: {
      verseId: true
    }
  }
};

/**
 * Get configuration for a pane type
 */
export function getPaneConfig(paneType: PaneType): PaneTypeConfig {
  return PANE_CONFIGS[paneType];
}

/**
 * Check if a pane type is valid
 *
 * Uses an own-property check rather than `in`: `paneType` arrives from the
 * renderer over IPC, and `in` walks the prototype chain, so `'toString'` and
 * `'constructor'` would otherwise be reported as valid pane types.
 */
export function isValidPaneType(paneType: string): paneType is PaneType {
  return Object.prototype.hasOwnProperty.call(PANE_CONFIGS, paneType);
}
