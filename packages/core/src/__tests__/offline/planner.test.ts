import { describe, it, expect } from 'vitest';
import { planPack } from '../../offline/PackPlanner';
import { packKey } from '../../offline/PackTypes';
import type { PackItemRef, PackOffer } from '../../offline/PackTypes';

const ref = (id: string): PackItemRef => ({ kind: 'module', id });

function offer(id: string, o: Partial<PackOffer> & { req?: string[] } = {}): PackOffer {
  const r = ref(id);
  const { req, ...rest } = o;
  return {
    ref: r,
    key: packKey(r),
    title: id,
    group: 'bible',
    version: '1',
    downloadBytes: 10,
    storedBytes: 20,
    offlineReadable: true,
    status: 'absent',
    ...(req ? { requires: req.map(ref) } : {}),
    ...rest,
  };
}

const keys = (p: ReturnType<typeof planPack>) => p.steps.map((s) => s.key);
const codes = (p: ReturnType<typeof planPack>) => p.warnings.map((w) => w.code);

describe('planPack', () => {
  it('plans nothing for an empty request', () => {
    const p = planPack({ items: [], offers: [offer('a')], freeBytes: 100 });
    expect(p).toMatchObject({ steps: [], present: [], skipped: [], downloadBytes: 0, newStoredBytes: 0, peakBytes: 0, fit: 'fits', shortfallBytes: 0, warnings: [] });
  });

  it('empty plan with unknown free space is unknown', () => {
    const p = planPack({ items: [], offers: [], freeBytes: null });
    expect(p.fit).toBe('unknown');
    expect(codes(p)).toEqual(['quota-unknown']);
  });

  it('lists installed items as present without steps', () => {
    const p = planPack({ items: [ref('a'), ref('b')], offers: [offer('a', { status: 'installed' }), offer('b', { status: 'installed' })], freeBytes: 0 });
    expect(p.steps).toEqual([]);
    expect(p.present).toEqual(['module:a', 'module:b']);
    expect(p.fit).toBe('fits');
  });

  it('maps statuses to actions', () => {
    const p = planPack({
      items: [ref('a'), ref('b'), ref('c')],
      offers: [offer('a'), offer('b', { status: 'update-available' }), offer('c', { status: 'installing' })],
      freeBytes: 1000,
    });
    expect(Object.fromEntries(p.steps.map((s) => [s.key, s.action]))).toEqual({
      'module:a': 'install',
      'module:b': 'update',
      'module:c': 'install',
    });
  });

  it('orders a diamond dependency first and sets after', () => {
    const offers = [
      offer('top', { req: ['left', 'right'], downloadBytes: 1 }),
      offer('left', { req: ['base'], downloadBytes: 5 }),
      offer('right', { req: ['base'], downloadBytes: 3 }),
      offer('base', { downloadBytes: 100 }),
    ];
    const p = planPack({ items: [ref('top')], offers, freeBytes: null });
    expect(keys(p)).toEqual(['module:base', 'module:right', 'module:left', 'module:top']);
    expect(p.steps.find((s) => s.key === 'module:top')!.after).toEqual(['module:left', 'module:right']);
    expect(p.steps.find((s) => s.key === 'module:left')!.after).toEqual(['module:base']);
    expect(p.warnings.filter((w) => w.code === 'dependency-added')).toHaveLength(3);
  });

  it('orders ready steps smallest download first, ties by key', () => {
    const offers = [offer('c', { downloadBytes: 5 }), offer('b', { downloadBytes: 5 }), offer('a', { downloadBytes: 50 })];
    const p = planPack({ items: [ref('a'), ref('b'), ref('c')], offers, freeBytes: null });
    expect(keys(p)).toEqual(['module:b', 'module:c', 'module:a']);
  });

  it('is stable regardless of input order', () => {
    const offers = [offer('a', { req: ['d'] }), offer('b'), offer('c', { req: ['a'] }), offer('d')];
    const items = [ref('a'), ref('b'), ref('c'), ref('zz')];
    const one = planPack({ items, offers, freeBytes: 500 });
    const two = planPack({ items: [...items].reverse(), offers: [...offers].reverse(), freeBytes: 500 });
    expect(two).toEqual(one);
  });

  it('dedupes case-insensitively', () => {
    const p = planPack({ items: [ref('KJV'), ref('kjv'), ref('Kjv')], offers: [offer('kjv')], freeBytes: 100 });
    expect(keys(p)).toEqual(['module:kjv']);
  });

  it('warns dependency-added with the dependent', () => {
    const p = planPack({ items: [ref('voice')], offers: [offer('voice', { req: ['runtime'] }), offer('runtime')], freeBytes: null });
    expect(p.warnings).toContainEqual({ code: 'dependency-added', key: 'module:runtime', for: 'module:voice' });
  });

  it('does not warn dependency-added when the dependency was requested', () => {
    const p = planPack({ items: [ref('voice'), ref('runtime')], offers: [offer('voice', { req: ['runtime'] }), offer('runtime')], freeBytes: null });
    expect(codes(p)).not.toContain('dependency-added');
  });

  it('treats an installed dependency as satisfied', () => {
    const p = planPack({ items: [ref('voice')], offers: [offer('voice', { req: ['runtime'] }), offer('runtime', { status: 'installed' })], freeBytes: null });
    expect(keys(p)).toEqual(['module:voice']);
    expect(p.present).toEqual(['module:runtime']);
    expect(p.steps[0].after).toEqual([]);
    expect(codes(p)).not.toContain('dependency-added');
  });

  it('warns on a missing dependency but still plans the dependent', () => {
    const p = planPack({ items: [ref('a')], offers: [offer('a', { req: ['gone'] })], freeBytes: null });
    expect(keys(p)).toEqual(['module:a']);
    expect(p.warnings).toContainEqual({ code: 'missing-dependency', key: 'module:a', requires: 'module:gone' });
  });

  it('reports a cycle once and plans its members in key order', () => {
    const offers = [offer('b', { req: ['a'], downloadBytes: 1 }), offer('a', { req: ['c'], downloadBytes: 9 }), offer('c', { req: ['b'], downloadBytes: 5 })];
    const p = planPack({ items: [ref('a')], offers, freeBytes: null });
    expect(p.warnings.filter((w) => w.code === 'cycle')).toEqual([{ code: 'cycle', keys: ['module:a', 'module:b', 'module:c'] }]);
    expect(keys(p)).toEqual(['module:a', 'module:b', 'module:c']);
  });

  it('puts a cycle after its outside dependencies', () => {
    const offers = [offer('a', { req: ['b', 'base'] }), offer('b', { req: ['a'] }), offer('base', { downloadBytes: 500 })];
    const p = planPack({ items: [ref('a')], offers, freeBytes: null });
    expect(keys(p)).toEqual(['module:base', 'module:a', 'module:b']);
  });

  it('drops unavailable refs with a warning', () => {
    const p = planPack({ items: [ref('a'), ref('nope')], offers: [offer('a')], freeBytes: null });
    expect(p.skipped).toEqual(['module:nope']);
    expect(p.warnings).toContainEqual({ code: 'unavailable', key: 'module:nope' });
    expect(keys(p)).toEqual(['module:a']);
  });

  it('warns not-readable-offline but still plans', () => {
    const p = planPack({ items: [ref('dict')], offers: [offer('dict', { offlineReadable: false })], freeBytes: null });
    expect(keys(p)).toEqual(['module:dict']);
    expect(p.warnings).toContainEqual({ code: 'not-readable-offline', key: 'module:dict' });
  });

  it('does not warn not-readable-offline for an added dependency', () => {
    const p = planPack({ items: [ref('a')], offers: [offer('a', { req: ['d'] }), offer('d', { offlineReadable: false })], freeBytes: null });
    expect(codes(p)).not.toContain('not-readable-offline');
  });

  describe('bytes', () => {
    it('sums download and stored bytes for installs', () => {
      const p = planPack({ items: [ref('a'), ref('b')], offers: [offer('a', { downloadBytes: 10, storedBytes: 30 }), offer('b', { downloadBytes: 20, storedBytes: 50 })], freeBytes: null, concurrency: 1 });
      expect(p.downloadBytes).toBe(30);
      expect(p.newStoredBytes).toBe(80);
      expect(p.peakBytes).toBe(80 + 20);
    });

    it('counts only growth for updates and the old copy in the peak', () => {
      const p = planPack({ items: [ref('a')], offers: [offer('a', { status: 'update-available', downloadBytes: 10, storedBytes: 100, installedStoredBytes: 60 })], freeBytes: null });
      expect(p.newStoredBytes).toBe(40);
      expect(p.peakBytes).toBe(40 + 100 + 10);
    });

    it('never lets an update delta go negative', () => {
      const p = planPack({ items: [ref('a')], offers: [offer('a', { status: 'update-available', downloadBytes: 5, storedBytes: 40, installedStoredBytes: 90 })], freeBytes: null });
      expect(p.newStoredBytes).toBe(0);
      expect(p.peakBytes).toBe(0 + 40 + 5);
    });

    it('treats a missing installedStoredBytes as zero', () => {
      const p = planPack({ items: [ref('a')], offers: [offer('a', { status: 'update-available', storedBytes: 40 })], freeBytes: null });
      expect(p.newStoredBytes).toBe(40);
    });

    it('sizes in-flight partials by the largest N downloads', () => {
      const offers = [1, 2, 3, 4].map((n) => offer(`m${n}`, { downloadBytes: n * 10, storedBytes: 0 }));
      const items = offers.map((o) => o.ref);
      expect(planPack({ items, offers, freeBytes: null }).peakBytes).toBe(40 + 30);
      expect(planPack({ items, offers, freeBytes: null, concurrency: 3 }).peakBytes).toBe(40 + 30 + 20);
      expect(planPack({ items, offers, freeBytes: null, concurrency: 99 }).peakBytes).toBe(100);
    });
  });

  describe('fit', () => {
    // one install: stored 100, download 40 -> peak 140
    const one = [offer('a', { downloadBytes: 40, storedBytes: 100 })];
    const run = (freeBytes: number | null, reserveBytes?: number) => planPack({ items: [ref('a')], offers: one, freeBytes, reserveBytes });

    it('fits when peak plus reserve equals free', () => {
      expect(run(140).fit).toBe('fits');
      expect(run(150, 10).fit).toBe('fits');
    });

    it('is tight when only the reserve does not fit', () => {
      const p = run(149, 10);
      expect(p.peakBytes).toBe(140);
      expect(p.fit).toBe('tight');
      expect(p.shortfallBytes).toBe(0);
      expect(codes(p)).not.toContain('over-quota');
    });

    it('is no one byte below the peak', () => {
      expect(run(139).fit).toBe('no');
      expect(run(139).shortfallBytes).toBe(1);
    });

    it('is tight when peak equals free but reserve does not fit', () => {
      expect(run(140, 1).fit).toBe('tight');
    });

    it('is no below the peak, with the shortfall and a warning', () => {
      const p = run(100, 5);
      expect(p.fit).toBe('no');
      expect(p.shortfallBytes).toBe(45);
      expect(p.warnings).toContainEqual({ code: 'over-quota', shortfallBytes: 45 });
    });

    it('is unknown when free is null', () => {
      const p = run(null, 10);
      expect(p.fit).toBe('unknown');
      expect(p.shortfallBytes).toBe(0);
      expect(codes(p)).toContain('quota-unknown');
    });
  });
});
