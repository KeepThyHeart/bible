import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { sanitizeQuery, clientErrorStatus, isQuerySyntaxError, clampInt } from '../utils/requestHygiene';

describe('request hygiene (B-170..174)', () => {
  it('collapses repeated params and strips NUL bytes', () => {
    const req = { query: { q: ['a', 'b'], n: 'x\0y', o: { k: 'v' }, ok: 'fine' } } as unknown as Request;
    let called = false;
    sanitizeQuery(req, {} as never, () => { called = true; });
    expect(called).toBe(true);
    expect(req.query).toEqual({ q: 'a', n: 'xy', o: '', ok: 'fine' });
  });
  it('reads 4xx statuses off Express errors only', () => {
    expect(clientErrorStatus(Object.assign(new Error('Failed to decode param'), { status: 400, statusCode: 400 }))).toBe(400);
    expect(clientErrorStatus(new Error('boom'))).toBeNull();
    expect(clientErrorStatus({ status: 500 })).toBeNull();
  });
  it('recognises query syntax errors', () => {
    expect(isQuerySyntaxError(new Error('Unmatched quote in search query'))).toBe(true);
    expect(isQuerySyntaxError(new Error('Unmatched opening parenthesis'))).toBe(true);
    expect(isQuerySyntaxError(new Error('SQLITE_ERROR'))).toBe(false);
  });
  it('clamps limits and offsets', () => {
    expect(clampInt('-1', 50, 1, 200)).toBe(1);
    expect(clampInt('99999999999999999999', 0, 0, 100000)).toBe(100000);
    expect(clampInt('abc', 50, 1, 200)).toBe(50);
    expect(clampInt(undefined, 50, 1, 200)).toBe(50);
    expect(clampInt('30', 50, 1, 200)).toBe(30);
  });
});
