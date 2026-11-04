// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createModuleRefResolver } from '../moduleRefResolver';

describe('createModuleRefResolver', () => {
  const rows = [{ moduleId: 1, abbreviation: 'KJV' }, { moduleId: 2, abbreviation: 'ESV' }, { moduleId: 3 }];

  it('maps ids to abbreviations and back (case-insensitive), never to a uuid', () => {
    const r = createModuleRefResolver({ getAll: () => rows });
    expect(r.toPortable(1)).toBe('KJV');
    expect(r.toPortable('2')).toBe('ESV');
    expect(r.toPortable(3)).toBeNull();
    expect(r.toPortable(99)).toBeNull();
    expect(r.toPortable('abc')).toBeNull();
    expect(r.toLocal('kjv')).toBe(1);
    expect(r.toLocal('Esv')).toBe(2);
    expect(r.toLocal('NIV')).toBeNull();
    expect(r.toLocal('')).toBeNull();
  });

  it('reloads once on a miss (a module installed since) and on invalidate', () => {
    let list = [...rows];
    let loads = 0;
    const r = createModuleRefResolver({ getAll: () => { loads++; return list; } });
    expect(r.toLocal('KJV')).toBe(1);
    expect(loads).toBe(1);
    list = [...rows, { moduleId: 4, abbreviation: 'NIV' }];
    expect(r.toLocal('niv')).toBe(4);
    expect(r.toPortable(4)).toBe('NIV');
    list = [{ moduleId: 1, abbreviation: 'KJ2' }];
    expect(r.toPortable(1)).toBe('KJV'); // cached until invalidated
    r.invalidate();
    expect(r.toPortable(1)).toBe('KJ2');
  });

  it('survives a failing source', () => {
    const r = createModuleRefResolver({ getAll: () => { throw new Error('db closed'); } });
    expect(r.toPortable(1)).toBeNull();
    expect(r.toLocal('KJV')).toBeNull();
  });
});
