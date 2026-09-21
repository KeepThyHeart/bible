/**
 * Where an installed module lands on disk.
 *
 * `moduleDetector` recognises a module file by the prefix before the first
 * underscore (`topical_*`, `xref_*`) and de-registers what it cannot place. The
 * registry type of a topical index or cross-reference module is spelled
 * `topical_index` / `cross_reference`, so the file name must keep the short
 * prefix or the module vanishes on the next start.
 */
import path from 'path';
import { describe, it, expect } from 'vitest';
import type { ISql } from '@bible/core';

import { InstallationService } from '../InstallationService';

describe('InstallationService.getModulePath', () => {
  const base = path.join('data', 'modules');
  const service = new InstallationService({} as unknown as ISql, base);
  const file = (type: string, id: string) => path.basename(service.getModulePath(type, id));

  it('names a file <type>_<id>.db, lower-cased', () => {
    expect(file('bible', 'KJV')).toBe('bible_kjv.db');
    expect(file('commentary', 'Wesley')).toBe('commentary_wesley.db');
  });

  it('keeps the short prefix for topical indexes', () => {
    expect(file('topical_index', 'NaveTopics')).toBe('topical_navetopics.db');
  });

  it('keeps the short prefix for cross-reference modules', () => {
    expect(file('cross_reference', 'TSKxref')).toBe('xref_tskxref.db');
  });
});
