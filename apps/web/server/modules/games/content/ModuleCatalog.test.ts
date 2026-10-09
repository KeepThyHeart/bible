import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ModuleCatalog } from './ModuleCatalog.js';
import { makeTempDir, removeTempDir, writeFixtureModule } from './fixtures.js';

const directories: string[] = [];
const catalogs: ModuleCatalog[] = [];

function scratch(): string {
  const directory = makeTempDir('module-catalog-');
  directories.push(directory);
  return directory;
}

function discover(directory: string): ModuleCatalog {
  const catalog = ModuleCatalog.discover(directory);
  catalogs.push(catalog);
  return catalog;
}

afterEach(() => {
  for (const catalog of catalogs.splice(0)) catalog.closeAll();
  for (const directory of directories.splice(0)) {
    removeTempDir(directory);
    expect(existsSync(directory)).toBe(false);
  }
});

describe('discovering modules', () => {
  it('identifies a translation by its metadata, not its filename', () => {
    const directory = scratch();
    writeFixtureModule(join(directory, 'downloaded (1).db'), {
      abbreviation: 'ASV',
      fullName: 'American Standard Version',
    });

    const catalog = discover(directory);
    expect(catalog.size).toBe(1);
    expect(catalog.get('ASV')?.info.fullName).toBe('American Standard Version');
  });

  it('matches an abbreviation whatever case a host types', () => {
    const directory = scratch();
    writeFixtureModule(join(directory, 'a.db'), { abbreviation: 'KJV' });

    const catalog = discover(directory);
    expect(catalog.has('kjv')).toBe(true);
    expect(catalog.get('kJv')).not.toBeNull();
    expect(catalog.get('NIV')).toBeNull();
  });

  it('lists translations sorted, with a verse count a host can sanity-check', () => {
    const directory = scratch();
    writeFixtureModule(join(directory, 'z.db'), { abbreviation: 'WEB' });
    writeFixtureModule(join(directory, 'a.db'), { abbreviation: 'ASV' });

    const listed = discover(directory).list();
    expect(listed.map((entry) => entry.abbreviation)).toEqual(['ASV', 'WEB']);
    expect(listed[0]?.verseCount).toBeGreaterThan(0);
  });

  it('skips a file that is not a module and says why', () => {
    const directory = scratch();
    writeFixtureModule(join(directory, 'good.db'), { abbreviation: 'FIX' });
    writeFileSync(join(directory, 'README.txt'), 'modules go here');

    const catalog = discover(directory);
    expect(catalog.size).toBe(1);
    expect(catalog.skipped).toHaveLength(1);
    expect(catalog.skipped[0]?.path).toContain('README.txt');
    expect(catalog.skipped[0]?.reason.length).toBeGreaterThan(0);
  });

  it('keeps the first of two files claiming one abbreviation', () => {
    const directory = scratch();
    writeFixtureModule(join(directory, 'a.db'), { abbreviation: 'KJV', fullName: 'First' });
    writeFixtureModule(join(directory, 'b.db'), { abbreviation: 'KJV', fullName: 'Second' });

    const catalog = discover(directory);
    expect(catalog.size).toBe(1);
    expect(catalog.get('KJV')?.info.fullName).toBe('First');
    expect(catalog.skipped[0]?.reason).toContain('already provided by');
  });

  it('is an empty catalog when nothing is installed yet', () => {
    const catalog = discover(join(scratch(), 'not-created'));
    expect(catalog.size).toBe(0);
    expect(catalog.list()).toEqual([]);
    expect(catalog.skipped).toEqual([]);
  });

  it('ignores sqlite sidecars rather than reporting them as bad modules', () => {
    const directory = scratch();
    writeFixtureModule(join(directory, 'kjv.db'), { abbreviation: 'KJV' });
    writeFileSync(join(directory, 'kjv.db-wal'), '');
    writeFileSync(join(directory, 'kjv.db-shm'), '');

    const catalog = discover(directory);
    expect(catalog.size).toBe(1);
    expect(catalog.skipped).toEqual([]);
  });
});
