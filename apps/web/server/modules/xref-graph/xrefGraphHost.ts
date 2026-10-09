import type { AggregationModule, ICrossReferenceRepository, XrefGraphIndex } from '@bible/core';
import type { DatabaseManager } from '../../DatabaseManager.js';
import { XrefGraphIndexBuilder, XrefGraphService } from '../../core.js';

/**
 * Builds the cross-reference graph service over every installed cross-reference module, and
 * the whole-canon index (chapter pairs, book matrix, degrees) once per set of installed modules.
 *
 * The web server has no user database, so the graph here is modules only. The index is a scan
 * of ~340k links (seconds), done lazily on first use and held in memory keyed by the modules'
 * fingerprint, so installing a module rebuilds it and nothing else does.
 */
export class XrefGraphHost {
  private cached: { fingerprint: string; index: XrefGraphIndex } | null = null;

  constructor(private readonly db: Pick<DatabaseManager, 'getModuleMetadataRepo' | 'getCrossRefRepo'>) {}

  modules(): AggregationModule<ICrossReferenceRepository>[] {
    const out: AggregationModule<ICrossReferenceRepository>[] = [];
    for (const mod of this.db.getModuleMetadataRepo().getByType('cross_reference')) {
      const abbreviation = mod.abbreviation || mod.getAbbreviation();
      const repository = this.db.getCrossRefRepo(abbreviation);
      if (repository) out.push({ abbreviation, moduleName: mod.moduleName, repository });
    }
    return out;
  }

  service(): InstanceType<typeof XrefGraphService> {
    return new XrefGraphService(this.modules());
  }

  index(): XrefGraphIndex {
    const modules = this.modules();
    const builder = new XrefGraphIndexBuilder();
    const fingerprint = builder.fingerprint(modules);
    if (!this.cached || this.cached.fingerprint !== fingerprint) {
      this.cached = { fingerprint, index: builder.build(modules) };
    }
    return this.cached.index;
  }
}
