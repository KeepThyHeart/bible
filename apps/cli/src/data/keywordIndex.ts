/**
 * Keyword search over v0.2 modules.
 *
 * A v0.2 module ships no FTS5 table; its keyword index is a sidecar `.kwi` file
 * per module revision, owned by core's `SidecarFts5Provider`, and core finds it
 * through whatever provider the app's composition root configured. Without one
 * every keyword search silently returns nothing. This is the CLI's composition
 * root for that: one provider, an index directory next to the modules, and a
 * build of whatever index the module in use is missing.
 *
 * Where the directory is: beside a `modules` folder the CLI or a checkout owns
 * (`<BIBLE_HOME>/keyword-index`, `<repo>/data/keyword-index`, the layout the web
 * server uses), else `<BIBLE_HOME or ~/.bible>/keyword-index`. The desktop app's own
 * module folders are never written to: it keeps its indexes under its user data
 * folder in a layout of its own, and may be running.
 */
import { existsSync, mkdirSync, accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import {
  SidecarFts5Provider,
  configureModuleKeywordIndex,
  ensureModuleKeywordIndexes,
} from '@bible/core';

import { BunSql } from './BunSql';
import type { DiscoveredModule } from './modules';

/** The directory holding the `.kwi` files for `module`. */
export function keywordIndexDirFor(
  module: Pick<DiscoveredModule, 'path'> & { readonly root: Pick<DiscoveredModule['root'], 'kind'> },
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const ownsFolder = module.root.kind === 'repo' || module.root.kind === 'cli' || module.root.kind === 'override';
  const modulesDir = dirname(module.path);
  if (ownsFolder && basename(modulesDir) === 'modules') {
    const beside = join(dirname(modulesDir), 'keyword-index');
    if (existsSync(beside) || isWritableDir(dirname(modulesDir))) return beside;
  }
  return join(env.BIBLE_HOME ?? join(homedir(), '.bible'), 'keyword-index');
}

function isWritableDir(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

let configuredDir: string | undefined;
let provider: SidecarFts5Provider | undefined;

/**
 * Make sure the module at the module can be keyword-searched: configure the
 * sidecar provider (once per index directory) and build this module's index if
 * it is missing or stale. Cheap when the index is current. Never throws: a
 * failure leaves search returning no results for that module, which core logs.
 * Resolves to whether the index is usable (nothing failed), so a caller can tell
 * an index problem from a query the index cannot answer.
 */
export async function ensureKeywordIndex(module: Pick<DiscoveredModule, 'path'> & { readonly root: Pick<DiscoveredModule['root'], 'kind'> }): Promise<boolean> {
  const modulePath = module.path;
  try {
    const dir = keywordIndexDirFor(module);
    if (provider === undefined || configuredDir !== dir) {
      mkdirSync(dir, { recursive: true });
      provider = new SidecarFts5Provider({
        indexDir: dir,
        openDatabase: (path, opts) =>
          new BunSql(path, { readonly: opts.readonly, create: opts.create, pragmas: false }),
      });
      configuredDir = dir;
      configureModuleKeywordIndex(provider);
    }
    const result = await ensureModuleKeywordIndexes({
      provider,
      modulePaths: [modulePath],
      openModule: (path) => new BunSql(path, { readonly: true }),
    });
    return result.failed.length === 0;
  } catch {
    // See above: search degrades, it does not crash the reader.
    return false;
  }
}
