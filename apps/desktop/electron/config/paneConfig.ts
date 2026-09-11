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
export type PaneType = 'bible' | 'commentary' | 'book' | 'verse-notes' | 'prayer' | 'study' | 'topics' | 'extension';

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
  },

  /**
   * Extension Panel Configuration
   *
   * One config covers every extension panel type rather than one per
   * extension: the panel is an iframe on the extension's own origin, so the
   * host has nothing type-specific to configure. What distinguishes one from
   * another travels in the payload (`extensionId`, `panelTypeId`), which is
   * also what `titleFormat` reads.
   *
   * The default size is deliberately generous. An extension panel is an
   * app-within-an-app that owns its whole rectangle - unlike Commentary or
   * Notes, nothing else is going to fill the space for it.
   *
   * It is now only a FALLBACK: a panel type may declare its own preferred
   * pop-out size, which `resolveDetachedWindowSize()` below clamps against the
   * `minWidth`/`minHeight` here and a 4K ceiling. This entry is what a panel
   * that declares nothing still gets.
   */
  extension: {
    defaultWidth: 900,
    defaultHeight: 700,
    titleFormat: (state) =>
      // The extension supplies its own already-localized title at
      // registration time. Fall back to a generic label rather than showing a
      // raw extension id if a saved layout outlives the extension.
      state?.panelTitle || t('main.window.extensionFallback'),
    component: 'ExtensionPanelHost',
    minWidth: 320,
    minHeight: 240
  }
};

/**
 * Get configuration for a pane type
 */
export function getPaneConfig(paneType: PaneType): PaneTypeConfig {
  return PANE_CONFIGS[paneType];
}

/**
 * Hard ceiling on a detached window, in CSS pixels.
 *
 * Chosen as 4K rather than "the current display" on purpose: the display list
 * is not stable (a laptop is docked and undocked, an external monitor sleeps),
 * and a window sized to a screen that has gone away is worse than one sized to
 * a plausible screen. Electron will happily create a 30000px window that opens
 * almost entirely off-screen with its close button somewhere the user cannot
 * reach - the OS clamps a *maximised* window, not a requested size.
 */
export const DETACHED_WINDOW_MAX_WIDTH = 3840;
export const DETACHED_WINDOW_MAX_HEIGHT = 2160;

/**
 * Floor used when a pane config declares no `minWidth` / `minHeight`.
 *
 * Every config that can carry a requested size declares its own (the
 * `extension` entry above uses 320x240); this only exists so the clamp is
 * total rather than conditional.
 */
const DETACHED_WINDOW_FLOOR_WIDTH = 320;
const DETACHED_WINDOW_FLOOR_HEIGHT = 240;

/** A size a panel type asked for. Every field is untrusted - see below. */
export interface RequestedWindowSize {
  width?: unknown;
  height?: unknown;
}

function clampDimension(
  requested: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof requested !== 'number' || !Number.isFinite(requested)) return fallback;
  return Math.round(Math.min(Math.max(requested, min), max));
}

/**
 * Resolve the size a detached window should open at.
 *
 * `defaultWidth` / `defaultHeight` on the pane config are the host's answer for
 * every window of that type, which is right for the built-ins - a Commentary
 * window is a Commentary window - and wrong for extension panels. One config
 * covers every contributed panel (see the `extension` entry above), so a
 * narrow verse-timeline strip and a full study workbench both open at 900x700,
 * and at most one of those is the size its author wanted.
 *
 * `requested` is therefore the panel type's own preference, and it is
 * untrusted twice over: it originates in a third-party extension's
 * `ui.registerPanelType` call or manifest, and it reaches the main process
 * over IPC from the renderer. So each dimension is taken only if it is a
 * finite number, and is then clamped between the pane's own minimum and
 * DETACHED_WINDOW_MAX_*. An extension can neither open a 1px window the user
 * has no handle to grab nor a 30000px one whose controls land off-screen, and
 * a garbage value falls back to the host default rather than failing the
 * pop-out.
 *
 * Width and height are resolved independently: a panel that declares only a
 * sensible width keeps the default height rather than losing both.
 */
export function resolveDetachedWindowSize(
  config: PaneTypeConfig,
  requested: RequestedWindowSize | null | undefined,
): { width: number; height: number } {
  if (typeof requested !== 'object' || requested === null) {
    return { width: config.defaultWidth, height: config.defaultHeight };
  }
  return {
    width: clampDimension(
      requested.width,
      config.defaultWidth,
      config.minWidth ?? DETACHED_WINDOW_FLOOR_WIDTH,
      DETACHED_WINDOW_MAX_WIDTH,
    ),
    height: clampDimension(
      requested.height,
      config.defaultHeight,
      config.minHeight ?? DETACHED_WINDOW_FLOOR_HEIGHT,
      DETACHED_WINDOW_MAX_HEIGHT,
    ),
  };
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
