import { describe, it, expect } from 'vitest';
import { DataLayerError, ValidationError, NotFoundError, ConflictError, DatabaseError, isReadOnlyDatabaseError } from './Errors';

describe('Custom error classes', () => {
  it('should be instanceof Error', () => {
    expect(new ValidationError('test')).toBeInstanceOf(Error);
    expect(new NotFoundError('test')).toBeInstanceOf(Error);
    expect(new ConflictError('test')).toBeInstanceOf(Error);
    expect(new DatabaseError('test')).toBeInstanceOf(Error);
  });

  it('should be instanceof DataLayerError', () => {
    expect(new ValidationError('test')).toBeInstanceOf(DataLayerError);
    expect(new NotFoundError('test')).toBeInstanceOf(DataLayerError);
    expect(new ConflictError('test')).toBeInstanceOf(DataLayerError);
    expect(new DatabaseError('test')).toBeInstanceOf(DataLayerError);
  });

  it('should have correct name property', () => {
    expect(new ValidationError('test').name).toBe('ValidationError');
    expect(new NotFoundError('test').name).toBe('NotFoundError');
    expect(new ConflictError('test').name).toBe('ConflictError');
    expect(new DatabaseError('test').name).toBe('DatabaseError');
  });

  it('should preserve error message', () => {
    expect(new ValidationError('bad input').message).toBe('bad input');
    expect(new NotFoundError('not found').message).toBe('not found');
  });

  it('should allow instanceof discrimination in catch blocks', () => {
    try {
      throw new NotFoundError('Module not found: KJV');
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error).toBeInstanceOf(DataLayerError);
      expect(error).not.toBeInstanceOf(ValidationError);
    }
  });

  it('DatabaseError should preserve cause', () => {
    const original = new Error('SQLITE_CONSTRAINT');
    const dbError = new DatabaseError('Insert failed', original);
    expect(dbError.cause).toBe(original);
    expect(dbError.message).toBe('Insert failed');
  });

  it('DatabaseError should work without cause', () => {
    const dbError = new DatabaseError('Query failed');
    expect(dbError.cause).toBeUndefined();
  });
});

describe('isReadOnlyDatabaseError', () => {
  it('recognizes the better-sqlite3 error code', () => {
    const err = Object.assign(new Error('attempt to write a readonly database'), {
      code: 'SQLITE_READONLY',
    });
    expect(isReadOnlyDatabaseError(err)).toBe(true);
  });

  it('recognizes SQLITE_READONLY_* variants', () => {
    for (const code of ['SQLITE_READONLY_DBMOVED', 'SQLITE_READONLY_RECOVERY']) {
      expect(isReadOnlyDatabaseError(Object.assign(new Error('nope'), { code }))).toBe(true);
    }
  });

  it('recognizes the message alone, for wrappers that drop the code', () => {
    expect(isReadOnlyDatabaseError(new Error('attempt to write a readonly database'))).toBe(true);
  });

  it('does not swallow unrelated database errors', () => {
    // The whole point of the predicate is that these still propagate - a
    // constraint violation must not be mistaken for an immutable module.
    const constraint = Object.assign(new Error('UNIQUE constraint failed'), {
      code: 'SQLITE_CONSTRAINT_UNIQUE',
    });
    expect(isReadOnlyDatabaseError(constraint)).toBe(false);
    expect(isReadOnlyDatabaseError(new Error('database disk image is malformed'))).toBe(false);
  });

  it('tolerates non-error values without throwing', () => {
    expect(isReadOnlyDatabaseError(null)).toBe(false);
    expect(isReadOnlyDatabaseError(undefined)).toBe(false);
    expect(isReadOnlyDatabaseError('readonly')).toBe(false);
  });
});
