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
 *
 * The renderer's React mounting + IPC round-trip is intentionally not unit
 * tested here - that is covered by the e2e extension fixtures.
 */

import { describe, it, expect } from 'vitest';
import {
  applyDefaults,
  extractFields,
  getMissingRequired,
  isFieldVisible,
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
