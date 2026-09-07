import { Metadata } from '../../Core/Types';

/**
 * Session data interface
 * This represents the serialized state of all UI stores that needs to be persisted
 */
export interface SessionData {
  // Bible pane state
  bible?: {
    openTabs?: Array<{ tabId: string; abbreviation: string; name: string; displayMode?: string; moduleId?: number }>;
    activeTabIndex?: number;
    currentBook?: number;
    currentChapter?: number;
    selectedVerseId?: number | null;
  };

  // Commentary pane state
  commentary?: {
    openTabs?: Array<{ abbreviation: string; name: string }>;
    activeTabIndex?: number;
    currentVerseId?: number | null;
    browseModeByTab?: Record<string, boolean>;
  };

  // Dictionary pane state
  dictionary?: {
    openTabs?: Array<{ abbreviation: string; name: string }>;
    activeTabIndex?: number;
    currentEntryByTab?: Record<string, string>;
  };

  // Book pane state
  book?: {
    openTabs?: Array<{ abbreviation: string; name: string }>;
    activeTabIndex?: number;
    currentSectionByTab?: Record<string, number | null>;
  };

  // Notes pane state
  notes?: {
    selectedNoteId?: number | null;
    expandedNodeIds?: number[];
  };

  // Search pane state
  search?: {
    query?: string;
    searchType?: string;
    selectedModules?: string[];
  };

  // Window/pane layout state
  layout?: {
    activeLayout?: string;
    paneVisibility?: Record<string, boolean>;
    paneSizes?: Record<string, number>;
  };

  // Dockview serialized layout (flexible pane system)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dockviewState?: Record<string, any>;

  // Other UI state
  ui?: {
    // Legacy/unused - superseded by `preferences.theme` below. Kept only so
    // reading an old session blob doesn't require a schema migration.
    theme?: string;
    fontSize?: number;
    // Text settings per pane type
    textSettings?: {
      bible?: { fontSize: number; fontFamily: string; lineHeight: number };
      commentary?: { fontSize: number; fontFamily: string; lineHeight: number };
      book?: { fontSize: number; fontFamily: string; lineHeight: number };
      dictionary?: { fontSize: number; fontFamily: string; lineHeight: number };
    };
    // Which of the panes above were explicitly customized (Preferences >
    // Fonts) vs. following the global Typography section live. Absent on
    // sessions saved before this field existed - MUST be treated as "none
    // customized" on restore, not "all customized", or every pane would look
    // customized forever and the Typography sliders would silently stop
    // applying to any pane. See settings-preferences.md.
    textSettingsCustomized?: {
      bible?: boolean;
      commentary?: boolean;
      book?: boolean;
      dictionary?: boolean;
    };
    // Global theme + typography preferences (desktop's usePreferencesStore).
    preferences?: {
      theme?: string;
      globalFontScale?: number;
      uiControlFontSize?: number;
      typography?: {
        bibleFontSize?: number;
        studyFontSize?: number;
        uiFontSize?: number;
        bibleLineHeight?: number;
        studyLineHeight?: number;
        uiLineHeight?: number;
        bibleFontFamily?: string;
        studyFontFamily?: string;
        uiFontFamily?: string;
      };
    };
    // Notes directory path (file-based notes)
    notesDirectory?: string;
    // Recently opened .bn files (absolute paths, most recent first)
    recentFiles?: Array<{ path: string; title: string; openedAt: string }>;
    // Where each notes ("Writing") panel was left, keyed by dockview panel id
    // (e.g. `notes_default`) - never the `_default` fallback key, which no
    // dockview-hosted pane registers under. Restoring these is what brings the
    // app back to the note the user was writing, in the sub-tab they were in.
    //
    // Optional, and every field inside is optional: sessions saved before this
    // existed simply have no entry, and a panel with an unreadable entry must
    // fall back to the notes root rather than fail to restore.
    notesPanels?: Record<string, {
      view?: 'browser' | 'editor';
      sideTab?: 'browse' | 'recent';
      currentPath?: string;
      currentNotePath?: string;
    }>;
  };
}

/**
 * Session entity from the user database
 * Represents a saved study session with all UI state
 */
export class Session {
  sessionId?: number;
  name: string;
  description?: string;
  createdDate?: string;
  modifiedDate?: string;
  lastOpened?: string;
  isAutosave: boolean;
  isDefault: boolean;
  sessionData: SessionData;
  metadata?: Metadata;

  constructor(data: {
    sessionId?: number;
    name: string;
    description?: string;
    createdDate?: string;
    modifiedDate?: string;
    lastOpened?: string;
    isAutosave?: boolean;
    isDefault?: boolean;
    sessionData: SessionData;
    metadata?: Metadata;
  }) {
    this.sessionId = data.sessionId;
    this.name = data.name;
    this.description = data.description;
    this.createdDate = data.createdDate;
    this.modifiedDate = data.modifiedDate;
    this.lastOpened = data.lastOpened;
    this.isAutosave = data.isAutosave ?? false;
    this.isDefault = data.isDefault ?? false;
    this.sessionData = data.sessionData;
    this.metadata = data.metadata;
  }

  /**
   * Check if this is the autosave session
   */
  isAutosaveSession(): boolean {
    return this.isAutosave;
  }

  /**
   * Check if this is the default session
   */
  isDefaultSession(): boolean {
    return this.isDefault;
  }

  /**
   * Update the modified date to now
   */
  touch(): void {
    this.modifiedDate = new Date().toISOString();
  }

  /**
   * Update the last opened time to now
   */
  markOpened(): void {
    this.lastOpened = new Date().toISOString();
  }

  /**
   * Get a copy of the session data
   */
  getSessionData(): SessionData {
    return { ...this.sessionData };
  }

  /**
   * Update the session data
   */
  updateSessionData(data: SessionData): void {
    this.sessionData = data;
    this.touch();
  }

  /**
   * Merge partial session data updates
   */
  mergeSessionData(partialData: Partial<SessionData>): void {
    this.sessionData = {
      ...this.sessionData,
      ...partialData
    };
    this.touch();
  }
}
