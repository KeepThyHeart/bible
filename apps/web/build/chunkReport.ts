import { relative, sep } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Writes `.vite/chunk-report.json` listing every chunk's modules (the Vite
 * manifest only lists chunks, not the modules inlined into them). Consumed by
 * scripts/check-entry-chunk.mjs. The dot dir is not served or precached.
 */
export function chunkReport(): Plugin {
  const root = process.cwd();
  const rel = (id: string) => relative(root, id.split('?')[0]).split(sep).join('/');
  return {
    name: 'kth-chunk-report',
    apply: 'build',
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle)
        .filter((c) => c.type === 'chunk')
        .map((c) => ({
          fileName: c.fileName,
          isEntry: c.isEntry,
          facadeModuleId: c.facadeModuleId ? rel(c.facadeModuleId) : null,
          imports: c.imports,
          modules: Object.keys(c.modules).map(rel),
        }));
      this.emitFile({
        type: 'asset',
        fileName: '.vite/chunk-report.json',
        source: JSON.stringify({ chunks }, null, 2),
      });
    },
  };
}
