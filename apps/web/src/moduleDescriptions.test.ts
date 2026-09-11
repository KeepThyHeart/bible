/**
 * The optional catalog fields -- disclaimers, taglines -- must come back as
 * `undefined` when a module's entry omits them, never as the lookup key.
 *
 * i18next echoes an unresolved key without its `modules:` namespace prefix, so
 * the old "result equals the key" check never matched and a fresh profile, which
 * opens on Wesley, showed `commentaries.Wesley.disclaimer` in the disclaimer
 * banner. These run against the real English catalog, not a mock of it.
 */
import { describe, it, expect } from 'vitest';
import {
  getBibleDescription,
  getCommentaryDescription,
  getModuleDisclaimer,
} from './moduleDescriptions';

const RAW_KEY = /^(modules:)?(bibles|commentaries)\./;

describe('moduleDescriptions optional fields', () => {
  it('gives a commentary with no written disclaimer no disclaimer at all', () => {
    expect(getModuleDisclaimer('Wesley')).toBeUndefined();

    const wesley = getCommentaryDescription('Wesley');
    expect(wesley?.description).toMatch(/Wesley/);
    expect(wesley?.disclaimer).toBeUndefined();
  });

  it('never returns a raw key for a module the catalog does not know', () => {
    expect(getModuleDisclaimer('NOT_A_MODULE')).toBeUndefined();
    expect(getBibleDescription('NOT_A_MODULE')).toBeUndefined();
    expect(getCommentaryDescription('NOT_A_MODULE')).toBeUndefined();
  });

  it('leaves out a Bible tagline that is not written rather than showing its key', () => {
    const kjv = getBibleDescription('KJV');
    expect(kjv).toBeDefined();
    for (const field of [kjv?.description, kjv?.tagline, kjv?.disclaimer]) {
      if (field !== undefined) expect(field).not.toMatch(RAW_KEY);
    }
  });

  it('describes Barnes as the New Testament notes it is', () => {
    expect(getCommentaryDescription('Barnes')?.description).toMatch(/New Testament/);
  });
});
