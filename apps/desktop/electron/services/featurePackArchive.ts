/**
 * Tell a feature-pack archive (a semantic-search `.biblepack` with
 * `feature-pack.json` at its root) apart from a module pack (`.biblepack`/`.zip`
 * of `.db` files, optionally with `pack.json`). Both use the same extensions, so
 * "Install from File" has to look inside before it can route the file.
 *
 * Reads only the archive's central directory - no entry is decompressed.
 */
import { FEATURE_PACK_MANIFEST_FILENAME } from '@bible/core';
import { PACK_MANIFEST_FILENAME } from './ModulePackSignature';

type UnzipperOpenType = typeof import('unzipper').Open;
async function unzipperOpen(): Promise<UnzipperOpenType> {
  return (await import('unzipper')).Open;
}

/**
 * Whether the entry names describe a feature pack: `feature-pack.json` at the
 * root (or inside one wrapping folder, which `SemanticPackService` also
 * accepts) and no module-pack `pack.json` beside it.
 */
export function entriesDescribeFeaturePack(entryPaths: readonly string[]): boolean {
  const names = entryPaths.map((p) => p.replace(/\\/g, '/').replace(/^\.\//, ''));
  const atShallowDepth = (file: string): boolean =>
    names.some((n) => n === file || (n.endsWith(`/${file}`) && n.split('/').length === 2));
  return atShallowDepth(FEATURE_PACK_MANIFEST_FILENAME) && !atShallowDepth(PACK_MANIFEST_FILENAME);
}

/** `false` for anything that cannot be read as a zip; the module-pack path then reports why. */
export async function isFeaturePackArchive(archivePath: string): Promise<boolean> {
  try {
    const directory = await (await unzipperOpen()).file(archivePath);
    return entriesDescribeFeaturePack(directory.files.filter((f) => f.type === 'File').map((f) => f.path));
  } catch {
    return false;
  }
}
