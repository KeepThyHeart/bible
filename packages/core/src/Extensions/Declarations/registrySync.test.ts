/**
 * Keeps the generated artefacts in step with the declarations, and enforces
 * the `EXTENSION_API_VERSION` bump rule (see that constant's doc comment).
 *
 *   - `ExtensionManifestSchema.json` (the editor authoring aid): its
 *     `Permission` enum must list every declared permission, and every
 *     declared `contributes` key that carries a `jsonSchema` must appear under
 *     `contributes.properties` with exactly that schema.
 *   - `apiSurface.lock.json`: the declared surface (namespaces, methods and
 *     their gates, permissions and grant policies, activation events,
 *     `contributes` keys, event channels) recorded together with the version.
 *     A surface change without a version bump fails here.
 *
 * Both are rewritten, rather than checked, when the test runs with
 * `UPDATE_EXTENSION_API=1`:
 *
 *     UPDATE_EXTENSION_API=1 pnpm --filter @bible/core exec vitest run \
 *       src/Extensions/Declarations/registrySync.test.ts
 *
 * The update refuses to record a changed surface under an unchanged version,
 * so it cannot be used to skip the bump.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import { EXTENSION_API_VERSION } from '../ExtensionApiTypes';
import type { MethodGate } from './defineApiNamespace';
import { EXTENSION_API_REGISTRY, type ApiRegistry } from './registry';

const UPDATE = process.env.UPDATE_EXTENSION_API === '1';
const SCHEMA_PATH = join(__dirname, '..', 'ExtensionManifestSchema.json');
const LOCK_PATH = join(__dirname, 'apiSurface.lock.json');

const UPDATE_HINT =
  'run: UPDATE_EXTENSION_API=1 pnpm --filter @bible/core exec vitest run src/Extensions/Declarations/registrySync.test.ts';

function gateString(gate: MethodGate): string {
  if (gate === null) return 'open';
  if (typeof gate === 'string') return gate;
  if ('anyOf' in gate) return `anyOf:${gate.anyOf.join('|')}`;
  return 'impl';
}

/** The declared surface, canonical and order-stable (sorted where order is not meaningful). */
function apiSurface(registry: ApiRegistry): unknown {
  const byKey = <T>(xs: T[], key: (x: T) => string): T[] => [...xs].sort((a, b) => key(a).localeCompare(key(b)));
  return {
    namespaces: byKey([...registry.namespaces], (d) => d.name).map((d) => ({
      name: d.name,
      since: d.since,
      optional: d.optional,
      whenGranted: d.availability?.whenGranted ?? null,
      methods: Object.fromEntries(
        Object.entries(d.methods as Record<string, { permission: MethodGate; local?: boolean }>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([m, decl]) => [m, `${gateString(decl.permission)}${decl.local ? ' (local)' : ''}`]),
      ),
      wire: Object.fromEntries(
        Object.entries(d.wire ?? {})
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([m, w]) => [m, gateString(w.permission)]),
      ),
    })),
    permissions: byKey([...registry.permissions], (p) => p.id).map((p) => `${p.id} ${p.grant} ${p.since}`),
    activationEvents: byKey([...registry.activationEvents], (e) => e.event).map(
      (e) => `${e.event}${e.fired ? ' fired' : ''} ${e.since}`,
    ),
    contributes: byKey([...registry.contributesKeys], (c) => c.key).map(
      (c) => `${c.key}${c.requiresPermission ? ` requires ${c.requiresPermission}` : ''} ${c.since}`,
    ),
    events: byKey([...registry.eventChannels], (e) => e.channel).map(
      (e) => `${e.channel} ${e.kind} ${e.permission ?? 'open'} ${e.since}`,
    ),
  };
}

function parseVersion(v: string): [number, number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error(`not a x.y.z version: ${v}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
  return 0;
}

// --- JSON text surgery ------------------------------------------------------
// The schema file is hand-formatted; rewriting all of it with JSON.stringify
// would reformat every line. Only the block that actually changed is
// re-serialised, at its original indentation.

/** [start, end) of the object value of the first `"key": {` in `text`. */
function objectSpan(text: string, key: string): [number, number] {
  const at = text.indexOf(`"${key}": {`);
  if (at < 0) throw new Error(`"${key}" block not found`);
  const start = text.indexOf('{', at);
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return [start, i + 1];
    }
  }
  throw new Error(`"${key}" block is unbalanced`);
}

function replaceObject(text: string, key: string, value: unknown): string {
  const [start, end] = objectSpan(text, key);
  const lineStart = text.lastIndexOf('\n', start) + 1;
  const indent = /^\s*/.exec(text.slice(lineStart))![0];
  const json = JSON.stringify(value, null, 2).replace(/\n/g, `\n${indent}`);
  return text.slice(0, start) + json + text.slice(end);
}

// --- Tests -------------------------------------------------------------------

interface Schema {
  definitions: { Permission: { enum: string[] } & Record<string, unknown> };
  properties: { contributes: { properties: Record<string, unknown> } & Record<string, unknown> };
}

describe('declaration registry sync', () => {
  it('every `since` is at most EXTENSION_API_VERSION', () => {
    const tooNew: string[] = [];
    const check = (what: string, since: string): void => {
      if (compareVersions(since, EXTENSION_API_VERSION) > 0) tooNew.push(`${what} (${since})`);
    };
    for (const d of EXTENSION_API_REGISTRY.namespaces) {
      check(`namespace ${d.name}`, d.since);
      for (const [m, decl] of Object.entries(d.methods as Record<string, { since?: string }>)) {
        if (decl.since) check(`${d.name}.${m}`, decl.since);
      }
    }
    for (const p of EXTENSION_API_REGISTRY.permissions) check(`permission ${p.id}`, p.since);
    for (const e of EXTENSION_API_REGISTRY.activationEvents) check(`activation event ${e.event}`, e.since);
    for (const c of EXTENSION_API_REGISTRY.contributesKeys) check(`contributes.${c.key}`, c.since);
    for (const e of EXTENSION_API_REGISTRY.eventChannels) check(`event ${e.channel}`, e.since);
    expect(tooNew, `declared after the current EXTENSION_API_VERSION ${EXTENSION_API_VERSION} - bump it`).toEqual([]);
  });

  it('ExtensionManifestSchema.json lists the declared permissions and contributes schemas', () => {
    const text = readFileSync(SCHEMA_PATH, 'utf8');
    const schema = JSON.parse(text) as Schema;
    const declaredPerms = [...EXTENSION_API_REGISTRY.permissionIds];
    const permsMatch =
      [...schema.definitions.Permission.enum].sort().join() === [...declaredPerms].sort().join();

    const contributes = { ...schema.properties.contributes.properties };
    let contributesMatch = true;
    for (const key of EXTENSION_API_REGISTRY.contributesKeys) {
      if (!key.jsonSchema) continue;
      if (JSON.stringify(contributes[key.key]) !== JSON.stringify(key.jsonSchema)) {
        contributesMatch = false;
        contributes[key.key] = key.jsonSchema;
      }
    }

    if (UPDATE) {
      let next = text;
      if (!permsMatch) {
        next = replaceObject(next, 'Permission', { ...schema.definitions.Permission, enum: declaredPerms });
      }
      if (!contributesMatch) {
        next = replaceObject(next, 'contributes', { ...schema.properties.contributes, properties: contributes });
      }
      if (next !== text) writeFileSync(SCHEMA_PATH, next);
      return;
    }
    expect(permsMatch, `schema Permission enum is out of date; ${UPDATE_HINT}`).toBe(true);
    expect(contributesMatch, `schema contributes properties are out of date; ${UPDATE_HINT}`).toBe(true);
  });

  it('apiSurface.lock.json records the declared surface under the current version', () => {
    const surface = apiSurface(EXTENSION_API_REGISTRY);
    let lock: { version: string; surface: unknown } | undefined;
    try {
      lock = JSON.parse(readFileSync(LOCK_PATH, 'utf8')) as { version: string; surface: unknown };
    } catch {
      lock = undefined;
    }
    const same = lock !== undefined && JSON.stringify(lock.surface) === JSON.stringify(surface);

    if (lock && !same && lock.version === EXTENSION_API_VERSION) {
      throw new Error(
        `The declared extension API surface changed but EXTENSION_API_VERSION is still ${EXTENSION_API_VERSION}. ` +
          'Bump it (additive change: patch, e.g. 0.1.0 -> 0.1.1; breaking change: minor, e.g. 0.1.x -> 0.2.0 - ' +
          `see its doc comment in ExtensionApiTypes.ts), then ${UPDATE_HINT}`,
      );
    }
    if (UPDATE) {
      if (!same || lock?.version !== EXTENSION_API_VERSION) {
        writeFileSync(LOCK_PATH, `${JSON.stringify({ version: EXTENSION_API_VERSION, surface }, null, 2)}\n`);
      }
      return;
    }
    expect(lock, `apiSurface.lock.json is missing; ${UPDATE_HINT}`).toBeDefined();
    expect(lock!.version, `EXTENSION_API_VERSION was bumped; record the surface: ${UPDATE_HINT}`).toBe(
      EXTENSION_API_VERSION,
    );
    expect(same).toBe(true);
  });
});
