/**
 * Main-process half of the Similar passages feature module (tasks 0070, 0126): finds passages
 * similar to a verse or passage from the precomputed neighbour table or, when the semantic pack
 * is installed, a live scan. Channels are `module:similar:<method>`; replies use the `Result<T>`
 * envelope. The renderer side is `src/ui/modules/similar/similarAPI.ts`; the payload types are
 * in `./types.ts`.
 */
import type { FeatureMainModule } from '../FeatureMainModule';
import { onSemanticSearchReset } from '../../ipc/semanticSearchReset';
import { createDefaultSimilarApi } from './similarApi';
import type { SimilarApi } from './similarApi';

const similarMainModule: FeatureMainModule = {
  id: 'similar',
  registerIpc(ipc) {
    let api: Promise<SimilarApi> | null = null;
    let current: SimilarApi | null = null;
    // Built on first use: this pulls in the whole handler graph.
    const get = (): Promise<SimilarApi> =>
      (api ??= createDefaultSimilarApi(() => current?.reset()).then((created) => {
        current = created;
        return created;
      }));

    ipc.handle('find', async (range: unknown, opts?: unknown, module?: unknown) => (await get()).find(range, opts, module));
    ipc.handle('explain', async (a: unknown, b: unknown, module?: unknown) => (await get()).explain(a, b, module));
    ipc.handle('status', async () => (await get()).status());
    ipc.handle('reset', async () => {
      (await get()).reset();
      return true as const;
    });

    // A semantic pack change (install, uninstall) drops the cached results.
    return onSemanticSearchReset(() => current?.reset());
  },
};

export default similarMainModule;
