import { describe, it, expect } from 'vitest';
import { parseJsonField, stringifyJsonField } from './JsonHelpers';

describe('parseJsonField', () => {
  it('should parse valid JSON', () => {
    expect(parseJsonField('{"key":"value"}')).toEqual({ key: 'value' });
  });

  it('should parse JSON arrays', () => {
    expect(parseJsonField('["a","b"]')).toEqual(['a', 'b']);
  });

  it('should return undefined for null', () => {
    expect(parseJsonField(null)).toBeUndefined();
  });

  it('should return undefined for undefined', () => {
    expect(parseJsonField(undefined)).toBeUndefined();
  });

  it('should return undefined for empty string', () => {
    expect(parseJsonField('')).toBeUndefined();
  });

  it('should throw for malformed JSON', () => {
    // This tests that corrupt data in the database will surface rather than silently failing
    expect(() => parseJsonField('{invalid json}')).toThrow();
  });

  it('should support generic type parameter', () => {
    const result = parseJsonField<{ count: number }>('{"count":42}');
    expect(result?.count).toBe(42);
  });
});

describe('stringifyJsonField', () => {
  it('should stringify objects', () => {
    expect(stringifyJsonField({ key: 'value' })).toBe('{"key":"value"}');
  });

  it('should stringify arrays', () => {
    expect(stringifyJsonField(['a', 'b'])).toBe('["a","b"]');
  });

  it('should return null for null', () => {
    expect(stringifyJsonField(null)).toBeNull();
  });

  it('should return null for undefined', () => {
    expect(stringifyJsonField(undefined)).toBeNull();
  });

  it('should stringify falsy values that are not null/undefined', () => {
    expect(stringifyJsonField(0)).toBe('0');
    expect(stringifyJsonField(false)).toBe('false');
    expect(stringifyJsonField('')).toBe('""');
  });
});
