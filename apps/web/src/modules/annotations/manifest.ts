/**
 * The Annotations feature-module manifest (web): data only, loaded at boot. Highlights, notes and bookmarks kept in
 * the local OPFS user database, behind flag `localUserDb`. Ids, orders and label keys are shown before the module's
 * code loads: never rename them. The data syncs with desktop (user_text_markup, user_note, collection/pinned_item).
 */
import type { FeatureModuleManifest, VerseActionContribution } from '@bible/core/browser';

export const ANNOTATIONS_MODULE_ID = 'annotations';
/** Context key defined by the module's code: the local user database can be opened in this browser. */
export const USERDB_AVAILABLE_KEY = 'userDb.available';

export const annotationsVerseActions: readonly VerseActionContribution[] = [
  {
    id: 'annotations.highlight',
    title: { key: 'verseActions.highlight', fallback: 'Highlight' },
    icon: { kind: 'builtin', name: 'fa-highlighter' },
    group: 'study',
    order: 40,
    when: USERDB_AVAILABLE_KEY,
  },
  {
    id: 'annotations.note',
    title: { key: 'verseActions.note', fallback: 'Add or edit note' },
    icon: { kind: 'builtin', name: 'fa-note-sticky' },
    group: 'study',
    order: 41,
    when: USERDB_AVAILABLE_KEY,
  },
  {
    id: 'annotations.bookmark',
    title: { key: 'verseActions.bookmark', fallback: 'Bookmark' },
    icon: { kind: 'builtin', name: 'fa-bookmark' },
    group: 'study',
    order: 42,
    when: USERDB_AVAILABLE_KEY,
  },
];

export const annotationsManifest: FeatureModuleManifest = {
  id: ANNOTATIONS_MODULE_ID,
  flag: 'localUserDb',
  platforms: ['web'],
  contributes: {
    verseActions: [...annotationsVerseActions],
    i18nNamespace: 'annotations',
  },
};
