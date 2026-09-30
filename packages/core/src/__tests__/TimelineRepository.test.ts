import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { TimelineRepository } from '../Data/Repositories/TimelineRepository';
import { loadSchemaSql } from '../Data/Schema/loadSchemaSql';
import { TestSqliteProvider } from './helpers/TestSqliteProvider';

const SCHEMA = join(__dirname, '..', '..', 'sql', 'schemas', 'initial', 'Timeline.sql');

describe('TimelineRepository', () => {
  it('reads a whole module as one dataset', () => {
    const provider = new TestSqliteProvider(':memory:');
    provider.exec(loadSchemaSql(SCHEMA));
    provider.exec(`
      INSERT INTO module_info (info_id, module_uuid, module_type, abbreviation, full_name, format, license_spdx)
        VALUES (1, '00000000-0000-4000-8000-000000000001', 'timeline', 'TL', 'Test Timeline', 'timeline-module', 'CC-BY-4.0');
      INSERT INTO timeline_chronology VALUES ('ussher', 'Ussher', 'literal', NULL, 1, 0);
      INSERT INTO timeline_lane VALUES ('judah', 'Judah', NULL, 'judah', 0);
      INSERT INTO timeline_item (item_id, slug, kind, lane_id, title, reviewed_by) VALUES (1, 'a', 'reign', 'judah', 'A', NULL), (2, 'b', 'event', 'judah', 'B', 'pr');
      INSERT INTO timeline_date (item_id, chronology_id, start_day, end_day, precision, circa, basis) VALUES (1, 'ussher', 1000, 2000, 'year', 1, '1 Kgs 1');
      INSERT INTO timeline_date (item_id, chronology_id, start_day, start_min, start_max, precision) VALUES (2, 'ussher', 3000.375, 2990, 3010, 'hour');
      INSERT INTO verse_link (source_type, source_id, verse_id_start, verse_id_end, link_type) VALUES ('timeline_item', 1, 11001001, 11002000, 'primary_passage'), ('timeline_item', 1, 12001001, 12001001, 'reference');
    `);
    const ds = new TimelineRepository(provider).getDataset();
    expect(ds.info).toMatchObject({ name: 'Test Timeline', abbreviation: 'TL', license: 'CC-BY-4.0' });
    expect(ds.chronologies[0]).toMatchObject({ id: 'ussher', isDefault: true });
    expect(ds.items).toHaveLength(2);
    expect(ds.items[0].dates.ussher).toEqual({ start: 1000, end: 2000, precision: 'year', circa: true, basis: '1 Kgs 1' });
    expect(ds.items[0].passages).toEqual([{ start: 11001001, end: 11002000, primary: true }, { start: 12001001, end: 12001001, primary: false }]);
    expect(ds.items[1]).toMatchObject({ reviewed: true });
    expect(ds.items[1].dates.ussher).toMatchObject({ start: 3000.375, startMin: 2990, startMax: 3010, precision: 'hour' });
    expect(new TimelineRepository(provider).getItemIdsForVerse(11001500)).toEqual([1]);
    provider.close();
  });
});
