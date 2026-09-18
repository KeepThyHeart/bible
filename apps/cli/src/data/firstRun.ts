/**
 * First-run extraction of the bundled KJV.
 *
 * The binary embeds a trimmed KJV so that `bible` works the moment it is
 * installed, with no download and no setup. On first run it is written to
 * `~/.bible/modules/bible_kjv.db`, and from that point it is an ordinary
 * module, indistinguishable from any other (DesignSpec §3.1).
 *
 * **Extraction is skipped when the same content is already reachable.** A user
 * who has the desktop app installed already has the full KJV — with the
 * interlinear this build dropped — and writing a second, lesser copy would
 * shadow it in the search order for no benefit. The comparison is on
 * `content_sha256`, not on filename or version string.
 *
 * The embedded file is read with `Database.deserialize`, so its identity can be
 * established without writing it anywhere first.
 */
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DiscoveredModule } from './modules';

export type FirstRunAction =
  | 'extracted'
  | 'already-extracted'
  | 'already-discoverable'
  | 'no-bundled-module';

export interface FirstRunResult {
  readonly action: FirstRunAction;
  /** Where the module is, when there is one. */
  readonly path: string | undefined;
  readonly contentSha256: string | undefined;
  /** One line, suitable for the modules screen or a `--verbose` line. */
  readonly detail: string;
}

/** Injected so the whole flow can be tested without touching a real home directory. */
export interface FirstRunHost {
  readonly modulesDir: string;
  /** The embedded module's bytes; `undefined` when this build has none. */
  readBundled(): Promise<Uint8Array | undefined>;
  exists(path: string): boolean;
  read(path: string): Uint8Array;
  write(path: string, bytes: Uint8Array): void;
}

/**
 * Read a module's `content_sha256` from bytes in memory.
 *
 * Returns `undefined` for anything that is not a module — which is exactly what
 * a placeholder asset looks like, and is how a build with no bundled Bible is
 * detected rather than assumed.
 */
export function moduleIdentity(
  bytes: Uint8Array,
): { abbreviation: string; contentSha256: string } | undefined {
  let db: Database | undefined;
  try {
    db = Database.deserialize(bytes);
    const row = db
      .query<{ abbreviation: string | null; content_sha256: string | null }, []>(
        'SELECT abbreviation, content_sha256 FROM module_info LIMIT 1',
      )
      .get();
    if (!row?.content_sha256) return undefined;
    return {
      abbreviation: row.abbreviation ?? 'KJV',
      contentSha256: row.content_sha256,
    };
  } catch {
    return undefined;
  } finally {
    db?.close();
  }
}

export interface EnsureBundledOptions {
  readonly host: FirstRunHost;
  /** What discovery already found, so an existing copy is not duplicated. */
  readonly discovered?: readonly DiscoveredModule[];
}

export async function ensureBundledKjv(options: EnsureBundledOptions): Promise<FirstRunResult> {
  const { host, discovered = [] } = options;

  const bytes = await host.readBundled();
  if (!bytes || bytes.length === 0) {
    return {
      action: 'no-bundled-module',
      path: undefined,
      contentSha256: undefined,
      detail: 'this build ships no bundled Bible',
    };
  }

  const identity = moduleIdentity(bytes);
  if (!identity) {
    return {
      action: 'no-bundled-module',
      path: undefined,
      contentSha256: undefined,
      detail: 'the embedded asset is not a module (placeholder build)',
    };
  }

  const alreadyThere = discovered.find((m) => m.contentSha256 === identity.contentSha256);
  if (alreadyThere) {
    return {
      action: 'already-discoverable',
      path: alreadyThere.path,
      contentSha256: identity.contentSha256,
      detail: `${identity.abbreviation} already available from ${alreadyThere.root.kind}`,
    };
  }

  const target = join(host.modulesDir, 'bible_kjv.db');

  if (host.exists(target)) {
    // Compare content, not existence: a half-written file from an interrupted
    // extraction, or an older build's copy, should be replaced.
    const existing = moduleIdentity(host.read(target));
    if (existing?.contentSha256 === identity.contentSha256) {
      return {
        action: 'already-extracted',
        path: target,
        contentSha256: identity.contentSha256,
        detail: `${identity.abbreviation} already extracted`,
      };
    }
  }

  host.write(target, bytes);

  return {
    action: 'extracted',
    path: target,
    contentSha256: identity.contentSha256,
    detail: `extracted ${identity.abbreviation} to ${target}`,
  };
}

/**
 * The real host: `~/.bible/modules`, and the embedded asset.
 *
 * The asset is reached by dynamic import so that a build without one still
 * runs — the import fails, and `ensureBundledKjv` reports `no-bundled-module`
 * instead of the process failing to start.
 */
export function defaultFirstRunHost(bibleHomePath: string): FirstRunHost {
  const modulesDir = join(bibleHomePath, 'modules');

  return {
    modulesDir,

    async readBundled() {
      try {
        const { BUNDLED_KJV_PATH } = await import('../assets/bundledKjv');
        const file = Bun.file(BUNDLED_KJV_PATH);
        return new Uint8Array(await file.arrayBuffer());
      } catch {
        return undefined;
      }
    },

    exists: (path) => existsSync(path),

    // Node's reader rather than Bun.file, so this stays synchronous alongside
    // the rest of the data layer.
    read: (path) => new Uint8Array(readFileSync(path)),

    write: (path, bytes) => {
      mkdirSync(modulesDir, { recursive: true });
      // Write beside the target and rename, so an interrupted extraction can
      // never leave a truncated module that later looks installed.
      const temp = `${path}.partial`;
      writeFileSync(temp, bytes);
      renameSync(temp, path);
    },
  };
}
