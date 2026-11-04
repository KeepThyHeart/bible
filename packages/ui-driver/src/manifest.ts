/**
 * Manifest loading and ${var} expansion. Pure (no playwright), so it is cheap to test.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import type { Manifest } from './types.ts';

/** Where the manifest for `app` lives: a name, a path to a .json, or the default `web`. */
export function resolveManifestPath(app: string | undefined, repoRoot: string): string {
  const name = app ?? 'web';
  const file = name.endsWith('.json') || /[\\/]/.test(name)
    ? path.resolve(name)
    : `${repoRoot}/apps/${name}/driver.manifest.json`;
  if (!existsSync(file)) throw new Error(`no manifest for '${name}' (looked at ${file})`);
  return file;
}

function fail(file: string, field: string, what: string): never {
  throw new Error(`manifest ${file}: ${field} ${what}`);
}

/** Parse and validate; one-line errors that name the field. */
export function loadManifest(file: string): Manifest {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`manifest ${file}: ${(e as Error).message.split('\n')[0]}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail(file, 'root', 'must be an object');
  // Shape is checked field by field below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = raw as Record<string, any>;
  if (typeof m.app !== 'string' || !m.app) fail(file, 'app', 'must be a non-empty string');
  if (m.kind !== 'web' && m.kind !== 'electron') fail(file, 'kind', "must be 'web' or 'electron'");
  if (m.kind === 'web') {
    if (typeof m.server !== 'object' || m.server === null) fail(file, 'server', 'is required for kind web');
    if (typeof m.server.command !== 'string') fail(file, 'server.command', 'must be a string');
    if (typeof m.server.url !== 'string') fail(file, 'server.url', 'must be a string');
    if (typeof m.server.ready?.url !== 'string') fail(file, 'server.ready.url', 'must be a string');
  } else {
    if (typeof m.electron?.main !== 'string') fail(file, 'electron.main', 'must be a string');
  }
  if (m.prepare !== undefined && typeof m.prepare?.command !== 'string') fail(file, 'prepare.command', 'must be a string');
  if (m.build !== undefined && (!Array.isArray(m.build.requires) || typeof m.build.hint !== 'string')) {
    fail(file, 'build', 'needs requires[] and hint');
  }
  if (m.external !== undefined && !Array.isArray(m.external.allow)) fail(file, 'external.allow', 'must be an array');
  return m as unknown as Manifest;
}

/** Replace ${name} (including dotted ones like ${prepare.dataDir}); an unknown name throws. */
export function expand(str: string, vars: Record<string, string>): string {
  return str.replace(/\$\{([^}]+)\}/g, (_m, name: string) => {
    if (!Object.hasOwn(vars, name)) throw new Error(`unknown variable \${${name}}`);
    return vars[name];
  });
}

export function expandDeep<T>(value: T, vars: Record<string, string>): T {
  if (typeof value === 'string') return expand(value, vars) as T;
  if (Array.isArray(value)) return value.map(v => expandDeep(v, vars)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expandDeep(v, vars)])) as T;
  }
  return value;
}

/** A message when the build the app needs is missing, else null. */
export function missingBuild(manifest: Manifest, manifestDir: string): string | null {
  if (!manifest.build) return null;
  for (const rel of manifest.build.requires) {
    if (!existsSync(path.join(manifestDir, rel))) {
      const shown = path.relative(process.cwd(), path.join(manifestDir, rel)) || rel;
      return `not built: ${shown} missing. Run: ${manifest.build.hint}`;
    }
  }
  return null;
}

/** A currently free TCP port on loopback. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}
