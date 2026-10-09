/**
 * The Games feature-module manifest (web): data only, loaded at boot.
 * Everything Games adds to the host is declared here; switching the module off
 * (`kth.modules = '-games'` in a dev build, or the server reporting it off)
 * removes all of it. Ids and URLs are shared or persisted (`#/@games`,
 * `/games/play`, `/api/games`): never rename them.
 */
import type { AppDescriptor, FeatureModuleManifest, NewTabTileContribution } from '@bible/core/browser';

export const GAMES_MODULE_ID = 'games';

export const gamesDescriptor: AppDescriptor = {
  id: 'games',
  title: { key: 'apps.games.title', fallback: 'Games' },
  icon: { kind: 'builtin', name: 'fa-gamepad' },
  order: 40,
  platforms: ['web'],
  deepLink: { segment: 'games' },
  // A room on the screen keeps the app mounted (and badged "live") while the leader reads elsewhere.
  lifecycle: { keepAlive: 'while-busy', restore: 'default' },
};

/** Home-screen tile that opens the Games app. */
export const gamesTile: NewTabTileContribution = {
  id: 'games',
  title: { key: 'homeScreen.games', fallback: 'Bible games' },
  icon: { kind: 'builtin', name: 'fa-gamepad' },
  order: 40,
  platforms: ['web'],
  target: { appId: 'games' },
};

export const gamesManifest: FeatureModuleManifest = {
  id: GAMES_MODULE_ID,
  platforms: ['web'],
  contributes: {
    apps: [gamesDescriptor],
    newTabTiles: [gamesTile],
    i18nNamespace: 'games',
    // Informational: the server half (`server/modules/games`) mounts these.
    serverRoutes: [
      { id: 'games-api', path: '/api/games' },
      { id: 'games-pages', path: '/games' },
    ],
  },
};
