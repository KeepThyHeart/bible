import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
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
    // writeBundle, not emitFile: an emitted dot-dir asset did not reach dist/client.
    writeBundle(options, bundle) {
      if (!options.dir || !Object.values(bundle).some((c) => c.type === 'chunk' && c.isEntry && c.facadeModuleId?.endsWith('index.html'))) return;
      const chunks = Object.values(bundle)
        .filter((c) => c.type === 'chunk')
        .map((c) => ({
          fileName: c.fileName,
          isEntry: c.isEntry,
          facadeModuleId: c.facadeModuleId ? rel(c.facadeModuleId) : null,
          imports: c.imports,
          modules: Object.keys(c.modules).map(rel),
        }));
      mkdirSync(join(options.dir, '.vite'), { recursive: true });
      writeFileSync(join(options.dir, '.vite', 'chunk-report.json'), JSON.stringify({ chunks }, null, 2));
    },
  };
}
