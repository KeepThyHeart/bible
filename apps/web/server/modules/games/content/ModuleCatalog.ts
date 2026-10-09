/**
 * The set of Bible modules installed on this server.
 *
 * A module is discovered by opening it and reading its own metadata, never by
 * parsing its filename. `kjv.db`, `bible_kjv.db` and `downloaded (1).db` are
 * all the same translation to a host, because the abbreviation comes from
 * inside the file — and a file that turns out not to be a Bible module is
 * skipped with a recorded reason rather than taking the server down with it.
 *
 * Modules stay open for the life of the catalog. They are read only and their
 * value is in the prepared statements they hold, so closing and reopening one
 * per round would throw away the only thing that makes a draw cheap.
 */

import { readdirSync, statSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { join } from 'node:path';
import { BibleModule } from './BibleModule.js';
import type { ModuleInfo, VerseSource } from './BibleModule.js';

/** What a host sees when picking a translation. */
export interface TranslationSummary extends ModuleInfo {
  path: string;
  verseCount: number;
}

export interface SkippedModule {
  path: string;
  reason: string;
}

/**
 * SQLite's own sidecars. They are not modules and opening one is guaranteed
 * noise, so they are filtered before the probe rather than after it.
 */
const SIDECAR_SUFFIXES = ['-shm', '-wal', '-journal'];

/** A set of translations the games can draw from. */
export interface TranslationCatalog {
  list(): TranslationSummary[];
  get(abbreviation: string): VerseSource | null;
  has(abbreviation: string): boolean;
  closeAll(): void;
}

export class ModuleCatalog implements TranslationCatalog {
  private readonly modules = new Map<string, BibleModule>();

  /** Files in the directory that were not usable, and why. */
  readonly skipped: readonly SkippedModule[];

  private constructor(modules: Map<string, BibleModule>, skipped: SkippedModule[]) {
    this.modules = modules;
    this.skipped = skipped;
  }

  /**
   * Scans a directory. A missing directory is an empty catalog, not a crash:
   * a fresh checkout has no modules installed and the server should still boot
   * far enough to say so.
   */
  static discover(directory: string): ModuleCatalog {
    const modules = new Map<string, BibleModule>();
    const skipped: SkippedModule[] = [];

    for (const path of candidateFiles(directory)) {
      const opened = probe(path);
      if (!opened.module) {
        skipped.push({ path, reason: opened.reason });
        continue;
      }
      const key = opened.module.info.abbreviation.toUpperCase();
      const incumbent = modules.get(key);
      if (incumbent) {
        // Two files claiming one abbreviation is a packaging accident, not a
        // choice a host should have to make mid-game. First wins, loudly.
        skipped.push({ path, reason: `${key} already provided by ${incumbent.path}` });
        opened.module.close();
        continue;
      }
      modules.set(key, opened.module);
    }

    return new ModuleCatalog(modules, skipped);
  }

  /** Builds a catalog over already-open modules. Used by tests and by tooling. */
  static of(modules: readonly BibleModule[]): ModuleCatalog {
    const map = new Map<string, BibleModule>();
    for (const module of modules) map.set(module.info.abbreviation.toUpperCase(), module);
    return new ModuleCatalog(map, []);
  }

  /** Translations a host may pick, sorted by abbreviation. */
  list(): TranslationSummary[] {
    return [...this.modules.values()]
      .map((module) => ({
        ...module.info,
        path: module.path,
        verseCount: module.verseCount(),
      }))
      .sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));
  }

  /** Case-insensitive: a host typing `kjv` means `KJV`. */
  get(abbreviation: string): BibleModule | null {
    return this.modules.get(abbreviation.toUpperCase()) ?? null;
  }

  has(abbreviation: string): boolean {
    return this.modules.has(abbreviation.toUpperCase());
  }

  get size(): number {
    return this.modules.size;
  }

  closeAll(): void {
    for (const module of this.modules.values()) module.close();
    this.modules.clear();
  }
}

function candidateFiles(directory: string): string[] {
  if (!isDirectory(directory)) return [];
  return readdirSync(directory)
    .filter((name) => !name.startsWith('.'))
    .filter((name) => !SIDECAR_SUFFIXES.some((suffix) => name.endsWith(suffix)))
    .map((name) => join(directory, name))
    .filter((path) => isFile(path))
    .sort();
}

interface ProbeResult {
  module: BibleModule | null;
  reason: string;
}

/**
 * The one place a broad catch is right: every file in the directory is
 * untrusted input, and "this is not a Bible module" arrives as an exception
 * from SQLite for reasons ranging from a text file to a truncated download.
 * The alternative is a server that refuses to start because somebody left a
 * README in the modules folder.
 */
function probe(path: string): ProbeResult {
  try {
    return { module: BibleModule.open(path), reason: '' };
  } catch (error) {
    return { module: null, reason: error instanceof Error ? error.message : String(error) };
  }
}

function isDirectory(path: string): boolean {
  return statOrNull(path)?.isDirectory() ?? false;
}

function isFile(path: string): boolean {
  return statOrNull(path)?.isFile() ?? false;
}

/**
 * A path can vanish between the listing and the stat, and the directory itself
 * need not exist at all; neither is an error worth a catch, which is what
 * `throwIfNoEntry` buys. Anything else — an unreadable mount, say — is a real
 * problem and still travels.
 */
function statOrNull(path: string): Stats | undefined {
  return statSync(path, { throwIfNoEntry: false });
}
