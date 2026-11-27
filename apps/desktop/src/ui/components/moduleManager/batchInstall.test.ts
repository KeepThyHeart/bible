import { describe, it, expect } from 'vitest';
import { checkBatchSize, isRowSelectable, LARGE_BATCH_BYTES, selectableVisibleRows, totalDownloadBytes } from './batchInstall';
import { mergeAndSortModules } from '../../stores/module/moduleRows';
import type { CatalogModule, ModuleMetadata } from '../../stores/module/types';
import type { InstallJob } from '../../stores/module/moduleAPI';

const cat = (abbreviation: string, size: number, type: CatalogModule['module_type'] = 'bible'): CatalogModule =>
  ({
    module_id: `cat-${abbreviation}`, module_type: type, name: `${abbreviation} name`, abbreviation, language_code: 'en',
    version: '2.0', description: '', license: 'PD', download_url: 'x', download_size_bytes: size, installed_size_bytes: 0,
    checksum: 'x', features: [], tags: [], recommended: false, created_date: '', updated_date: '',
  }) as CatalogModule;
const inst = (abbreviation: string, id: number, update = false): ModuleMetadata =>
  ({
    module_id: id, module_type: 'bible', abbreviation, name: `${abbreviation} name`, language_code: 'en', version: '1.0',
    database_path: 'x', is_indexed: true, update_available: update, usage_count: 0, user_hidden: false,
  }) as ModuleMetadata;

const rows = mergeAndSortModules(
  [cat('AAA', 100), cat('BBB', 200), cat('CCC', 400), cat('DDD', 800, 'commentary')],
  [inst('AAA', 1), inst('BBB', 2, true)]
);

describe('batchInstall helpers', () => {
  it('only not-installed rows and rows with an update are selectable', () => {
    const by = Object.fromEntries(rows.map((r) => [r.abbreviation, isRowSelectable(r)]));
    expect(by).toEqual({ AAA: false, BBB: true, CCC: true, DDD: true });
  });

  it('selectable rows respect type tab, filter and text filter', () => {
    expect(selectableVisibleRows(rows, 'bible', 'all', '', []).map((r) => r.abbreviation).sort()).toEqual(['BBB', 'CCC']);
    expect(selectableVisibleRows(rows, 'bible', 'updates', '', []).map((r) => r.abbreviation)).toEqual(['BBB']);
    expect(selectableVisibleRows(rows, 'bible', 'installed', '', []).map((r) => r.abbreviation)).toEqual(['BBB']);
    expect(selectableVisibleRows(rows, 'bible', 'all', 'ccc', []).map((r) => r.abbreviation)).toEqual(['CCC']);
    expect(selectableVisibleRows(rows, 'commentary', 'all', '', []).map((r) => r.abbreviation)).toEqual(['DDD']);
  });

  it('skips rows that already have an install job', () => {
    const job = { jobId: 1, moduleId: 'cat-CCC', stage: 'failed' } as InstallJob;
    expect(selectableVisibleRows(rows, 'bible', 'all', '', [job]).map((r) => r.abbreviation)).toEqual(['BBB']);
  });

  it('totals download bytes', () => {
    expect(totalDownloadBytes(rows.filter((r) => ['BBB', 'CCC'].includes(r.abbreviation)))).toBe(600);
  });

  it('warns for large batches and for batches over the free space', () => {
    expect(checkBatchSize(10, 1000)).toBe('ok');
    expect(checkBatchSize(10, null)).toBe('ok');
    expect(checkBatchSize(LARGE_BATCH_BYTES + 1, null)).toBe('large');
    expect(checkBatchSize(LARGE_BATCH_BYTES + 1, LARGE_BATCH_BYTES * 10)).toBe('large');
    expect(checkBatchSize(500, 100)).toBe('exceeds-free-space');
  });
});
