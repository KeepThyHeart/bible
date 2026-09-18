/**
 * Module discovery.
 *
 * Three decisions shape this file:
 *
 * **Scan files; never read the desktop's `main.db`.** Every module carries its
 * own `module_info` and `schema_version`, so scanning is self-describing. It
 * also works for a file the user simply dropped into a folder, and it avoids
 * opening a database another application is actively writing.
 *
 * **Probe for the desktop; never hardcode its folder name.** The packaged
 * desktop's `userData` folder is named after `productName`
 * (`electron-builder.branding.cjs`), which `BIBLE_PRODUCT_NAME` overrides at
 * build time. What reliably identifies the install is the *shape*: a directory
 * containing `data/modules/*.db`. That survives a rename.
 *
 * **`immutable=1` is per tree, not global.** The bundled tree is never written,
 * so ignoring its WAL sidecar is safe and necessary (its directory is often
 * read-only). The user tree may be written by the desktop app right now, and an
 * immutable connection there could read torn pages.
 */
import { readdirSync, statSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

import { BunSql } from './BunSql';

/** Module types, as the filename prefix spells them. Lifted from `moduleDetector.ts`. */
export type ModuleType =
  | 'bible'
  | 'commentary'
  | 'dictionary'
  | 'book'
  | 'devotional'
  | 'lexicon'
  | 'topical_index'
  | 'cross_reference'
  | 'tag_graph';

const PREFIX_TO_TYPE: Readonly<Record<string, ModuleType>> = {
  bible: 'bible',
  commentary: 'commentary',
  dictionary: 'dictionary',
  book: 'book',
  devotional: 'devotional',
  lexicon: 'lexicon',
  topical: 'topical_index',
  xref: 'cross_reference',
};

/**
 * The highest module format major version this build understands. A module
 * declaring a higher one is listed but marked unsupported rather than opened
 * and crashed on.
 */
export const MAX_SCHEMA_MAJOR = 2;

/** Seed for the desktop probe. Only a hint — the probe does not depend on it. */
const BRANDED_PRODUCT_NAME = 'Keep Thy Heart Bible Reader';

export type RootKind =
  | 'override' // $BIBLE_HOME
  | 'cli' // ~/.bible/modules — the only one we write to
  | 'desktop-user'
  | 'desktop-bundled'
  | 'repo';

export interface ModuleRoot {
  readonly path: string;
  readonly kind: RootKind;
  /** Whether modules here must be opened with `immutable=1`. */
  readonly immutable: boolean;
}

export interface DiscoveredModule {
  readonly path: string;
  readonly root: ModuleRoot;
  readonly type: ModuleType | 'unknown';
  readonly abbreviation: string;
  readonly fullName: string;
  readonly language: string;
  readonly contentSha256: string | undefined;
  readonly schemaVersion: string | undefined;
  readonly textDirection: string | undefined;
  /** Set when the module cannot be used. The modules screen dims the row. */
  readonly unsupported: string | undefined;
}

/** Injected so discovery can be tested without a filesystem. */
export interface DiscoveryEnv {
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly home: string;
  readonly cwd: string;
  exists(path: string): boolean;
  isDirectory(path: string): boolean;
  listDir(path: string): string[];
}

export function defaultDiscoveryEnv(): DiscoveryEnv {
  return {
    platform: process.platform,
    env: process.env,
    home: homedir(),
    cwd: process.cwd(),
    exists: (path) => existsSync(path),
    isDirectory: (path) => {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    },
    listDir: (path) => {
      try {
        return readdirSync(path);
      } catch {
        return [];
      }
    },
  };
}

/** The CLI's own directory — the only place it ever writes. */
export function bibleHome(env: DiscoveryEnv): string {
  return env.env.BIBLE_HOME ?? join(env.home, '.bible');
}

/**
 * The five module roots, in priority order. Only those that exist are
 * returned, so the caller never has to filter.
 */
export function moduleRoots(env: DiscoveryEnv): ModuleRoot[] {
  const candidates: ModuleRoot[] = [];

  const explicit = env.env.BIBLE_HOME;
  if (explicit) {
    candidates.push({ path: join(explicit, 'modules'), kind: 'override', immutable: false });
  }

  candidates.push({ path: join(env.home, '.bible', 'modules'), kind: 'cli', immutable: false });

  for (const path of desktopUserRoots(env)) {
    // The desktop may be running and writing here, so never immutable.
    candidates.push({ path, kind: 'desktop-user', immutable: false });
  }

  for (const path of desktopBundledRoots(env)) {
    // Nothing ever writes here, and the directory is frequently read-only,
    // which is exactly the case `immutable=1` exists for.
    candidates.push({ path, kind: 'desktop-bundled', immutable: true });
  }

  const repo = repoRoot(env);
  if (repo) candidates.push({ path: repo, kind: 'repo', immutable: false });

  const seen = new Set<string>();
  return candidates.filter((root) => {
    const key = root.path.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return env.isDirectory(root.path);
  });
}

/** Platform appData root, where the desktop's `userData` folder lives. */
export function appDataRoot(env: DiscoveryEnv): string | undefined {
  if (env.platform === 'win32') return env.env.APPDATA;
  if (env.platform === 'darwin') return join(env.home, 'Library', 'Application Support');
  return env.env.XDG_CONFIG_HOME ?? join(env.home, '.config');
}

/**
 * Any child of appData that *looks like* the desktop install — that is, one
 * containing `data/modules` with at least one `.db` in it (the desktop's
 * `getUserModulesPath()` is `<userData>/data/modules`).
 *
 * The branded name is tried first so the common case costs one `stat`, but it
 * is only a hint: the scan is what actually finds the install, and it keeps
 * working after a rename.
 */
function desktopUserRoots(env: DiscoveryEnv): string[] {
  const root = appDataRoot(env);
  if (!root || !env.isDirectory(root)) return [];

  const found: string[] = [];
  const consider = (...segments: string[]): void => {
    const modules = join(root, ...segments, 'data', 'modules');
    if (!found.includes(modules) && hasModuleFiles(env, modules)) found.push(modules);
  };

  consider(BRANDED_PRODUCT_NAME);
  for (const name of env.listDir(root)) {
    consider(name);
  }

  return found;
}

/**
 * Where an installed desktop keeps its shipped modules, per platform:
 * `resources/data/modules` under the install directory (electron-builder's
 * `extraResources` puts `data/` in `process.resourcesPath`).
 */
function desktopBundledRoots(env: DiscoveryEnv): string[] {
  const parents: string[] = [];

  if (env.platform === 'win32') {
    const local = env.env.LOCALAPPDATA;
    if (local) parents.push(join(local, 'Programs'));
    if (env.env.ProgramFiles) parents.push(env.env.ProgramFiles);
  } else if (env.platform === 'darwin') {
    parents.push('/Applications', join(env.home, 'Applications'));
  } else {
    parents.push('/opt', '/usr/lib', join(env.home, '.local', 'share'));
  }

  const suffixes =
    env.platform === 'darwin'
      ? [join('Contents', 'Resources', 'data', 'modules')]
      : [join('resources', 'data', 'modules')];

  const found: string[] = [];
  for (const parent of parents) {
    if (!env.isDirectory(parent)) continue;
    for (const name of env.listDir(parent)) {
      for (const suffix of suffixes) {
        const path = join(parent, name, suffix);
        if (!found.includes(path) && hasModuleFiles(env, path)) found.push(path);
      }
    }
  }
  return found;
}

/**
 * `<repo>/data/modules`, when running from a checkout. A directory counts as
 * the repo root when it holds `apps/desktop` next to `data/modules`, so an
 * unrelated `data/modules` further up the tree is never picked up.
 *
 * Resolved by walking up from the working directory, not from
 * `import.meta.dir`: inside a compiled executable that points into the embedded
 * virtual filesystem and would never find the repository — established when the
 * single-file build was first proved out.
 */
function repoRoot(env: DiscoveryEnv): string | undefined {
  let dir = env.cwd;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(dir, 'data', 'modules');
    if (env.isDirectory(join(dir, 'apps', 'desktop')) && hasModuleFiles(env, candidate)) {
      return candidate;
    }

    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function hasModuleFiles(env: DiscoveryEnv, path: string): boolean {
  if (!env.isDirectory(path)) return false;
  return env.listDir(path).some((name) => name.endsWith('.db'));
}

export function moduleTypeFromFilename(filename: string): ModuleType | 'unknown' {
  // `tag_graph.db` carries no abbreviation segment, so match it before splitting.
  if (filename.startsWith('tag_graph')) return 'tag_graph';
  const prefix = filename.split('_')[0] ?? '';
  return PREFIX_TO_TYPE[prefix] ?? 'unknown';
}

/** Opening a module is injected so discovery can be tested without real files. */
export type ModuleReader = (path: string, immutable: boolean) => ModuleDescriptor | undefined;

export interface ModuleDescriptor {
  readonly abbreviation?: string;
  readonly fullName?: string;
  readonly language?: string;
  readonly contentSha256?: string;
  readonly schemaVersion?: string;
  readonly textDirection?: string;
  readonly moduleType?: string;
}

/**
 * Read a module's self-description.
 *
 * Returns `undefined` rather than throwing for a file that is not a module at
 * all — a stray `.db`, a partial download — because one bad file in a directory
 * must not stop the other modules from being found.
 */
export function readModuleDescriptor(path: string, immutable: boolean): ModuleDescriptor | undefined {
  let sql: BunSql | undefined;
  try {
    sql = new BunSql(path, { readonly: true, immutable });

    // `SELECT *`, deliberately, and this is the one place in the CLI where it is
    // the right call. `module_info` does not have the same columns in every
    // module type: `text_direction` and `is_original_language` exist only in
    // `bible_*`. Naming `text_direction` in the column list made this query
    // throw for every commentary, dictionary, topical index, book, devotional
    // and cross-reference module on disk — and the `catch` below turned that
    // into "not a module", so `discoverModules()` returned 55 Bibles and
    // nothing else. The study chain had no data at all and nothing said so.
    // Asking for the row and picking fields off it cannot fail that way.
    const info = sql.queryOne<Record<string, unknown>>('SELECT * FROM module_info LIMIT 1');
    if (!info) return undefined;

    const text = (column: string): string | undefined => {
      const value = info[column];
      return typeof value === 'string' && value !== '' ? value : undefined;
    };

    // Guarded separately, and for the same reason `SELECT *` is used above:
    // `schema_version` is a v2 table, and the v1 modules still on disk — the
    // topical indexes among them — do not have it. Letting that throw into the
    // outer `catch` reported a perfectly readable module as "not a module".
    // `isSupportedSchema(undefined)` already treats an absent version as "an
    // early module; try it", so an absent table must reach it, not bypass it.
    let schemaVersion: string | undefined;
    try {
      const schema = sql.queryOne<{ version_number: string | null }>(
        'SELECT version_number FROM schema_version ORDER BY version_id DESC LIMIT 1',
      );
      schemaVersion = schema?.version_number ?? undefined;
    } catch {
      schemaVersion = undefined;
    }

    return {
      abbreviation: text('abbreviation'),
      fullName: text('full_name'),
      language: text('language_code'),
      contentSha256: text('content_sha256'),
      textDirection: text('text_direction'),
      moduleType: text('module_type'),
      schemaVersion,
    };
  } catch {
    return undefined;
  } finally {
    sql?.close();
  }
}

/** True when a module's declared schema is newer than this build understands. */
export function isSupportedSchema(version: string | undefined): boolean {
  if (!version) return true; // absent means an early module; try it
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  if (Number.isNaN(major)) return true;
  return major <= MAX_SCHEMA_MAJOR;
}

export interface DiscoverOptions {
  readonly env?: DiscoveryEnv;
  readonly read?: ModuleReader;
  /** Restrict to these roots instead of resolving them. */
  readonly roots?: readonly ModuleRoot[];
}

/**
 * Every module across every root, de-duplicated.
 *
 * Duplicates collapse on `abbreviation` + `content_sha256` and the *earlier
 * root wins*, so a module the user placed in `~/.bible/modules` shadows the
 * desktop's copy of the same content.
 */
export function discoverModules(options: DiscoverOptions = {}): DiscoveredModule[] {
  const env = options.env ?? defaultDiscoveryEnv();
  const read = options.read ?? readModuleDescriptor;
  const roots = options.roots ?? moduleRoots(env);

  const modules: DiscoveredModule[] = [];
  const seen = new Set<string>();

  for (const root of roots) {
    for (const name of env.listDir(root.path).sort()) {
      if (!name.endsWith('.db')) continue;

      const path = join(root.path, name);
      const descriptor = read(path, root.immutable);
      if (!descriptor) {
        // Reported, not skipped. A `.db` sitting in a module directory that
        // cannot be read is exactly what the modules screen exists to explain —
        // a partial download, a file from a newer build, something that is not
        // a module at all. Dropping it silently would leave the user looking for
        // a translation that is right there on disk with nothing to tell them
        // why it is not in the list. It is deliberately not de-duplicated: without a
        // descriptor there is no abbreviation and no hash to compare.
        modules.push({
          path,
          root,
          type: moduleTypeFromFilename(name),
          abbreviation: basename(name, '.db'),
          fullName: basename(name, '.db'),
          language: '',
          contentSha256: undefined,
          schemaVersion: undefined,
          textDirection: undefined,
          unsupported: 'not a module file, or unreadable',
        });
        continue;
      }

      const abbreviation = descriptor.abbreviation ?? basename(name, '.db');
      const key = `${abbreviation.toLowerCase()}\u0000${descriptor.contentSha256 ?? path.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const supported = isSupportedSchema(descriptor.schemaVersion);

      modules.push({
        path,
        root,
        type: moduleTypeFromFilename(name),
        abbreviation,
        fullName: descriptor.fullName ?? abbreviation,
        language: descriptor.language ?? 'en',
        contentSha256: descriptor.contentSha256,
        schemaVersion: descriptor.schemaVersion,
        textDirection: descriptor.textDirection,
        unsupported: supported
          ? undefined
          : `module format ${descriptor.schemaVersion} is newer than this build supports (max ${MAX_SCHEMA_MAJOR}.x)`,
      });
    }
  }

  return modules;
}

/**
 * Open a discovered module for reading, with the right immutability for the
 * tree it came from.
 */
export function openModule(module: DiscoveredModule): BunSql {
  if (module.unsupported) {
    throw new Error(`${module.abbreviation}: ${module.unsupported}`);
  }
  return new BunSql(module.path, { readonly: true, immutable: module.root.immutable });
}
