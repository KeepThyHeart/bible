import type { AggregationModule, ICrossReferenceRepository, XrefGraphIndex, EgoOptions, VerseId } from '@bible/core';
import { XrefGraphIndexBuilder, XrefGraphService } from '@bible/core';
import { getSharedModuleMetadataRepo } from '../../services/sharedMainDb';
import { IpcKnownError } from '../../ipc/result';
import { validateVerseId } from '../../utils/validation';
import { ensureXrefRepository } from '../../ipc/crossReferenceHandlers';
import { getUserXrefRepoForLinks } from '../../ipc/studyHandlers';
import type { FeatureMainModule } from '../FeatureMainModule';

/**
 * Main-process half of the Cross-ref graph feature module (tasks 0068, 0126). Channels are
 * `module:xref-graph:<method>` (see `FeatureMainModule`); the renderer side is
 * `src/ui/modules/xref-graph/xrefGraphProvider.ts`.
 *
 * Cross-reference graph IPC (task 0068): ego graphs and ranked neighbours from every installed
 * cross-reference module plus the user's own links, and the whole-canon index for the arc view.
 * The index is a scan of ~340k links, built on first use and kept in memory keyed by the modules'
 * fingerprint, so installing a module rebuilds it and nothing else does.
 */

async function loadModules(): Promise<AggregationModule<ICrossReferenceRepository>[]> {
  const out: AggregationModule<ICrossReferenceRepository>[] = [];
  for (const mod of getSharedModuleMetadataRepo().getByType('cross_reference')) {
    const abbreviation = mod.abbreviation || mod.getAbbreviation();
    const repository = await ensureXrefRepository(abbreviation);
    if (repository) out.push({ abbreviation, moduleName: mod.moduleName, repository });
  }
  return out;
}

let cachedIndex: { fingerprint: string; index: XrefGraphIndex } | null = null;

async function getIndex(): Promise<XrefGraphIndex> {
  const modules = await loadModules();
  const builder = new XrefGraphIndexBuilder();
  const fingerprint = builder.fingerprint(modules);
  if (!cachedIndex || cachedIndex.fingerprint !== fingerprint) {
    cachedIndex = { fingerprint, index: builder.build(modules) };
  }
  return cachedIndex.index;
}

function checkOptions(opts: EgoOptions): EgoOptions {
  if (![1, 2, 3].includes(opts?.depth)) throw new IpcKnownError('invalid_input', 'depth must be 1, 2 or 3');
  if (opts.minWeight !== undefined && !(opts.minWeight >= 0 && opts.minWeight <= 1)) {
    throw new IpcKnownError('invalid_input', 'minWeight must be between 0 and 1');
  }
  return {
    depth: opts.depth,
    maxNodes: typeof opts.maxNodes === 'number' ? opts.maxNodes : undefined,
    minWeight: opts.minWeight,
    sources: Array.isArray(opts.sources) ? opts.sources.filter(s => typeof s === 'string') : undefined,
    includeUser: opts.includeUser,
  };
}

const xrefGraphMainModule: FeatureMainModule = {
  id: 'xref-graph',
  registerIpc(ipc) {
    ipc.handle('getEgoGraph', async (anchor: VerseId, opts: EgoOptions) => {
      validateVerseId(anchor);
      const service = new XrefGraphService(await loadModules(), getUserXrefRepoForLinks());
      return service.getEgoGraph(anchor, checkOptions(opts));
    });

    ipc.handle('getNeighbours', async (verseId: VerseId, limit?: number) => {
      validateVerseId(verseId);
      const service = new XrefGraphService(await loadModules(), getUserXrefRepoForLinks());
      return service.getNeighbours(verseId, typeof limit === 'number' && limit > 0 ? Math.min(limit, 500) : undefined);
    });

    ipc.handle('getBookMatrix', async () => (await getIndex()).books);

    // Structured clone carries the typed arrays as they are.
    ipc.handle('getChapterArcs', async () => (await getIndex()).arcs);
  },
  close() {
    resetXrefGraphIndex();
  },
};

export default xrefGraphMainModule;

/** Drop the cached index (tests, and after a module is installed or removed). */
export function resetXrefGraphIndex(): void {
  cachedIndex = null;
}
