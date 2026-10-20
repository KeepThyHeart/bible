import type { ISearchProvider } from '../providers/interfaces';
import { settingsStore } from '../stores/settingsStore';
import { preferredBible } from '../host/preferredBible';
import { getOfflineBible } from './offlineBible';
import type { ShellContext } from './shellContext';

let pending: Promise<ISearchProvider> | null = null;

/**
 * The search provider shared by Study's search store and the Presenter's verse
 * search. Semantic search provider selection:
 *  - Server declares 'remote' mode   -> online meaning search behind a consent (RemoteSearchProvider).
 *  - Server declares 'browser' mode  -> always run search locally.
 *  - Server declares 'server'/'off'  -> honour the per-user opt-in (default: server pipeline).
 * Memoised: both callers get the same instance.
 */
export function getSearchProvider(
  ctx: Pick<ShellContext, 'baseUrl' | 'providers' | 'semanticMode' | 'remoteSearch'>,
): Promise<ISearchProvider> {
  if (!pending) {
    pending = (async (): Promise<ISearchProvider> => {
      if (ctx.semanticMode === 'remote' && ctx.remoteSearch) {
        const { RemoteSearchProvider } = await import('../search/remote/RemoteSearchProvider');
        const { remoteConsentStore } = await import('../search/remote/consentStore');
        const remote = ctx.remoteSearch;
        return new RemoteSearchProvider({
          baseUrl: ctx.baseUrl,
          inner: ctx.providers.search,
          consent: remoteConsentStore,
          // Only the browser-direct path needs verse text from the client side.
          getBible: () => getOfflineBible(ctx),
          getActiveModule: () => preferredBible.module,
          remote: remote.via === 'browser' ? { url: remote.url, apiKey: remote.apiKey } : undefined,
        });
      }
      const browserSearchEnabled = ctx.semanticMode === 'browser' || settingsStore.browserSemanticSearch;
      if (!browserSearchEnabled) return ctx.providers.search;
      const { BrowserSearchProvider } = await import('../search/BrowserSearchProvider');
      const baseUrl = ctx.baseUrl;
      return new BrowserSearchProvider(
        baseUrl,
        `${baseUrl}/data/semantic_128d_int8.bin`,
        `${baseUrl}/data/semantic_128d_int8.meta.json`,
        await getOfflineBible(ctx), // resolve verse text offline-first from the active version's cached module
        () => preferredBible.module,
        `${baseUrl}/data/models`, // self-hosted model (offline; no HuggingFace CDN)
        `${baseUrl}/ort/`,        // self-hosted ONNX Runtime wasm (CSP blocks the jsDelivr default)
      );
    })();
    pending.catch(() => { pending = null; });
  }
  return pending;
}

/** Test hook: forget the memoised provider. */
export function resetSearchProviderForTests(): void {
  pending = null;
}
