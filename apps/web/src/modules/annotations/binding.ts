/**
 * The Annotations web binding (entry-chunk code): lazy loaders and a boot probe. Never import `./module` or anything
 * from `src/userdb` statically from here: the entry-chunk guard forbids it. The probe activates the module after the
 * first paint so the `userDb.available` key exists before the verse menu is first opened.
 */
import type { WebFeatureModule } from '../moduleHost';
import { annotationsManifest } from './manifest';

export const annotationsModule: WebFeatureModule = {
  manifest: annotationsManifest,
  binding: { id: 'annotations', load: () => import('./module') },
  verseActionHandlers: [
    { id: 'annotations.highlight', load: () => import('./verseActions').then((m) => m.highlightHandler) },
    { id: 'annotations.note', load: () => import('./verseActions').then((m) => m.noteHandler) },
    { id: 'annotations.bookmark', load: () => import('./verseActions').then((m) => m.bookmarkHandler) },
  ],
  probe: () => ({ activate: true }),
};
