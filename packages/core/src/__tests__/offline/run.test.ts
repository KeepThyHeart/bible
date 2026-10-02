import { describe, expect, it } from 'vitest';
import { AssetError } from '../../assets';
import { PackRun } from '../../offline/PackRun';
import { packKey } from '../../offline/PackTypes';
import type { IPackInstaller, PackItemKind, PackPlan, PackPlanStep } from '../../offline/PackTypes';

function step(id: string, bytes: number, after: string[] = [], kind: PackItemKind = 'module'): PackPlanStep {
  const ref = { kind, id };
  const key = packKey(ref);
  return {
    key,
    after,
    action: 'install',
    offer: {
      ref, key, title: id, group: 'bible', version: '1', downloadBytes: bytes, storedBytes: bytes,
      offlineReadable: true, status: 'absent',
    },
  };
}

function plan(steps: PackPlanStep[]): PackPlan {
  return {
    steps, present: [], skipped: [], downloadBytes: 0, newStoredBytes: 0, peakBytes: 0,
    fit: 'unknown', shortfallBytes: 0, warnings: [],
  };
}

interface Call {
  step: PackPlanStep;
  signal: AbortSignal;
  onBytes(l: number, t: number): void;
  resolve(): void;
  reject(e: unknown): void;
}

function fake(): { installer: IPackInstaller; calls: Call[]; byKey(k: string): Call } {
  const calls: Call[] = [];
  const installer: IPackInstaller = {
    install: (s, ctx) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ step: s, signal: ctx.signal, onBytes: ctx.onBytes, resolve, reject });
        ctx.signal.addEventListener('abort', () => reject(new AssetError('aborted', 'Aborted')));
      }),
  };
  return { installer, calls, byKey: (k) => calls.find((c) => c.step.key === k)! };
}

const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('PackRun', () => {
  it('empty plan is done', async () => {
    const r = await new PackRun(plan([]), {}).start();
    expect(r.state).toBe('done');
    expect(r.total).toBe(0);
  });

  it('runs sequentially by default and finishes done', async () => {
    const f = fake();
    const run = new PackRun(plan([step('a', 10), step('b', 20)]), { module: f.installer });
    const p = run.start();
    await tick();
    expect(f.calls.length).toBe(1);
    f.calls[0].resolve();
    await tick();
    expect(f.calls.length).toBe(2);
    f.calls[1].resolve();
    const s = await p;
    expect(s).toMatchObject({ state: 'done', done: 2, failed: 0, skipped: 0, totalBytes: 30, loadedBytes: 30 });
    expect(run.start()).toBe(p);
  });

  it('honours concurrency 2', async () => {
    const f = fake();
    const run = new PackRun(plan([step('a', 1), step('b', 1), step('c', 1)]), { module: f.installer }, { concurrency: 2 });
    const p = run.start();
    await tick();
    expect(f.calls.length).toBe(2);
    expect(run.getSnapshot().active.length).toBe(2);
    f.byKey('module:a').resolve();
    await tick();
    expect(f.calls.length).toBe(3);
    f.byKey('module:b').resolve();
    f.byKey('module:c').resolve();
    expect((await p).state).toBe('done');
  });

  it('gates on dependencies', async () => {
    const f = fake();
    const run = new PackRun(plan([step('b', 1, ['module:a']), step('a', 1)]), { module: f.installer }, { concurrency: 4 });
    const p = run.start();
    await tick();
    expect(f.calls.map((c) => c.step.key)).toEqual(['module:a']);
    f.calls[0].resolve();
    await tick();
    expect(f.calls.map((c) => c.step.key)).toEqual(['module:a', 'module:b']);
    f.calls[1].resolve();
    expect((await p).state).toBe('done');
  });

  it('skips dependents of a failed step (partial)', async () => {
    const f = fake();
    const run = new PackRun(
      plan([step('a', 1), step('b', 1, ['module:a']), step('c', 1, ['module:b']), step('d', 1)]),
      { module: f.installer },
      { concurrency: 2 },
    );
    const p = run.start();
    await tick();
    f.byKey('module:a').reject(new AssetError('http', 'boom'));
    f.byKey('module:d').resolve();
    const s = await p;
    expect(s).toMatchObject({ state: 'partial', done: 1, failed: 1, skipped: 2 });
    expect(s.errors).toEqual([{ key: 'module:a', code: 'http', message: 'boom' }]);
    expect(f.calls.length).toBe(2);
  });

  it('is failed when nothing succeeds; plain errors get code error', async () => {
    const f = fake();
    const run = new PackRun(plan([step('a', 1)]), { module: f.installer });
    const p = run.start();
    await tick();
    f.calls[0].reject(new Error('oops'));
    const s = await p;
    expect(s.state).toBe('failed');
    expect(s.errors[0]).toEqual({ key: 'module:a', code: 'error', message: 'oops' });
  });

  it('missing installer fails the step with no-installer', async () => {
    const f = fake();
    const run = new PackRun(plan([step('a', 1, [], 'asset'), step('b', 1)]), { module: f.installer });
    const p = run.start();
    await tick();
    f.calls[0].resolve();
    const s = await p;
    expect(s.state).toBe('partial');
    expect(s.errors[0].code).toBe('no-installer');
  });

  it('cancel aborts in-flight work and starts nothing more', async () => {
    const f = fake();
    const run = new PackRun(plan([step('a', 5), step('b', 5)]), { module: f.installer });
    const p = run.start();
    await tick();
    run.cancel();
    expect(f.calls[0].signal.aborted).toBe(true);
    const s = await p;
    expect(s.state).toBe('cancelled');
    expect(s.errors).toEqual([]);
    expect(s.failed).toBe(0);
    expect(f.calls.length).toBe(1);
    expect(s.active).toEqual([]);
  });

  it('cancel before start resolves cancelled without installing', async () => {
    const f = fake();
    const run = new PackRun(plan([step('a', 5)]), { module: f.installer });
    run.cancel();
    expect((await run.start()).state).toBe('cancelled');
    expect(f.calls.length).toBe(0);
  });

  it('snapshot identity is stable until a change', async () => {
    const f = fake();
    const run = new PackRun(plan([step('a', 10)]), { module: f.installer });
    const s0 = run.getSnapshot();
    expect(run.getSnapshot()).toBe(s0);
    expect(s0.state).toBe('idle');
    let n = 0;
    const off = run.subscribe(() => n++);
    const p = run.start();
    await tick();
    const s1 = run.getSnapshot();
    expect(s1).not.toBe(s0);
    expect(run.getSnapshot()).toBe(s1);
    const before = n;
    f.calls[0].resolve();
    await p;
    expect(n).toBeGreaterThan(before);
    off();
    const final = run.getSnapshot();
    expect(run.getSnapshot()).toBe(final);
  });

  it('throttles byte progress with the injected clock', async () => {
    const f = fake();
    let t = 1000;
    const run = new PackRun(plan([step('a', 100)]), { module: f.installer }, { now: () => t, throttleMs: 100 });
    const p = run.start();
    await tick();
    let n = 0;
    run.subscribe(() => n++);
    const c = f.calls[0];
    c.onBytes(10, 100);
    expect(n).toBe(0); // same instant as the step start
    t += 50;
    c.onBytes(20, 100);
    expect(n).toBe(0);
    expect(run.getSnapshot().active[0].loaded).toBe(0);
    t += 60;
    c.onBytes(30, 100);
    expect(n).toBe(1);
    expect(run.getSnapshot().active[0].loaded).toBe(30);
    expect(run.getSnapshot().loadedBytes).toBe(30);
    c.resolve();
    const s = await p;
    expect(s.loadedBytes).toBe(100);
    expect(n).toBeGreaterThan(1);
  });

  it('tolerates progress going backwards and negatives', async () => {
    const f = fake();
    let t = 0;
    const run = new PackRun(plan([step('a', 100)]), { module: f.installer }, { now: () => t, throttleMs: 10 });
    const p = run.start();
    await tick();
    const c = f.calls[0];
    t += 20;
    c.onBytes(80, 100);
    expect(run.getSnapshot().loadedBytes).toBe(80);
    t += 20;
    c.onBytes(5, 100);
    expect(run.getSnapshot().loadedBytes).toBe(5);
    t += 20;
    c.onBytes(-3, 100);
    expect(run.getSnapshot().active[0].loaded).toBe(0);
    c.resolve();
    expect((await p).state).toBe('done');
  });
});
