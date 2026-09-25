/**
 * Schema <-> validator parity.
 *
 * `ExtensionManifestSchema.json` is an authoring aid only (IDE autocomplete);
 * `ExtensionManifestValidator.ts` is the sole runtime gate - see the schema's
 * own top-level `description` and `ExtensionManifestValidator.ts`'s header
 * doc comment. Nothing keeps the two in sync automatically, and that exact
 * gap is what produced the pre-round-3 `contributes.bibleProviders` bug
 * (task 0024, round 3, P2.13 §3 / §6): the schema declared the field, the
 * validator's allow-list did not, so an author who followed the published
 * schema got a hard rejection at load.
 *
 * This test makes that class of divergence a hard failure instead of a
 * silent authoring trap, for both places the two lists must agree:
 * `contributes.*` keys and the `Permission` enum.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import {
  ALLOWED_CONTRIBUTES_KEYS,
  ALLOWED_PERMISSIONS,
} from './ExtensionManifestValidator';

interface JsonSchemaLike {
  properties: {
    contributes?: { properties?: Record<string, unknown> };
    permissions?: { items?: { $ref?: string } };
  };
  definitions: Record<string, { enum?: string[] }>;
}

function loadSchema(): JsonSchemaLike {
  const raw = readFileSync(
    join(__dirname, 'ExtensionManifestSchema.json'),
    'utf8',
  );
  return JSON.parse(raw) as JsonSchemaLike;
}

describe('ExtensionManifestSchema.json <-> ExtensionManifestValidator.ts parity', () => {
  it('contributes.* keys match ALLOWED_CONTRIBUTES_KEYS exactly', () => {
    const schema = loadSchema();
    const schemaKeys = new Set(
      Object.keys(schema.properties.contributes?.properties ?? {}),
    );
    expect([...schemaKeys].sort()).toEqual([...ALLOWED_CONTRIBUTES_KEYS].sort());
  });

  it('the Permission enum matches ALLOWED_PERMISSIONS exactly', () => {
    const schema = loadSchema();
    const permissionEnum = schema.definitions.Permission?.enum;
    expect(permissionEnum).toBeDefined();
    expect([...(permissionEnum ?? [])].sort()).toEqual(
      [...ALLOWED_PERMISSIONS].sort(),
    );
  });
});
