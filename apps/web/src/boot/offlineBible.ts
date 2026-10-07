import type { IBibleDataProvider } from '../providers/interfaces';
import type { ShellContext } from './shellContext';

let pending: Promise<IBibleDataProvider> | null = null;

/**
 * The one offline-first Bible provider (OPFS -> server fallback), shared by
 * Study, search and the verse-of-the-day reminder. Built on first use so the
 * shell never loads the offline stack unless an app asks for it.
 */
export function getOfflineBible(ctx: Pick<ShellContext, 'providers'>): Promise<IBibleDataProvider> {
  if (!pending) {
    pending = (async () => {
      const [{ BibleWorkerProxy }, { createOfflineBibleProvider }] = await Promise.all([
        import('../offline/BibleWorkerProxy'),
        import('../offline/sharedInstances'),
      ]);
      return createOfflineBibleProvider(ctx.providers.bible, new BibleWorkerProxy());
    })();
    pending.catch(() => { pending = null; });
  }
  return pending;
}

/** Test hook: forget the memoised provider. */
export function resetOfflineBibleForTests(): void {
  pending = null;
}
