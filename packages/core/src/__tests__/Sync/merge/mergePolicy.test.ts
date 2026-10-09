import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  lwwPolicy, appendOnlyPolicy, fieldLwwPolicy, fieldLwwWithBodyCopy, policyFor, mergeOutcomeFor, knownPolicyTypes,
  bindConflictLink, CONFLICT_WINNER_PLACEHOLDER, CONFLICT_LINK_FIELD,
} from '../../../Sync/merge/MergePolicy';
import type { MergeOutcome, MergePolicy, Version } from '../../../Sync/merge/MergePolicy';
import type { RecordType } from '../../../Sync/types';
import { USER_TABLES } from '../../../Backup/Registry';
import { canonicalJson } from '../../../Sync/merge/canonical';

const DA = '00000000000000aa';
const DB = '00000000000000bb';
const hlc = (ms: number, dev: string, counter = 0): string =>
  `${ms.toString(16).padStart(12, '0')}:${counter.toString(16).padStart(4, '0')}:${dev}`;
const live = (d: Record<string, unknown>, h: string): Version => ({ d, h, deleted: false });
const dead = (h: string): Version => ({ d: {}, h, deleted: true });
const RID = '0123456789abcdef0123456789abcdef';

/** The state a device ends up with after applying an outcome (record content + any conflicted copy). */
function resolve(o: MergeOutcome, local: Version, remote: Version): { deleted: boolean; d: string; copy: string | null } {
  const state = (v: Version): { deleted: boolean; d: string } => ({ deleted: v.deleted, d: v.deleted ? '' : canonicalJson(v.d) });
  switch (o.kind) {
    case 'takeRemote': return { ...state(remote), copy: null };
    case 'keepLocal': return { ...state(local), copy: null };
    case 'merged': return { deleted: false, d: canonicalJson(o.d), copy: null };
    case 'conflictCopy': {
      const winner = o.winner === 'local' ? local : remote;
      return { deleted: false, d: canonicalJson(o.d ?? winner.d), copy: canonicalJson(o.copy) };
    }
  }
}

// --- generators: tiny value domains so equal / base-equal fields are common ----------------------------------
const FIELDS = ['title', 'tags', 'content', 'content_format', 'description', 'update_text', 'is_encrypted', 'bn',
  'mtime', 'metadata', 'completed_days', 'current_day', 'progress_reset_at', 'value', 'sort_order'] as const;
const value = fc.constantFrom<unknown>(null, 'x', 'y', 1, 2, '[1,2]', '[2,3]', [1], '{"a":1}');
const dGen = fc.record(Object.fromEntries(FIELDS.map((f) => [f, value])) as Record<string, fc.Arbitrary<unknown>>, { requiredKeys: [] });
const hGen = fc.oneof(
  fc.tuple(fc.integer({ min: 1, max: 4 }), fc.constantFrom(DA, DB, 'cccccccccccccccc'), fc.integer({ min: 0, max: 1 }))
    .map(([ms, dev, c]) => hlc(ms, dev, c)),
  fc.constant(''),
);
const versionGen: fc.Arbitrary<Version> = fc.tuple(dGen, hGen, fc.boolean())
  .map(([d, h, deleted]) => (deleted ? { d: {}, h, deleted } : { d, h: h === '' ? hlc(1, DA) : h, deleted }));
/** base is often one of the sides' ancestors: share fields with them. */
const triple = fc.tuple(versionGen, versionGen, fc.option(versionGen, { nil: null }), fc.integer({ min: 0, max: 3 }))
  .map(([l, r, b, mix]) => {
    if (!b || b.deleted || l.deleted || r.deleted || mix === 0) return [l, r, b] as const;
    // Make the base agree with the local side on some fields and with the remote side on others.
    const d: Record<string, unknown> = { ...b.d };
    FIELDS.forEach((f, i) => {
      const src = (i + mix) % 3 === 0 ? l.d : (i + mix) % 3 === 1 ? r.d : b.d;
      if (src[f] === undefined) delete d[f]; else d[f] = src[f];
    });
    return [l, r, { ...b, d }] as const;
  });

const ALL_RECORD_TYPES: RecordType[] = [
  'user_commentary', 'user_note', 'note_verse_link', 'content_verse_link', 'verse_link', 'user_text_markup',
  'user_cross_reference', 'collection', 'pinned_item', 'reading_plan', 'reading_plan_day', 'reading_plan_passage',
  'user_reading_progress', 'prayer_item', 'prayer_update', 'journal_entry', 'user_data_item', 'ext.kv', 'ext.db', 'bn.file',
];
const MEMORY_TYPES = ['memory_collection', 'memory_passage', 'memory_card', 'memory_attempt', 'memory_recite_detail',
  'memory_setting', 'memory_resume_state'];

const policies: Array<[string, MergePolicy]> = [
  ...[...ALL_RECORD_TYPES, ...MEMORY_TYPES].map((t) => [t, policyFor(t)] as [string, MergePolicy]),
  ['ext.db/appendOnly', policyFor('ext.db', { merge: 'appendOnly' })],
];

describe('policyFor', () => {
  it('maps every RecordType and every synced memory table explicitly', () => {
    const known = new Set(knownPolicyTypes());
    for (const t of [...ALL_RECORD_TYPES, ...MEMORY_TYPES]) expect(known.has(t), t).toBe(true);
    // Every synced registry table (content class + synced workspace tables) has an entry.
    for (const spec of USER_TABLES) {
      if (spec.cls === 'content') expect(known.has(spec.name), spec.name).toBe(true);
    }
  });

  it('follows the design table', () => {
    for (const t of ['user_text_markup', 'user_cross_reference', 'verse_link', 'note_verse_link', 'content_verse_link',
      'collection', 'pinned_item', 'ext.kv', 'user_data_item', 'reading_plan_day']) {
      expect(policyFor(t), t).toBe(lwwPolicy);
    }
    for (const t of ['user_note', 'prayer_item', 'journal_entry']) {
      expect((policyFor(t) as { linkField?: string }).linkField, t).toBe(CONFLICT_LINK_FIELD);
    }
    expect(policyFor('memory_attempt')).toBe(appendOnlyPolicy);
    expect(policyFor('ext.db')).toBe(lwwPolicy);
    expect(policyFor('ext.db', { merge: 'appendOnly' })).toBe(appendOnlyPolicy);
    expect(policyFor('some.future.type')).toBe(lwwPolicy);
  });
});

describe('determinism and symmetry (property, every policy)', () => {
  for (const [name, policy] of policies) {
    it(name, () => {
      fc.assert(fc.property(triple, ([a, b, base]) => {
        const onA = policy.merge(a, b, base);
        const onB = policy.merge(b, a, base);
        // Deterministic.
        expect(policy.merge(a, b, base)).toEqual(onA);
        // Both devices end up with the same record content and the same conflicted copy.
        expect(resolve(onA, a, b)).toEqual(resolve(onB, b, a));
        // Labels mirror each other.
        const mirror: Record<string, string> = { takeRemote: 'keepLocal', keepLocal: 'takeRemote', merged: 'merged', conflictCopy: 'conflictCopy' };
        if (!(onA.kind === 'takeRemote' && onB.kind === 'takeRemote')) expect(onB.kind).toBe(mirror[onA.kind]);
        if (onA.kind === 'conflictCopy' && onB.kind === 'conflictCopy') expect(onB.winner).not.toBe(onA.winner);
      }), { numRuns: 400 });
    });
  }
});

describe('lwwPolicy: delete vs edit', () => {
  const edit = (ms: number, dev = DA) => live({ color: 'red', ms }, hlc(ms, dev));

  it('higher HLC wins between edits', () => {
    expect(lwwPolicy.merge(edit(5), edit(3, DB), null)).toEqual({ kind: 'keepLocal' });
    expect(lwwPolicy.merge(edit(3), edit(5, DB), null)).toEqual({ kind: 'takeRemote' });
    // Same ms: the counter, then the device id decides.
    expect(lwwPolicy.merge(live({ c: 1 }, hlc(5, DA, 1)), live({ c: 2 }, hlc(5, DB, 0)), null).kind).toBe('keepLocal');
    expect(lwwPolicy.merge(live({ c: 1 }, hlc(5, DA)), live({ c: 2 }, hlc(5, DB)), null).kind).toBe('takeRemote');
  });

  it('a delete beats an older edit', () => {
    expect(lwwPolicy.merge(dead(hlc(9, DA)), edit(5, DB), null)).toEqual({ kind: 'keepLocal' });
    expect(lwwPolicy.merge(edit(5), dead(hlc(9, DB)), null)).toEqual({ kind: 'takeRemote' });
  });

  it('an edit newer than the delete resurrects the record', () => {
    expect(lwwPolicy.merge(edit(9), dead(hlc(5, DB)), null)).toEqual({ kind: 'keepLocal' });
    expect(lwwPolicy.merge(dead(hlc(5, DA)), edit(9, DB), null)).toEqual({ kind: 'takeRemote' });
  });

  it('a tombstone of unknown time (h "") never beats an edit', () => {
    expect(lwwPolicy.merge(edit(1), dead(''), null)).toEqual({ kind: 'keepLocal' });
    expect(lwwPolicy.merge(dead(''), edit(1, DB), null)).toEqual({ kind: 'takeRemote' });
  });

  it('both deleted, or equal content: take the remote and stop', () => {
    expect(lwwPolicy.merge(dead(hlc(9, DA)), dead(''), null)).toEqual({ kind: 'takeRemote' });
    expect(lwwPolicy.merge(edit(9), live({ ms: 9, color: 'red' }, hlc(3, DB)), null)).toEqual({ kind: 'takeRemote' });
  });

  it('note-like policies follow the same delete rules', () => {
    const p = policyFor('user_note');
    const note = (ms: number, dev: string) => live({ title: 't', content: 'c' + ms }, hlc(ms, dev));
    expect(p.merge(dead(hlc(9, DA)), note(5, DB), null)).toEqual({ kind: 'keepLocal' });
    expect(p.merge(note(9, DA), dead(hlc(5, DB)), null)).toEqual({ kind: 'keepLocal' });
    expect(p.merge(note(1, DA), dead(''), null)).toEqual({ kind: 'keepLocal' });
  });
});

describe('note body: both changed -> newer wins + conflicted copy', () => {
  const base = live({ title: 'T', tags: 'a', content: '<p>base</p>', content_format: 'html', metadata: '{"pinned":true}' }, hlc(1, DA));

  it('keeps the newer body and returns the other as a linked copy', () => {
    const local = live({ ...base.d, content: '<p>local</p>' }, hlc(5, DA));
    const remote = live({ ...base.d, content: '<p>remote</p>' }, hlc(7, DB));
    const o = mergeOutcomeFor('user_note', local, remote, base, { recordId: RID });
    expect(o.kind).toBe('conflictCopy');
    if (o.kind !== 'conflictCopy') return;
    expect(o.winner).toBe('remote');
    expect(o.d).toBeUndefined(); // the remote stands as is
    expect(o.copy.content).toBe('<p>local</p>');
    expect(o.copy.title).toBe('T');
    expect(JSON.parse(o.copy.metadata as string)).toEqual({ pinned: true, conflictOf: RID });

    // The other device (roles swapped) keeps its own body and saves the same copy.
    const other = mergeOutcomeFor('user_note', remote, local, base, { recordId: RID });
    expect(other).toEqual({ kind: 'conflictCopy', winner: 'local', copy: o.copy });
  });

  it('merges metadata into the winner while copying the losing body', () => {
    const local = live({ ...base.d, content: '<p>local</p>', title: 'New title' }, hlc(9, DA));
    const remote = live({ ...base.d, content: '<p>remote</p>', tags: 'a,b' }, hlc(7, DB));
    const o = mergeOutcomeFor('user_note', local, remote, base, { recordId: RID });
    expect(o).toMatchObject({ kind: 'conflictCopy', winner: 'local' });
    if (o.kind !== 'conflictCopy') return;
    expect(o.d).toEqual({ ...base.d, content: '<p>local</p>', title: 'New title', tags: 'a,b' });
    expect(o.copy).toMatchObject({ content: '<p>remote</p>', tags: 'a,b', title: 'T' });
  });

  it('body changed on one side only: no copy', () => {
    const local = live({ ...base.d, title: 'Renamed' }, hlc(9, DA));
    const remote = live({ ...base.d, content: '<p>remote</p>' }, hlc(7, DB));
    expect(policyFor('user_note').merge(local, remote, base))
      .toEqual({ kind: 'merged', d: { ...base.d, title: 'Renamed', content: '<p>remote</p>' } });
  });

  it('content and content_format travel together', () => {
    const local = live({ ...base.d, content_format: 'markdown', content: '# md' }, hlc(9, DA));
    const remote = live({ ...base.d, title: 'X' }, hlc(7, DB));
    const o = policyFor('user_note').merge(local, remote, base);
    expect(o).toEqual({ kind: 'merged', d: { ...base.d, title: 'X', content_format: 'markdown', content: '# md' } });
  });

  it('both changed to the same body: no copy', () => {
    const local = live({ ...base.d, content: 'same', title: 'L' }, hlc(9, DA));
    const remote = live({ ...base.d, content: 'same' }, hlc(7, DB));
    expect(policyFor('user_note').merge(local, remote, base)).toEqual({ kind: 'keepLocal' });
  });

  it('no base: differing bodies always give a copy (no silent loss)', () => {
    const o = policyFor('journal_entry').merge(live({ content: 'a' }, hlc(2, DA)), live({ content: 'b' }, hlc(3, DB)), null);
    expect(o).toEqual({ kind: 'conflictCopy', winner: 'remote', copy: { content: 'a', metadata: `{"conflictOf":"${CONFLICT_WINNER_PLACEHOLDER}"}` } });
  });

  it('the placeholder is bound for every note-like type', () => {
    for (const t of ['user_note', 'prayer_item', 'prayer_update', 'journal_entry', 'bn.file']) {
      const body = { user_note: 'content', prayer_item: 'description', prayer_update: 'update_text', journal_entry: 'content', 'bn.file': 'bn' }[t] as string;
      const o = mergeOutcomeFor(t, live({ [body]: 'L' }, hlc(2, DA)), live({ [body]: 'R' }, hlc(3, DB)), live({ [body]: 'B' }, hlc(1, DA)), { recordId: RID });
      expect(o.kind, t).toBe('conflictCopy');
      expect(canonicalJson(o)).not.toContain(CONFLICT_WINNER_PLACEHOLDER);
      expect(canonicalJson(o)).toContain(RID);
    }
  });

  it('fieldLwwWithBodyCopy validates its arguments and exposes them', () => {
    expect(() => fieldLwwWithBodyCopy([], 'x')).toThrow();
    expect(() => fieldLwwWithBodyCopy(['content'], '')).toThrow();
    expect(fieldLwwWithBodyCopy(['content'], 'conflictOf')).toMatchObject({ bodyFields: ['content'], linkField: 'conflictOf' });
  });
});

describe('per-field metadata merge (3-way)', () => {
  const p = fieldLwwPolicy();
  const base = live({ name: 'N', color: 'red', icon: 'star', note: 'n' }, hlc(1, DA));

  it('a field changed on one side takes that side, whichever is newer', () => {
    const local = live({ ...base.d, name: 'Local name' }, hlc(2, DA));
    const remote = live({ ...base.d, color: 'blue' }, hlc(9, DB));
    expect(p.merge(local, remote, base)).toEqual({ kind: 'merged', d: { ...base.d, name: 'Local name', color: 'blue' } });
  });

  it('a field changed on both sides takes the newer side', () => {
    const local = live({ ...base.d, name: 'L', icon: 'moon' }, hlc(2, DA));
    const remote = live({ ...base.d, name: 'R' }, hlc(9, DB));
    expect(p.merge(local, remote, base)).toEqual({ kind: 'merged', d: { ...base.d, name: 'R', icon: 'moon' } });
  });

  it('removed and added fields', () => {
    const { note: _n, ...withoutNote } = base.d;
    const local = live(withoutNote, hlc(2, DA));
    const remote = live({ ...base.d, extra: 1 }, hlc(9, DB));
    expect(p.merge(local, remote, base)).toEqual({ kind: 'merged', d: { ...withoutNote, extra: 1 } });
  });

  it('result equal to one side is reported as that side', () => {
    const local = live({ ...base.d, name: 'L' }, hlc(2, DA));
    expect(p.merge(local, base, base)).toEqual({ kind: 'keepLocal' });
    expect(p.merge(base, local, base)).toEqual({ kind: 'takeRemote' });
  });

  it('reading progress: completed days merge as a set (mark and unmark both work)', () => {
    const rp = policyFor('user_reading_progress');
    const b = live({ completed_days: '[1,2,3]', current_day: 4 }, hlc(1, DA));
    const l = live({ completed_days: '[1,2,3,4]', current_day: 5 }, hlc(2, DA)); // marked 4
    const r = live({ completed_days: '[1,3,7]', current_day: 8 }, hlc(3, DB));  // unmarked 2, marked 7
    expect(rp.merge(l, r, b)).toEqual({ kind: 'merged', d: { completed_days: '[1,3,4,7]', current_day: 8 } });
  });

  it('memory card: the later progress reset wins regardless of HLC', () => {
    const mp = policyFor('memory_card');
    const b = live({ state: 'learning', progress_reset_at: 100 }, hlc(1, DA));
    const l = live({ state: 'learning', progress_reset_at: 500 }, hlc(2, DA));
    const r = live({ state: 'review', progress_reset_at: 300 }, hlc(3, DB));
    expect(mp.merge(l, r, b)).toEqual({ kind: 'merged', d: { state: 'review', progress_reset_at: 500 } });
  });
});

describe('appendOnly never loses a row', () => {
  it('two live versions always yield a live row equal to the first write (property)', () => {
    const liveGen = fc.tuple(dGen, hGen.filter((h) => h !== '')).map(([d, h]) => live(d, h));
    fc.assert(fc.property(liveGen, liveGen, fc.option(versionGen, { nil: null }), (a, b, base) => {
      const o = appendOnlyPolicy.merge(a, b, base);
      expect(['takeRemote', 'keepLocal']).toContain(o.kind);
      const kept = o.kind === 'keepLocal' ? a : b;
      expect(kept.deleted).toBe(false);
      const first = a.h < b.h ? a : b.h < a.h ? b : null;
      if (first) expect(canonicalJson(kept.d)).toBe(canonicalJson(first.d));
    }), { numRuns: 500 });
  });

  it('a tombstone of unknown time never removes a row', () => {
    const row = live({ card_id: 'c', score: 1 }, hlc(3, DA));
    expect(appendOnlyPolicy.merge(row, dead(''), null)).toEqual({ kind: 'keepLocal' });
    expect(appendOnlyPolicy.merge(dead(''), row, null)).toEqual({ kind: 'takeRemote' });
  });

  it('two devices logging attempts end with the union (property)', () => {
    const rowsGen = fc.array(fc.tuple(fc.integer({ min: 0, max: 30 }), fc.integer({ min: 1, max: 9 }), dGen), { maxLength: 30 });
    fc.assert(fc.property(rowsGen, rowsGen, (rowsA, rowsB) => {
      const devA = new Map<number, Version>();
      const devB = new Map<number, Version>();
      for (const [id, ms, d] of rowsA) if (!devA.has(id)) devA.set(id, live(d, hlc(ms, DA)));
      for (const [id, ms, d] of rowsB) if (!devB.has(id)) devB.set(id, live(d, hlc(ms, DB)));
      // Sync both ways through the policy.
      const merged = new Map<number, Version>(devB);
      for (const [id, v] of devA) {
        const remote = merged.get(id);
        if (!remote) { merged.set(id, v); continue; }
        const o = policyFor('memory_attempt').merge(v, remote, null);
        merged.set(id, o.kind === 'keepLocal' ? v : remote);
      }
      for (const id of new Set([...devA.keys(), ...devB.keys()])) {
        expect(merged.get(id)?.deleted).toBe(false);
      }
      expect(merged.size).toBe(new Set([...devA.keys(), ...devB.keys()]).size);
    }), { numRuns: 200 });
  });
});

describe('bindConflictLink', () => {
  it('writes top-level and JSON-column links', () => {
    expect(bindConflictLink({ a: 1 }, 'conflictOf', RID)).toEqual({ a: 1, conflictOf: RID });
    expect(bindConflictLink({ metadata: null }, 'metadata.conflictOf', RID)).toEqual({ metadata: `{"conflictOf":"${RID}"}` });
    expect(bindConflictLink({ metadata: '{"x":1}' }, 'metadata.conflictOf', RID)).toEqual({ metadata: `{"x":1,"conflictOf":"${RID}"}` });
    expect(bindConflictLink({ metadata: { x: 1 } }, 'metadata.conflictOf', RID)).toEqual({ metadata: { x: 1, conflictOf: RID } });
    expect(bindConflictLink({ metadata: 'not json' }, 'metadata.conflictOf', RID)).toEqual({ metadata: `{"conflictOf":"${RID}"}` });
  });
});
