/**
 * Renderer-facing typed wrapper over the Word study main-process module
 * (`electron/modules/word-study`, channels `module:word-study:*`). The client
 * unwraps the `Result<T>` envelope, so failures arrive as rejections.
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
import { createModuleClient } from '../../services/moduleClient';
import type { WordStudyApi as WordStudyBridge } from '../../../../electron/modules/word-study/types';

export interface WordStudyApi {
  resolve(query: string): Promise<WordKeyCandidate[]>;
  getOverview(subject: WordStudySubject, options?: WordStudyOptions): Promise<WordStudyOverview>;
  getOccurrences(subject: WordStudySubject, query: WordOccurrenceQuery): Promise<WordOccurrencePage>;
  listGroups(): Promise<WordGroup[]>;
  saveGroup(group: Partial<WordGroup> & { terms: string[] }): Promise<WordGroup>;
  deleteGroup(id: string): Promise<boolean>;
}

const client = createModuleClient<WordStudyBridge>('word-study');

export const wordStudyApi: WordStudyApi = {
  resolve: (query) => client.resolve(query),
  getOverview: (subject, options) => client.getOverview(subject, options),
  getOccurrences: (subject, query) => client.getOccurrences(subject, query),
  listGroups: () => client.listGroups(),
  saveGroup: (group) => client.saveGroup(group),
  deleteGroup: (id) => client.deleteGroup(id),
};
