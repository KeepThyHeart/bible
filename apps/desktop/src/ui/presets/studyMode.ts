import type { LayoutPreset } from '../types/LayoutPreset';

/**
 * The study panes, in the order Study Mode presents them.
 *
 * Doubles as the `autoOpen` list and the group's `order`, because they are the
 * same statement: this is what the right-hand column *is*. Applying Study Mode
 * on a session missing one of them must not leave a gap the preset is named
 * after, and applying it on a session that has them all must arrange them in
 * this order rather than whatever order they happened to have been opened in.
 */
const STUDY_COLUMN = ['study', 'commentary', 'topics', 'dictionary', 'notes'] as const;

export const STUDY_MODE: LayoutPreset = {
  id: 'study-mode',
  name: { key: 'layout.studyMode.name' },
  description: { key: 'layout.studyMode.description' },
  groups: [
    { accepts: ['bible'], sizeWeight: 60 },
    {
      accepts: ['study', 'commentary', 'book', 'dictionary', 'notes', 'prayer', 'topics', 'search', 'unknown'],
      sizeWeight: 40,
      order: [...STUDY_COLUMN],
    },
  ],
  autoOpen: [...STUDY_COLUMN],
  activate: 'study',
};
