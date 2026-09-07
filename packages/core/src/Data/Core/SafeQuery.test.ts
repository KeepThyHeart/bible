import { describe, it, expect } from 'vitest';
import { safeOrderByColumn, safeSortDirection, buildSafeOrderBy } from './SafeQuery';

describe('safeOrderByColumn', () => {
  const allowed = new Set(['name', 'created_date', 'modified_date']);

  it('should return a valid column', () => {
    expect(safeOrderByColumn('name', allowed, 'name')).toBe('name');
  });

  it('should return fallback when column is undefined', () => {
    expect(safeOrderByColumn(undefined, allowed, 'created_date')).toBe('created_date');
  });

  it('should throw for invalid column (SQL injection attempt)', () => {
    expect(() => safeOrderByColumn('name; DROP TABLE users', allowed, 'name'))
      .toThrow('Invalid ORDER BY column');
  });

  it('should throw for column not in whitelist', () => {
    expect(() => safeOrderByColumn('password', allowed, 'name'))
      .toThrow('Invalid ORDER BY column');
  });

  it('should throw for empty string column not in whitelist', () => {
    expect(() => safeOrderByColumn('', allowed, 'name'))
      .toThrow('Invalid ORDER BY column');
  });
});

describe('safeSortDirection', () => {
  it('should accept ASC', () => {
    expect(safeSortDirection('ASC')).toBe('ASC');
  });

  it('should accept DESC', () => {
    expect(safeSortDirection('DESC')).toBe('DESC');
  });

  it('should accept lowercase and normalize', () => {
    expect(safeSortDirection('asc')).toBe('ASC');
    expect(safeSortDirection('desc')).toBe('DESC');
  });

  it('should return fallback when undefined', () => {
    expect(safeSortDirection(undefined, 'DESC')).toBe('DESC');
  });

  it('should throw for invalid direction (SQL injection attempt)', () => {
    expect(() => safeSortDirection('ASC; DROP TABLE users'))
      .toThrow('Invalid sort direction');
  });

  it('should throw for random string', () => {
    expect(() => safeSortDirection('RANDOM'))
      .toThrow('Invalid sort direction');
  });
});

describe('buildSafeOrderBy', () => {
  const allowed = new Set(['name', 'date']);

  it('should build a valid ORDER BY clause', () => {
    expect(buildSafeOrderBy('name', 'ASC', allowed, { column: 'name', direction: 'ASC' }))
      .toBe(' ORDER BY name ASC');
  });

  it('should use defaults when both args are undefined', () => {
    expect(buildSafeOrderBy(undefined, undefined, allowed, { column: 'date', direction: 'DESC' }))
      .toBe(' ORDER BY date DESC');
  });

  it('should throw for invalid column in ORDER BY', () => {
    expect(() => buildSafeOrderBy('evil_column', 'ASC', allowed, { column: 'name', direction: 'ASC' }))
      .toThrow('Invalid ORDER BY column');
  });
});
