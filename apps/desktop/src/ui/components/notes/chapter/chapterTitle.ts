import { getLocalizedReferenceParser } from '../../../services/localizedReferenceParser';
import type { ChapterModeNavState } from '../../../stores/notesChapterNavState';

/** "Romans 8": the localized book name and chapter, used for window titles, subtitles and Compile prefill. */
export function chapterTitle(s: Pick<ChapterModeNavState, 'book' | 'chapter'>): string {
  return `${getLocalizedReferenceParser().getBookName(s.book)} ${s.chapter}`;
}
