/**
 * Frontend API for highlight operations via IPC.
 *
 * Uses the `Result<T>` envelope convention: the main-process handlers in
 * `electron/ipc/highlightHandlers.ts` return
 * `{ ok, value } | { ok: false, error }`. Each call here uses `unwrap` to
 * convert that envelope into a plain value (or a thrown `IpcResultError`).
 */

import { UserTextMarkup, HighlightColor, VerseId, IUserTextMarkupRepository } from '@bible/core';
import type { TextMarkupMetadata } from '@bible/core';
import { unwrap } from './ipcResult';

interface SerializedMarkup {
  markupId?: number;
  moduleId: number;
  verseIdStart: VerseId;
  verseIdEnd?: VerseId;
  textStart?: number;
  textEnd?: number;
  color: HighlightColor;
  noteId?: number;
  createdDate?: string;
  metadata?: TextMarkupMetadata;
}

// Bind to preserve `this` if the bridge method depends on it.
const invoke: typeof window.electron.ipcRenderer.invoke = (channel, ...args) =>
  window.electron.ipcRenderer.invoke(channel, ...args);

// IPC API
export const highlightsAPI = {
  create: async (highlightData: Omit<UserTextMarkup, 'markupId'>): Promise<UserTextMarkup> => {
    const data = await unwrap<SerializedMarkup>(invoke('highlights:create', highlightData));
    return new UserTextMarkup(data);
  },

  update: async (highlight: UserTextMarkup): Promise<void> => {
    await unwrap<void>(invoke('highlights:update', highlight));
  },

  delete: async (markupId: number): Promise<void> => {
    await unwrap<void>(invoke('highlights:delete', markupId));
  },

  getById: async (markupId: number): Promise<UserTextMarkup | null> => {
    const data = await unwrap<SerializedMarkup | null>(invoke('highlights:get-by-id', markupId));
    return data ? new UserTextMarkup(data) : null;
  },

  getForVerse: async (verseId: VerseId, moduleId: number): Promise<UserTextMarkup[]> => {
    const data = await unwrap<SerializedMarkup[]>(
      invoke('highlights:get-for-verse', verseId, moduleId)
    );
    return data.map((d) => new UserTextMarkup(d));
  },

  getForVerseRange: async (
    startVerseId: VerseId,
    endVerseId: VerseId,
    moduleId: number
  ): Promise<UserTextMarkup[]> => {
    const data = await unwrap<SerializedMarkup[]>(
      invoke('highlights:get-for-verse-range', startVerseId, endVerseId, moduleId)
    );
    return data.map((d) => new UserTextMarkup(d));
  },

  getForModule: async (moduleId: number): Promise<UserTextMarkup[]> => {
    const data = await unwrap<SerializedMarkup[]>(invoke('highlights:get-for-module', moduleId));
    return data.map((d) => new UserTextMarkup(d));
  },

  getByColor: async (color: HighlightColor, moduleId?: number): Promise<UserTextMarkup[]> => {
    const data = await unwrap<SerializedMarkup[]>(
      invoke('highlights:get-by-color', color, moduleId)
    );
    return data.map((d) => new UserTextMarkup(d));
  },

  deleteForVerse: async (verseId: VerseId, moduleId: number): Promise<void> => {
    await unwrap<void>(invoke('highlights:delete-for-verse', verseId, moduleId));
  },

  countForModule: async (moduleId: number): Promise<number> => {
    return unwrap<number>(invoke('highlights:count-for-module', moduleId));
  },

  getByNote: async (noteId: number): Promise<UserTextMarkup[]> => {
    const data = await unwrap<SerializedMarkup[]>(invoke('highlights:get-by-note', noteId));
    return data.map((d) => new UserTextMarkup(d));
  },

  deleteForVerseRange: async (
    startVerseId: VerseId,
    endVerseId: VerseId,
    moduleId: number
  ): Promise<void> => {
    await unwrap<void>(
      invoke('highlights:delete-for-verse-range', startVerseId, endVerseId, moduleId)
    );
  },

  findOverlapping: async (
    startVerseId: VerseId,
    endVerseId: VerseId | null,
    moduleId: number
  ): Promise<UserTextMarkup[]> => {
    const data = await unwrap<SerializedMarkup[]>(
      invoke('highlights:find-overlapping', startVerseId, endVerseId, moduleId)
    );
    return data.map((d) => new UserTextMarkup(d));
  }
};

/**
 * IPC-based repository implementation for use with highlight components
 * This implements the IUserTextMarkupRepository interface but uses IPC instead of direct DB access
 */
export class IPCHighlightRepository implements IUserTextMarkupRepository {
  async create(markup: UserTextMarkup): Promise<UserTextMarkup> {
    return highlightsAPI.create(markup);
  }

  async update(markup: UserTextMarkup): Promise<void> {
    return highlightsAPI.update(markup);
  }

  async delete(markupId: number): Promise<void> {
    return highlightsAPI.delete(markupId);
  }

  async getById(markupId: number): Promise<UserTextMarkup | null> {
    return highlightsAPI.getById(markupId);
  }

  async getForVerse(verseId: VerseId, moduleId: number): Promise<UserTextMarkup[]> {
    return highlightsAPI.getForVerse(verseId, moduleId);
  }

  async getForVerseRange(
    start: VerseId,
    end: VerseId,
    moduleId: number
  ): Promise<UserTextMarkup[]> {
    return highlightsAPI.getForVerseRange(start, end, moduleId);
  }

  async getForModule(moduleId: number): Promise<UserTextMarkup[]> {
    return highlightsAPI.getForModule(moduleId);
  }

  async getByColor(color: HighlightColor, moduleId?: number): Promise<UserTextMarkup[]> {
    return highlightsAPI.getByColor(color, moduleId);
  }

  async getByNote(noteId: number): Promise<UserTextMarkup[]> {
    return highlightsAPI.getByNote(noteId);
  }

  async deleteForVerse(verseId: VerseId, moduleId: number): Promise<void> {
    return highlightsAPI.deleteForVerse(verseId, moduleId);
  }

  async deleteForVerseRange(start: VerseId, end: VerseId, moduleId: number): Promise<void> {
    return highlightsAPI.deleteForVerseRange(start, end, moduleId);
  }

  async countForModule(moduleId: number): Promise<number> {
    return highlightsAPI.countForModule(moduleId);
  }

  async findOverlapping(
    start: VerseId,
    end: VerseId | null,
    moduleId: number
  ): Promise<UserTextMarkup[]> {
    return highlightsAPI.findOverlapping(start, end, moduleId);
  }
}
