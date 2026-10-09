/**
 * The Word study module's main-process API, shared by `./index.ts` (implements it through
 * `ipc.handle`) and the renderer's `createModuleClient<WordStudyApi>('word-study')`.
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

export interface WordStudyApi {
  resolve(query: string): WordKeyCandidate[];
  getOverview(subject: WordStudySubject, options?: WordStudyOptions): WordStudyOverview;
  getOccurrences(subject: WordStudySubject, query: WordOccurrenceQuery): WordOccurrencePage;
  listGroups(): WordGroup[];
  saveGroup(group: Partial<WordGroup> & { terms: string[] }): WordGroup;
  deleteGroup(id: string): boolean;
}
