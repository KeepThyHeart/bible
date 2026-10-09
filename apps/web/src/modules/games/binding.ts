/**
 * Games' web binding: entry-chunk code, so only lazy loaders. The module's code
 * (`module.ts`: the live badge wiring) loads when the app is opened; the app
 * view and the games themselves are a separate lazy chunk.
 */
import type { WebFeatureModule } from '../moduleHost';
import { gamesManifest } from './manifest';

export const gamesModule: WebFeatureModule = {
  manifest: gamesManifest,
  binding: {
    id: 'games',
    load: () => import('./module'),
  },
  apps: [
    {
      id: 'games',
      load: () => import('./app/GamesApp').then((m) => ({ View: m.GamesApp })),
    },
  ],
};
