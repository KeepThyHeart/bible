/**
 * Unit tests for the tiny semver range matcher used by `ExtensionHost.activate`
 * The matcher only needs to cover the subset of the npm range grammar the
 * host's API versioning rules use - these tests lock that subset down so a future tightening of the rule doesn't break a
 * working extension.
 */

import { describe, it, expect } from 'vitest';
import { satisfies } from '../semverRange';

describe('semverRange.satisfies', () => {
  it('matches an exact version', () => {
    expect(satisfies('1.0.0', '1.0.0')).toBe(true);
    expect(satisfies('1.0.1', '1.0.0')).toBe(false);
  });

  it('matches a caret range across patch and minor for major >= 1', () => {
    expect(satisfies('1.0.0', '^1.0.0')).toBe(true);
    expect(satisfies('1.2.3', '^1.0.0')).toBe(true);
    expect(satisfies('2.0.0', '^1.0.0')).toBe(false);
    expect(satisfies('0.9.9', '^1.0.0')).toBe(false);
  });

  it('caret range pins minor for 0.x', () => {
    expect(satisfies('0.1.5', '^0.1.2')).toBe(true);
    expect(satisfies('0.2.0', '^0.1.2')).toBe(false);
  });

  it('matches a tilde range', () => {
    expect(satisfies('1.2.5', '~1.2.0')).toBe(true);
    expect(satisfies('1.3.0', '~1.2.0')).toBe(false);
  });

  it('matches an x-range', () => {
    expect(satisfies('1.5.0', '1.x')).toBe(true);
    expect(satisfies('2.0.0', '1.x')).toBe(false);
    expect(satisfies('1.2.99', '1.2.x')).toBe(true);
    expect(satisfies('1.3.0', '1.2.x')).toBe(false);
    expect(satisfies('5.0.0', '*')).toBe(true);
  });

  it('matches a comparator AND range', () => {
    expect(satisfies('1.5.0', '>=1.0.0 <2.0.0')).toBe(true);
    expect(satisfies('2.0.0', '>=1.0.0 <2.0.0')).toBe(false);
  });

  it('matches an OR range', () => {
    expect(satisfies('2.3.4', '^1.0.0 || ^2.0.0')).toBe(true);
    expect(satisfies('3.0.0', '^1.0.0 || ^2.0.0')).toBe(false);
  });

  it('returns false for an unparseable range', () => {
    expect(satisfies('1.0.0', 'not-a-range')).toBe(false);
  });

  it('returns false for an unparseable version', () => {
    expect(satisfies('not-a-version', '^1.0.0')).toBe(false);
  });
});
