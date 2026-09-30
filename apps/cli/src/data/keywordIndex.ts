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
 * Where the directory is, in order: `<data>/keyword-index` beside a
 * `<data>/modules` folder (the layout the desktop and web apps use, so an index
 * they already built is reused), else `<BIBLE_HOME or ~/.bible>/keyword-index`
 * when that place is not writable or is not laid out that way.
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

/** The directory holding the `.kwi` files for a module file at `modulePath`. */
export function keywordIndexDirFor(
  modulePath: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const modulesDir = dirname(modulePath);
  if (basename(modulesDir) === 'modules') {
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
 * Make sure the module at `modulePath` can be keyword-searched: configure the
 * sidecar provider (once per index directory) and build this module's index if
 * it is missing or stale. Cheap when the index is current. Never throws: a
 * failure leaves search returning no results for that module, which core logs.
 */
export async function ensureKeywordIndex(modulePath: string): Promise<void> {
  try {
    const dir = keywordIndexDirFor(modulePath);
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
    await ensureModuleKeywordIndexes({
      provider,
      modulePaths: [modulePath],
      openModule: (path) => new BunSql(path, { readonly: true }),
    });
  } catch {
    // See above: search degrades, it does not crash the reader.
  }
}
