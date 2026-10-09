/**
 * Record codecs (contracts 0063 §5, task 0150 W2-A): round trip between two real user DBs, missing parents,
 * unknown modules, never-sync rows, registry coverage, and hostile records.
 */
import { describe, it, expect } from 'vitest';
import { USER_TABLES, tableSpec } from '../../../Backup/Registry';
import { coreTrackedTables } from '../../../Sync/tracking/ChangeTracker';
import {
  createCoreCodecs, createCodecRegistry, RecordDecodeError, type RecordCodec,
} from '../../../Sync/codecs/RecordCodec';
import { createTableCodec, columnPlan } from '../../../Sync/codecs/tableCodec';
import { EXT_KV_COLUMN_MAP } from '../../../Sync/codecs/extKv';
import { US, applyAll, encodeAll, makeSide, moduleResolver, mulberry32, populate, shuffle } from './harness';

const registry = createCodecRegistry(createCoreCodecs());
const MODS_A = moduleResolver({ 1: 'uuid-one', 2: 'ABBR' });
const MODS_B = moduleResolver({ 11: 'uuid-one', 12: 'ABBR' }); // same modules, other local install ids

describe('codec registry', () => {
  it('has a versioned codec for every tracked table', () => {
    const tracked = coreTrackedTables();
    expect(registry.all()).toHaveLength(tracked.length);
    for (const t of tracked) {
      const c = registry.byKind(t.kind)!;
      expect(c, t.kind).toBeDefined();
      expect(registry.byType(c.type)).toBe(c);
      expect(c.version).toBe(1);
    }
    expect(registry.byKind('ext.kv')?.type).toBe('ext.kv');
    expect(registry.byType('nope')).toBeUndefined();
  });

  it('refuses duplicate types', () => {
    const [first] = createCoreCodecs();
    expect(() => createCodecRegistry([first, first])).toThrow(/Duplicate/);
  });

  it('accounts for every registry column: encoded, FK-translated, or local with a reason', () => {
    const side = makeSide(mulberry32(7), MODS_A, (db) => populate(db, mulberry32(7)));
    const { wires } = encodeAll(side, registry);
    for (const t of coreTrackedTables()) {
      if (t.kind === 'ext.kv') {
        const w = wires.find((x) => x.kind === 'ext.kv')!;
        expect(Object.keys(w.d).sort()).toEqual(Object.values(EXT_KV_COLUMN_MAP).sort());
        expect(Object.keys(EXT_KV_COLUMN_MAP).sort()).toEqual([...tableSpec('extension_storage')!.columns].sort());
        continue;
      }
      const spec = tableSpec(t.table)!;
      const plan = columnPlan(spec);
      expect(plan.map((p) => p.name)).toEqual(spec.columns);
      const encoded = new Set<string>();
      for (const p of plan) {
        if (p.role === 'localId' || p.role === 'localOnly') {
          expect(p.reason, `${spec.name}.${p.name}`).toBeTruthy();
        } else {
          encoded.add(p.name);
        }
        if (p.role === 'fk') expect(p.fk).toBeDefined();
      }
      const rows = wires.filter((w) => w.kind === t.kind);
      expect(rows.length, `${t.kind} populated`).toBeGreaterThan(0);
      for (const w of rows) {
        // every key is a planned, encodable column; none is a local id or a local-only column
        for (const k of Object.keys(w.d)) expect(encoded.has(k), `${t.kind}.${k}`).toBe(true);
      }
      // across all rows each encodable column appears at least once (the live DB has all registry columns)
      const seen = new Set(rows.flatMap((w) => Object.keys(w.d)));
      for (const c of encoded) expect(seen.has(c), `${t.kind}.${c} never encoded`).toBe(true);
    }
  });

  it('declares the tracked tables as registry tables of the expected classes', () => {
    for (const t of coreTrackedTables()) {
      const spec = USER_TABLES.find((s) => s.name === t.table)!;
      expect(['content', 'workspace', 'extension']).toContain(spec.cls);
    }
  });
});

describe('round trip A -> B (randomised)', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    it(`reproduces every row modulo local ids (seed ${seed})`, () => {
      const rng = mulberry32(seed);
      const a = makeSide(rng, MODS_A, (db) => populate(db, mulberry32(seed * 977)));
      const b = makeSide(rng, MODS_B);
      const { wires, skipped } = encodeAll(a, registry);

      // never-sync rows: unsupported polymorphic type and dangling parent
      expect(skipped.filter((s) => s.kind === 'verse_link')).toHaveLength(2);
      expect(wires.length).toBeGreaterThan(30);

      const { pending } = applyAll(b, registry, shuffle(wires, rng));
      // the markup with an unknown module stays pending (it cannot be written), nothing else does
      expect(pending).toHaveLength(1);
      expect(pending[0].kind).toBe('user_text_markup');
      expect(pending[0].unknownModules).toEqual([String(pending[0].d.module_id)]);
      expect(a.notes.map((n) => n.code)).toEqual(['unknownModule']);

      // B re-encodes to exactly what A sent, record id by record id (FKs resolved through record ids)
      const back = encodeAll(b, registry);
      const key = (w: { kind: string; id: string }): string => `${w.kind}:${w.id}`;
      const sent = new Map(wires.filter((w) => w.id !== pending[0].id).map((w) => [key(w), w.d]));
      expect(back.wires).toHaveLength(sent.size);
      for (const w of back.wires) expect(w.d, key(w)).toEqual(sent.get(key(w)));

      // row counts per table agree (A minus the held-back markup and the rows that never sync)
      for (const t of coreTrackedTables()) {
        const n = (s: typeof a): number => s.db.queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM "${t.table}"`)!.n;
        const aSent = wires.filter((w) => w.kind === t.kind).length - (t.kind === 'user_text_markup' ? 1 : 0);
        expect(n(b), t.table).toBe(aSent);
      }

      // applied inside applyRemote: B's triggers recorded nothing as a local change
      expect(b.tracker.dirty(1000)).toEqual([]);
      // the default flag never travels
      expect(b.db.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM user_commentary WHERE is_default = 1')!.n).toBe(0);
      // module ids were translated to B's own install ids
      const mods = b.db.queryAll<{ module_id: number }>('SELECT DISTINCT module_id FROM user_text_markup').map((r) => r.module_id);
      for (const m of mods) expect([11, 12]).toContain(m);
      // a real content spot check through SQL joins
      const aNotes = a.db.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM user_note n JOIN note_verse_link l ON l.note_id = n.note_id')!.n;
      const bNotes = b.db.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM user_note n JOIN note_verse_link l ON l.note_id = n.note_id')!.n;
      expect(bNotes).toBe(aNotes);
      // idempotent: applying everything again changes nothing
      applyAll(b, registry, wires.filter((w) => w.id !== pending[0].id));
      expect(encodeAll(b, registry).wires).toHaveLength(back.wires.length);
    });
  }
});

describe('decode', () => {
  const note = (): { side: ReturnType<typeof makeSide>; codec: RecordCodec } => ({
    side: makeSide(mulberry32(1), MODS_A),
    codec: registry.byKind('note_verse_link')!,
  });

  it('reports a missing parent record id instead of failing', () => {
    const { side, codec } = note();
    const parent = 'a'.repeat(32);
    const r = codec.decode({ note_id: parent, verse_id_start: 1, verse_id_end: 1, link_type: 'reference' }, side.ctx);
    expect(r).toEqual({ ok: false, missing: [parent] });
  });

  it('collects every missing parent of a polymorphic row', () => {
    const side = makeSide(mulberry32(1), MODS_A);
    const r = registry.byKind('pinned_item')!.decode({
      collection_id: 'b'.repeat(32), item_type: 'note', reference_id: 'c'.repeat(32), verse_id_start: null,
    }, side.ctx);
    expect(r).toEqual({ ok: false, missing: ['b'.repeat(32), 'c'.repeat(32)] });
  });

  it('passes a non-note pinned_item reference through untouched', () => {
    const side = makeSide(mulberry32(1), MODS_A);
    side.db.execute("INSERT INTO collection (name) VALUES ('c')");
    const pc = side.ctx.recordIdFor('collection', '1');
    const r = registry.byKind('pinned_item')!.decode({ collection_id: pc, item_type: 'commentary', reference_id: 712 }, side.ctx);
    expect(r).toEqual({ ok: true, row: { collection_id: 1, item_type: 'commentary', reference_id: 712 } });
  });

  it('keeps an unknown portable module pending and reports it', () => {
    const side = makeSide(mulberry32(1), MODS_A);
    const r = registry.byKind('user_text_markup')!.decode({
      module_id: 'never-installed', verse_id_start: 1, verse_id_end: 1, color: '#fff', note_id: null,
    }, side.ctx);
    expect(r).toEqual({ ok: false, missing: [], unknownModules: ['never-installed'] });
  });

  it('keeps an unknown local module on encode as a marker and reports a note', () => {
    const side = makeSide(mulberry32(1), MODS_A);
    side.db.execute("INSERT INTO user_text_markup (module_id, verse_id_start, verse_id_end, color) VALUES (77, 1, 1, '#fff')");
    const d = registry.byKind('user_text_markup')!.encode('1', side.ctx)!;
    expect(d.module_id).toBe('local:77');
    expect(side.notes).toEqual([{ kind: 'user_text_markup', localKey: '1', code: 'unknownModule', column: 'module_id', value: 77 }]);
  });

  it('passes memory_passage.module_id through as the portable string it already is', () => {
    const side = makeSide(mulberry32(1), moduleResolver({}));
    side.db.execute("INSERT INTO memory_collection (name, created_at) VALUES ('d', 1)");
    side.db.execute(`INSERT INTO memory_passage (collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at)
      VALUES (1, 'KJV', 1001001, 1001002, 'Gen 1:1-2', 2, 1)`);
    expect(registry.byKind('memory_passage')!.encode('1', side.ctx)!.module_id).toBe('KJV');
    expect(side.notes).toEqual([]);
  });

  it('throws RecordDecodeError for malformed payloads without echoing them', () => {
    const { side, codec } = note();
    expect(() => codec.decode({ note_id: 'not-a-record-id', verse_id_start: 1, verse_id_end: 1 }, side.ctx)).toThrow(RecordDecodeError);
    let err: Error | undefined;
    try { codec.decode({ note_id: 'a'.repeat(32), verse_id_start: { x: 'SECRET' } }, side.ctx); } catch (e) { err = e as Error; }
    expect(err).toBeInstanceOf(RecordDecodeError);
    expect(err!.message).not.toContain('SECRET');
    expect(() => registry.byKind('verse_link')!.decode({ source_type: 'bookmark', source_id: 'a'.repeat(32) }, side.ctx)).toThrow(RecordDecodeError);
  });
});

describe('rows that never sync', () => {
  it('honours the registry skipInMerge predicate', () => {
    const side = makeSide(mulberry32(1), MODS_A);
    side.db.execute("INSERT INTO user_note (content, title) VALUES ('a', 'skip me')");
    side.db.execute("INSERT INTO user_note (content, title) VALUES ('b', 'keep me')");
    const spec = { ...tableSpec('user_note')!, skipInMerge: (r: Record<string, unknown>) => r.title === 'skip me' };
    const codec = createTableCodec(spec);
    expect(codec.encode('1', side.ctx)).toBeNull();
    expect(codec.encode('2', side.ctx)).not.toBeNull();
  });

  it('does not sync tables with a skipInMerge rule (they are not tracked)', () => {
    const tracked = new Set(coreTrackedTables().map((t) => t.table));
    for (const s of USER_TABLES) if (s.skipInMerge) expect(tracked.has(s.name), s.name).toBe(false);
  });

  it('never encodes the default-commentary flag, and never decodes one', () => {
    const side = makeSide(mulberry32(1), MODS_A);
    side.db.execute("INSERT INTO user_commentary (name, is_default) VALUES ('Mine', 1)");
    const codec = registry.byKind('user_commentary')!;
    const d = codec.encode('1', side.ctx)!;
    expect('is_default' in d).toBe(false);
    const r = codec.decode({ ...d, is_default: 1 }, side.ctx);
    expect(r.ok && 'is_default' in r.row).toBe(false);
    expect(() => codec.upsert({ name: 'x', is_default: 1 }, undefined, side.ctx)).toThrow();
  });

  it('skips a row whose parent does not exist (and nulls an optional one)', () => {
    const side = makeSide(mulberry32(1), MODS_A);
    side.db.execute('PRAGMA foreign_keys = OFF');
    side.db.execute("INSERT INTO prayer_update (prayer_id, update_text) VALUES (404, 'orphan')");
    side.db.execute("INSERT INTO user_note (content, parent_note_id) VALUES ('n', 404)");
    expect(registry.byKind('prayer_update')!.encode('1', side.ctx)).toBeNull();
    expect(registry.byKind('user_note')!.encode('1', side.ctx)!.parent_note_id).toBeNull();
  });
});

describe('natural keys', () => {
  const nk = (kind: string, d: Record<string, unknown>) => registry.byKind(kind)!.naturalKey?.(d);
  const R1 = '1'.repeat(32);
  it('derives the documented scopes', () => {
    expect(nk('ext.kv', { ext: 'e', key: 'k', value: '1', updatedAt: 1 })).toEqual({ scope: 'ext.kv', key: `e${US}k` });
    expect(nk('user_reading_progress', { plan_id: R1, start_date: '2026-01-01' }))
      .toEqual({ scope: 'user_reading_progress', key: `${R1}${US}2026-01-01` });
    expect(nk('user_data_item', { owner_uuid: 'o', collection: 'c', item_key: 'k' }))
      .toEqual({ scope: 'user_data_item', key: `o${US}c${US}k` });
    expect(nk('memory_setting', { key: 'sort', value: 'x' })).toEqual({ scope: 'memory_setting', key: 'sort' });
    expect(nk('memory_resume_state', { card_id: R1 })).toEqual({ scope: 'memory_resume_state', key: R1 });
    expect(nk('memory_recite_detail', { attempt_id: R1 })).toEqual({ scope: 'memory_recite_detail', key: R1 });
    expect(nk('memory_passage', { collection_id: R1, module_id: 'KJV', start_verse_id: 1, end_verse_id: 2 }))
      .toEqual({ scope: 'memory_passage', key: `${R1}${US}KJV${US}1${US}2` });
    expect(nk('memory_card', { passage_id: R1, rung: 'a' })).toEqual({ scope: 'memory_card', key: `${R1}${US}a` });
    expect(nk('reading_plan_day', { plan_id: R1, day_number: 3 })).toEqual({ scope: 'reading_plan_day', key: `${R1}${US}3` });
  });
  it('is absent for random-id tables and null for incomplete payloads', () => {
    for (const k of ['user_note', 'collection', 'verse_link', 'prayer_item']) expect(registry.byKind(k)!.naturalKey).toBeUndefined();
    expect(nk('user_reading_progress', { plan_id: R1 })).toBeNull();
    expect(nk('ext.kv', { ext: 1 })).toBeNull();
  });
});

describe('upsert / remove', () => {
  it('inserts, updates, adopts a unique collision, and re-creates a locally deleted row', () => {
    const side = makeSide(mulberry32(1), MODS_A);
    const notes = registry.byKind('user_note')!;
    const key = notes.upsert({ content: 'one', title: 't' }, undefined, side.ctx);
    expect(side.db.queryOne<{ content: string }>('SELECT content FROM user_note WHERE note_id = ?', [key])!.content).toBe('one');
    expect(notes.upsert({ content: 'two' }, key, side.ctx)).toBe(key);
    expect(side.db.queryOne<{ content: string; title: string }>('SELECT content, title FROM user_note WHERE note_id = ?', [key])).toEqual({ content: 'two', title: 't' });
    notes.remove(key, side.ctx);
    expect(notes.upsert({ content: 'again' }, key, side.ctx)).toBe(key);
    expect(side.db.queryOne<{ content: string }>('SELECT content FROM user_note WHERE note_id = ?', [key])!.content).toBe('again');

    const items = registry.byKind('user_data_item')!;
    const row = { owner_uuid: 'o', collection: 'c', item_key: 'k', value: 'v1', value_type: 'string' };
    const first = items.upsert(row, undefined, side.ctx);
    const second = items.upsert({ ...row, value: 'v2' }, undefined, side.ctx); // would violate UNIQUE: adopted instead
    expect(second).toBe(first);
    expect(side.db.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM user_data_item')!.n).toBe(1);

    const kv = registry.byKind('ext.kv')!;
    expect(kv.upsert({ extension_id: 'e', key: `a${US}b`, value: '1', updated_at: 5 }, undefined, side.ctx)).toBe(`e${US}a${US}b`);
    kv.upsert({ extension_id: 'e', key: `a${US}b`, value: '2', updated_at: 6 }, undefined, side.ctx);
    expect(side.db.queryAll('SELECT * FROM extension_storage')).toEqual([{ extension_id: 'e', key: `a${US}b`, value: '2', updated_at: 6 }]);
    kv.remove(`e${US}a${US}b`, side.ctx);
    expect(side.db.queryAll('SELECT * FROM extension_storage')).toEqual([]);
  });

  it('lets FK cascades act on remove', () => {
    const side = makeSide(mulberry32(1), MODS_A);
    side.db.execute("INSERT INTO user_note (content) VALUES ('n')");
    side.db.execute('INSERT INTO note_verse_link (note_id, verse_id_start, verse_id_end) VALUES (1, 1, 1)');
    side.tracker.applyRemote(() => registry.byKind('user_note')!.remove('1', side.ctx));
    expect(side.db.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM note_verse_link')!.n).toBe(0);
  });

  it('upserts non-autoincrement keyed rows (memory_setting) by their own key', () => {
    const side = makeSide(mulberry32(1), MODS_A);
    const c = registry.byKind('memory_setting')!;
    expect(c.upsert({ key: 'k', value: 'a' }, undefined, side.ctx)).toBe('k');
    expect(c.upsert({ key: 'k', value: 'b' }, undefined, side.ctx)).toBe('k');
    expect(side.db.queryAll('SELECT * FROM memory_setting')).toEqual([{ key: 'k', value: 'b' }]);
  });
});

describe('hostile records', () => {
  it('cannot write a column that is not in the registry spec', () => {
    const side = makeSide(mulberry32(1), MODS_A);
    const evilCol = 'content") VALUES (1); DROP TABLE user_note; --';
    const codec = registry.byKind('user_note')!;
    const r = codec.decode({
      content: 'hi', note_id: 12345, evil: 'x', sqlite_master: 1, [evilCol]: 'x', is_default: 1, __proto__x: 1,
    } as Record<string, unknown>, side.ctx);
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.row)).toEqual(['content']);
    // upsert enforces the same whitelist on its own, for a row that did not come from decode
    for (const bad of [{ content: 'x', evil: 1 }, { content: 'x', note_id: 12345 }, { [evilCol]: 'x' }]) {
      expect(() => codec.upsert(bad, undefined, side.ctx)).toThrow(/not writable/);
    }
    expect(side.db.queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'user_note'")!.n).toBe(1);
    expect(side.db.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM user_note')!.n).toBe(0);
  });

  it('cannot reach another table or a local-only column through ext.kv', () => {
    const side = makeSide(mulberry32(1), MODS_A);
    const kv = registry.byKind('ext.kv')!;
    expect(() => kv.decode({ ext: 'e', key: 'k', value: 'v', updatedAt: 'now' }, side.ctx)).toThrow(RecordDecodeError);
    expect(() => kv.decode({ ext: `e${US}x`, key: 'k', value: 'v', updatedAt: 1 }, side.ctx)).toThrow(RecordDecodeError);
  });
});
