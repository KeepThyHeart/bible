/**
 * The Memory feature-module manifest for the web: data only, loaded at boot. The shared manifest
 * (`@bible/memory/manifest`) has no flag because that would switch Memory off on desktop; the web wraps it and adds
 * `flag: 'localUserDb'` (Memory keeps its data in the local user database, which the flag turns on).
 * Ids are persisted or shared (`#/@memory`, `memory.memorize`): never rename them. Icons are FontAwesome class names here.
 */
import type { AppDescriptor, FeatureModuleManifest, VerseActionContribution } from '@bible/core/browser';
import { memoryAppDescriptor, memoryManifest, memorizeVerseAction } from '@bible/memory/manifest';

export const MEMORY_WEB_FLAG = 'localUserDb';

export const memoryWebAppDescriptor: AppDescriptor = {
  ...memoryAppDescriptor,
  icon: { kind: 'builtin', name: 'fa-brain' },
  platforms: ['web'],
  deepLink: { segment: 'memory' },
};

export const memoryWebVerseAction: VerseActionContribution = {
  ...memorizeVerseAction,
  icon: { kind: 'builtin', name: 'fa-brain' },
};

export const memoryWebManifest: FeatureModuleManifest = {
  ...memoryManifest,
  flag: MEMORY_WEB_FLAG,
  platforms: ['web'],
  contributes: {
    apps: [memoryWebAppDescriptor],
    verseActions: [memoryWebVerseAction],
  },
};
