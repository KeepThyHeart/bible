/**
 * The Presenter's feature-module manifest (web): data only, loaded at boot.
 * Everything the Presenter adds to the host is declared here; switching the
 * module off (`kth.modules = '-present'` in a dev build, or the server
 * reporting it off) removes all of it. Ids and URLs are persisted or shared
 * (`#/@present`, `/present/v|f|c/`, `present.showVerse`): never rename them.
 */
import type { AppDescriptor, FeatureModuleManifest, NewTabTileContribution, VerseActionContribution } from '@bible/core/browser';

export const PRESENT_MODULE_ID = 'present';

export const presentDescriptor: AppDescriptor = {
  id: 'present',
  title: { key: 'apps.present.title', fallback: 'Presenter' },
  icon: { kind: 'builtin', name: 'fa-tv' },
  order: 10,
  platforms: ['web'],
  deepLink: { segment: 'present' },
  lifecycle: { keepAlive: 'while-busy', restore: 'while-busy' },
  ownChrome: true,
};

/** "Present" in the verse context menu: shown while a session is live; the handler loads on first use. */
export const presentVerseAction: VerseActionContribution = {
  id: 'present.showVerse',
  title: { key: 'contextMenu.present', fallback: 'Present' },
  icon: { kind: 'builtin', name: 'fa-tv' },
  appId: 'present',
  when: 'present.live',
  order: 10,
  group: 'app',
};

/** Home-screen tile: the bare join page (`/watch`), not an in-app route. */
export const watchPresentationTile: NewTabTileContribution = {
  id: 'watchPresentation',
  title: { key: 'homeScreen.watchPresentation', fallback: 'Watch a presentation' },
  icon: { kind: 'builtin', name: 'fa-tv' },
  order: 30,
  platforms: ['web'],
  target: { href: '/watch' },
};

export const presentManifest: FeatureModuleManifest = {
  id: PRESENT_MODULE_ID,
  platforms: ['web'],
  // A follow-along reader pauses following when the reader opens another chapter.
  hooks: [{ event: 'reader.chapterRendered' }],
  contributes: {
    apps: [presentDescriptor],
    verseActions: [presentVerseAction],
    newTabTiles: [watchPresentationTile],
    i18nNamespace: 'present',
    // Informational: the server half (`server/modules/present`) mounts these.
    serverRoutes: [
      { id: 'present-api', path: '/api/present' },
      { id: 'hymns-api', path: '/api/hymns' },
      { id: 'present-pages', path: '/present' },
      { id: 'watch-page', path: '/watch' },
    ],
  },
};
