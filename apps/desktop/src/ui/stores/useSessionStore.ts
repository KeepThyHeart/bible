import { create } from 'zustand';
import { SessionData } from '@bible/core';
import { setSessionDirtyCallback } from './helpers/sessionNotifier';
import { getSessionSerializers } from './helpers/sessionRegistry';
import React from 'react';

/**
 * Session store for managing study session state
 * This store handles loading/saving session configuration and coordinating
 * with other stores for session persistence
 */
interface SessionState {
  // Current session
  currentSessionId: number | null;
  currentSessionName: string;
  isSessionLoaded: boolean;
  isDirty: boolean; // Has session changed since last save?
  lastSaveTime: Date | null;

  // Auto-save settings
  autoSaveEnabled: boolean;
  autoSaveIntervalMs: number; // Default 30 seconds

  // Actions
  loadSession: (sessionId: number) => Promise<void>;
  createNewSession: (name: string, description?: string) => Promise<void>;
  saveCurrentSession: () => Promise<void>;
  markDirty: () => void;
  setAutoSave: (enabled: boolean, intervalMs?: number) => void;

  // Session data getters/setters (used by other stores)
  getSessionData: () => SessionData;
  updateSessionData: (partialData: Partial<SessionData>) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  // Initial state
  currentSessionId: null,
  currentSessionName: 'Untitled Session',
  isSessionLoaded: false,
  isDirty: false,
  lastSaveTime: null,
  autoSaveEnabled: true,
  autoSaveIntervalMs: 30000, // 30 seconds

  /**
   * Load a session by ID
   * This will fetch the session from the database and restore state to all stores
   */
  loadSession: async (sessionId: number) => {
    try {
      // Dynamically import sessionAPI
      const { sessionAPI } = await import('../services/electronAPI');

      // Call electron API to load session
      const session = await sessionAPI.load(sessionId);

      if (!session) {
        console.error(`Session ${sessionId} not found`);
        return;
      }

      set({
        currentSessionId: session.sessionId ?? null,
        currentSessionName: session.name,
        isSessionLoaded: true,
        isDirty: false,
        lastSaveTime: new Date()
      });

      // Restore state to all stores using the session data
      // This will be called by the stores themselves when they initialize
    } catch (error) {
      console.error('Error loading session:', error);
    }
  },

  /**
   * Create a new session
   */
  createNewSession: async (name: string, description?: string) => {
    try {
      // Dynamically import sessionAPI
      const { sessionAPI } = await import('../services/electronAPI');

      // Gather current state from all stores
      const sessionData = get().getSessionData();

      // Call electron API to create session
      const session = await sessionAPI.create({
        name,
        description,
        sessionData
      });

      set({
        currentSessionId: session.sessionId ?? null,
        currentSessionName: session.name,
        isSessionLoaded: true,
        isDirty: false,
        lastSaveTime: new Date()
      });
    } catch (error) {
      console.error('Error creating new session:', error);
    }
  },

  /**
   * Save the current session
   */
  saveCurrentSession: async () => {
    const { currentSessionId, isDirty } = get();

    if (!currentSessionId || !isDirty) {
      return;
    }

    try {
      // Dynamically import sessionAPI
      const { sessionAPI } = await import('../services/electronAPI');

      // Gather current state from all stores
      const sessionData = get().getSessionData();

      // Call electron API to update session
      await sessionAPI.update(currentSessionId, { sessionData });

      set({
        isDirty: false,
        lastSaveTime: new Date()
      });
    } catch (error) {
      console.error('Error saving session:', error);
    }
  },

  /**
   * Mark session as dirty (needs saving)
   */
  markDirty: () => {
    set({ isDirty: true });
  },

  /**
   * Set auto-save configuration
   */
  setAutoSave: (enabled: boolean, intervalMs?: number) => {
    set({
      autoSaveEnabled: enabled,
      autoSaveIntervalMs: intervalMs ?? 30000
    });
  },

  /**
   * Get current session data from all stores via the session registry.
   *
   * Each store registers a serializer under a well-known key (e.g. 'bible',
   * 'commentary').  This method collects them and assembles a SessionData
   * object, removing the need to directly import every domain store.
   */
  getSessionData: (): SessionData => {
    const serializers = getSessionSerializers();

    // Helper to retrieve a serializer's output (typed as any for assignment
    // into the SessionData structure which expects specific shapes).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const get_ = (key: string): any => serializers.get(key)?.();

    return {
      bible: get_('bible'),
      commentary: get_('commentary'),
      book: get_('book'),
      dictionary: get_('dictionary'),
      notes: get_('notes'),
      dockviewState: get_('dockviewState') ?? undefined,
      ui: {
        textSettings: get_('textSettings'),
        textSettingsCustomized: get_('textSettingsCustomized'),
        preferences: get_('preferences'),
        ...get_('fileNotes')
      }
    };
  },

  /**
   * Update session data (called by other stores)
   */
  updateSessionData: (_partialData: Partial<SessionData>) => {
    // This is a placeholder - in practice, this would update the stores
    // based on the partial data provided
    get().markDirty();
  }
}));

// Wire up the session dirty callback so other stores can call markSessionDirty()
// without importing useSessionStore.
setSessionDirtyCallback(() => useSessionStore.getState().markDirty());

/**
 * Hook to set up auto-save interval
 * Call this once in your root component
 */
export function useSessionAutoSave() {
  const autoSaveEnabled = useSessionStore(s => s.autoSaveEnabled);
  const autoSaveIntervalMs = useSessionStore(s => s.autoSaveIntervalMs);
  const saveCurrentSession = useSessionStore(s => s.saveCurrentSession);

  // Stable reference that always calls the latest saveCurrentSession without
  // needing it in the dependency array (prevents interval resets on every
  // store update).
  const stableSave = React.useCallback(() => {
    saveCurrentSession();
  }, [saveCurrentSession]);

  React.useEffect(() => {
    if (!autoSaveEnabled) return;

    const interval = setInterval(stableSave, autoSaveIntervalMs);

    // Save session before window closes to prevent data loss
    window.addEventListener('beforeunload', stableSave);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', stableSave);
    };
  }, [autoSaveEnabled, autoSaveIntervalMs, stableSave]);
}
