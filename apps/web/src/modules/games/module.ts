/**
 * Games' module code, activated on `onApp:games`: connects the host screen's
 * "room open" signal to the app registry (busy flag + a live dot on the rail).
 */
import type { Disposable, FeatureModuleContext } from '@bible/core/browser';
import { appRegistry } from '../../host/appHost';
import i18n from '../../i18n';
import { setGamesLiveSink } from './runtime';

const own = (dispose: () => void): Disposable => ({ dispose });

export async function activate(ctx: FeatureModuleContext): Promise<void> {
  setGamesLiveSink((live) => {
    appRegistry.setBusy('games', live);
    appRegistry.setBadge('games', live ? { kind: 'dot', tone: 'live', label: i18n.t('games.app.live', 'Room live') } : undefined);
  });
  ctx.subscriptions.push(
    own(() => {
      setGamesLiveSink(null);
      appRegistry.setBusy('games', false);
      appRegistry.setBadge('games', undefined);
    }),
  );
}
