// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { Sync } from '@bible/core/browser';
import { finishOpen } from '../openUserDb';
import { cleanModuleRefs, createModuleResolver, planModuleRemap, remapModuleIds } from './moduleResolver';

let sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>>;
beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
}, 60_000);

describe('module resolver (portable ref = abbreviation)', () => {
  it('maps catalog ids to abbreviations and back, case-insensitively; unknown is null', () => {
    const r = createModuleResolver([{ id: 3, abbr: 'KJV' }, { id: 7, abbr: 'ESV' }]);
    expect(r.toPortable(3)).toBe('KJV');
    expect(r.toPortable('7')).toBe('ESV');
    expect(r.toPortable(99)).toBeNull();
    expect(r.toPortable('x')).toBeNull();
    expect(r.toLocal('kjv')).toBe(3);
    expect(r.toLocal('ESV')).toBe(7);
    expect(r.toLocal('NIV')).toBeNull();
    expect(r.toLocal('')).toBeNull();
  });

  it('updates in place (the engine keeps the same object)', () => {
    const r = createModuleResolver([]);
    expect(r.toLocal('KJV')).toBeNull();
    r.update([{ id: 4, abbr: 'KJV' }]);
    expect(r.toLocal('KJV')).toBe(4);
    expect(r.refs()).toEqual([{ id: 4, abbr: 'KJV' }]);
  });

  it('drops malformed refs and keeps the first ref per id', () => {
    expect(cleanModuleRefs([{ id: 1, abbr: ' KJV ' }, { id: 1, abbr: 'X' }, { id: 1.5, abbr: 'Y' }, { id: 2, abbr: '' }, null, 'z', { id: 3 }]))
      .toEqual([{ id: 1, abbr: 'KJV' }]);
    expect(cleanModuleRefs('nope')).toEqual([]);
  });

  it('plans id moves for abbreviations whose catalog id changed', () => {
    const old = [{ id: 1, abbr: 'KJV' }, { id: 2, abbr: 'ESV' }, { id: 3, abbr: 'WEB' }];
    const next = [{ id: 2, abbr: 'kjv' }, { id: 1, abbr: 'ESV' }, { id: 3, abbr: 'WEB' }, { id: 4, abbr: 'NEW' }];
    expect(planModuleRemap(old, next)).toEqual([[1, 2], [2, 1]]);
    expect(planModuleRemap([], next)).toEqual([]);
    expect(planModuleRemap(old, [])).toEqual([]);
  });

  it('remaps stored module ids (swaps included) without marking rows dirty for sync', () => {
    const { sql } = finishOpen(new sqlite3.oo1.DB(':memory:'), ':memory:');
    const add = (m: number) => sql.execute(
      'INSERT INTO user_text_markup (module_id, verse_id_start, verse_id_end, color) VALUES (?, 1001001, 1001001, ?)', [m, '#ff0']);
    add(1); add(2); add(3);
    const tracker = Sync.createChangeTracker(sql);
    tracker.install(Sync.coreTrackedTables());
    sql.execute('UPDATE sync_record SET dirty = 0');
    expect(remapModuleIds(sql, [[1, 2], [2, 1]])).toBe(2);
    expect(sql.queryAll<{ module_id: number }>('SELECT module_id FROM user_text_markup ORDER BY markup_id').map((r) => r.module_id))
      .toEqual([2, 1, 3]);
    expect(tracker.pendingCount()).toBe(0);
    expect(remapModuleIds(sql, [])).toBe(0);
  }, 60_000);
});
