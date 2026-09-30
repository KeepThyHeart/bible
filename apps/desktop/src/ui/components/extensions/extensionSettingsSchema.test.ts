/**
 * Extension settings schema helper tests.
 *
 * Verifies the pure logic that drives `ExtensionSettingsRenderer.tsx`:
 *
 *   - `extractFields` walks the JSON Schema, flattens nested objects into
 *     groups, and infers the right `kind` for each leaf
 *   - `applyDefaults` fills in `default` values for empty leaves
 *   - `getMissingRequired` flags `x-bibleAppRequired` fields with no value
 *   - `isFieldVisible` hides fields whose `x-bibleAppDependsOn` doesn't match
 *   - `findField` / `validateSettingValue` back `storage.setSetting`
 *     (task 0024 round 3, P1.7) - the host-side write validates against this
 *     same flattening rather than a second, independently-maintained rule
 *
 * The renderer's React mounting + IPC round-trip is intentionally not unit
 * tested here - that is covered by the e2e extension fixtures.
 */

import { describe, it, expect } from 'vitest';
import {
  applyDefaults,
  extractFields,
  findField,
  getMissingRequired,
  isFieldVisible,
  validateSettingValue,
} from './extensionSettingsSchema';

describe('extractFields', () => {
  it('flattens a nested object schema into groups + leaves', () => {
    const schema = {
      type: 'object',
      properties: {
        apiKey: {
          type: 'string',
          format: 'secret',
          'x-bibleAppRequired': true,
          title: 'API Key',
        },
        lookupLanguage: {
          type: 'string',
          enum: ['greek', 'hebrew', 'both'],
          default: 'both',
        },
        showMorphology: {
          type: 'boolean',
          default: true,
          'x-bibleAppDependsOn': { lookupLanguage: 'greek' },
        },
        advanced: {
          type: 'object',
          properties: {
            endpoint: { type: 'string', format: 'uri', default: 'https://api.example.com' },
            timeout: { type: 'integer', minimum: 1000, maximum: 60000, default: 10000 },
          },
        },
      },
    };
    const fields = extractFields(schema);
    expect(fields.map((f) => `${f.key}:${f.kind}`)).toEqual([
      'apiKey:secret',
      'lookupLanguage:enum',
      'showMorphology:boolean',
      'advanced:group',
    ]);
    expect(fields[0]?.required).toBe(true);
    expect(fields[1]?.enumValues).toEqual(['greek', 'hebrew', 'both']);
    const advanced = fields[3];
    expect(advanced?.children?.map((c) => `${c.key}:${c.kind}`)).toEqual([
      'advanced.endpoint:uri',
      'advanced.timeout:integer',
    ]);
    expect(advanced?.children?.[1]?.numberConstraints).toEqual({
      minimum: 1000,
      maximum: 60000,
    });
  });

  it('returns an empty list for non-object schemas', () => {
    expect(extractFields(null)).toEqual([]);
    expect(extractFields({ type: 'string' })).toEqual([]);
  });
});

describe('applyDefaults', () => {
  it('fills missing leaves with their default values', () => {
    const fields = extractFields({
      type: 'object',
      properties: {
        a: { type: 'string', default: 'hello' },
        b: { type: 'integer', default: 42 },
        c: { type: 'boolean' },
      },
    });
    expect(applyDefaults(fields, {})).toEqual({ a: 'hello', b: 42 });
    expect(applyDefaults(fields, { a: 'override' })).toEqual({ a: 'override', b: 42 });
  });

  it('walks into groups when applying defaults', () => {
    const fields = extractFields({
      type: 'object',
      properties: {
        adv: {
          type: 'object',
          properties: { endpoint: { type: 'string', default: 'x' } },
        },
      },
    });
    expect(applyDefaults(fields, {})).toEqual({ 'adv.endpoint': 'x' });
  });
});

describe('getMissingRequired', () => {
  it('flags required fields whose value is missing or empty', () => {
    const fields = extractFields({
      type: 'object',
      properties: {
        apiKey: { type: 'string', 'x-bibleAppRequired': true },
        optional: { type: 'string' },
      },
    });
    expect(getMissingRequired(fields, {})).toEqual(['apiKey']);
    expect(getMissingRequired(fields, { apiKey: '' })).toEqual(['apiKey']);
    expect(getMissingRequired(fields, { apiKey: 'abc' })).toEqual([]);
  });

  it('does not flag a hidden required field', () => {
    const fields = extractFields({
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['a', 'b'], default: 'a' },
        secretWhenB: {
          type: 'string',
          'x-bibleAppRequired': true,
          'x-bibleAppDependsOn': { mode: 'b' },
        },
      },
    });
    // mode === 'a' -> secretWhenB is hidden -> not required
    expect(getMissingRequired(fields, { mode: 'a' })).toEqual([]);
    // mode === 'b' -> secretWhenB is visible -> required
    expect(getMissingRequired(fields, { mode: 'b' })).toEqual(['secretWhenB']);
  });
});

describe('isFieldVisible', () => {
  it('honors sibling-relative dependsOn keys inside a group', () => {
    const fields = extractFields({
      type: 'object',
      properties: {
        adv: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['x', 'y'] },
            xOnly: {
              type: 'string',
              'x-bibleAppDependsOn': { mode: 'x' },
            },
          },
        },
      },
    });
    const xOnly = fields[0]?.children?.find((c) => c.propertyName === 'xOnly');
    expect(xOnly).toBeTruthy();
    expect(isFieldVisible(xOnly!, { 'adv.mode': 'x' })).toBe(true);
    expect(isFieldVisible(xOnly!, { 'adv.mode': 'y' })).toBe(false);
  });
});

describe('findField', () => {
  const fields = extractFields({
    type: 'object',
    properties: {
      apiKey: { type: 'string' },
      advanced: {
        type: 'object',
        properties: {
          endpoint: { type: 'string', format: 'uri' },
        },
      },
    },
  });

  it('finds a top-level leaf by key', () => {
    expect(findField(fields, 'apiKey')?.kind).toBe('string');
  });

  it('finds a nested leaf by its dot-path', () => {
    expect(findField(fields, 'advanced.endpoint')?.kind).toBe('uri');
  });

  it('returns null for an undeclared key', () => {
    expect(findField(fields, 'nope')).toBeNull();
  });

  it('returns null for a group key (not a leaf)', () => {
    expect(findField(fields, 'advanced')).toBeNull();
  });
});

describe('validateSettingValue', () => {
  const fields = extractFields({
    type: 'object',
    properties: {
      name: { type: 'string' },
      count: { type: 'integer', minimum: 1, maximum: 10 },
      ratio: { type: 'number', minimum: 0, maximum: 1 },
      enabled: { type: 'boolean' },
      mode: { type: 'string', enum: ['a', 'b'] },
      tags: { type: 'array', items: { type: 'string' } },
    },
  });
  const field = (key: string) => findField(fields, key)!;

  it('accepts a matching string', () => {
    expect(validateSettingValue(field('name'), 'hello')).toEqual({ ok: true });
  });

  it('rejects a non-string for a string field', () => {
    const res = validateSettingValue(field('name'), 42);
    expect(res.ok).toBe(false);
  });

  it('accepts an integer within range and rejects one outside it', () => {
    expect(validateSettingValue(field('count'), 5)).toEqual({ ok: true });
    expect(validateSettingValue(field('count'), 0).ok).toBe(false);
    expect(validateSettingValue(field('count'), 11).ok).toBe(false);
  });

  it('rejects a non-integer number for an integer field', () => {
    expect(validateSettingValue(field('count'), 5.5).ok).toBe(false);
  });

  it('accepts a fractional number for a number field', () => {
    expect(validateSettingValue(field('ratio'), 0.5)).toEqual({ ok: true });
  });

  it('accepts/rejects booleans correctly', () => {
    expect(validateSettingValue(field('enabled'), true)).toEqual({ ok: true });
    expect(validateSettingValue(field('enabled'), 'true').ok).toBe(false);
  });

  it('accepts a declared enum value and rejects an undeclared one', () => {
    expect(validateSettingValue(field('mode'), 'a')).toEqual({ ok: true });
    expect(validateSettingValue(field('mode'), 'c').ok).toBe(false);
  });

  it('accepts a string array and rejects a mixed array', () => {
    expect(validateSettingValue(field('tags'), ['x', 'y'])).toEqual({ ok: true });
    expect(validateSettingValue(field('tags'), ['x', 1]).ok).toBe(false);
    expect(validateSettingValue(field('tags'), 'x').ok).toBe(false);
  });
});
