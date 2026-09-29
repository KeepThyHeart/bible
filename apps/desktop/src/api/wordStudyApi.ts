/**
 * Renderer-facing typed wrapper over the `wordStudy:*` IPC channels.
 * Unwraps the `Result<T>` envelope (throws `IpcResultError` on failure).
 */

import type {
  WordGroup,
  WordKeyCandidate,
  WordOccurrencePage,
  WordOccurrenceQuery,
  WordStudyOptions,
  WordStudyOverview,
  WordStudySubject,
} from '@bible/core/browser';
import { requireElectronAPI } from '../ui/services/electronAPI';
import { unwrap } from '../ui/services/ipcResult';

export interface WordStudyApi {
  resolve(query: string): Promise<WordKeyCandidate[]>;
  getOverview(subject: WordStudySubject, options?: WordStudyOptions): Promise<WordStudyOverview>;
  getOccurrences(subject: WordStudySubject, query: WordOccurrenceQuery): Promise<WordOccurrencePage>;
  listGroups(): Promise<WordGroup[]>;
  saveGroup(group: Partial<WordGroup> & { terms: string[] }): Promise<WordGroup>;
  deleteGroup(id: string): Promise<boolean>;
}

export const wordStudyApi: WordStudyApi = {
  resolve: (query) => unwrap(requireElectronAPI().wordStudy.resolve(query)),
  getOverview: (subject, options) => unwrap(requireElectronAPI().wordStudy.getOverview(subject, options)),
  getOccurrences: (subject, query) => unwrap(requireElectronAPI().wordStudy.getOccurrences(subject, query)),
  listGroups: () => unwrap(requireElectronAPI().wordStudy.listGroups()),
  saveGroup: (group) => unwrap(requireElectronAPI().wordStudy.saveGroup(group)),
  deleteGroup: (id) => unwrap(requireElectronAPI().wordStudy.deleteGroup(id)),
};
