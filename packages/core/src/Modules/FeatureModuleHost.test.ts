import { describe, it, expect, vi } from 'vitest';
import { createFeatureModuleHost, parseFeatureModuleOverrides } from './FeatureModuleHost';
import { createFeatureFlags, parseFlagOverrides } from '../Settings/FeatureFlags';
import type { FeatureModuleHostOptions } from './FeatureModuleHost';
import { ContributionRegistry } from './ContributionRegistry';
import { toDisposable } from './types';
import type { FeatureModuleBinding, FeatureModuleExports, FeatureModuleManifest } from './FeatureModule';
import type { VerseActionContribution } from '../Apps/VerseActions';
import type { FeatureFlagName } from '../Settings/FeatureFlags';
import { AppRegistry } from '../Apps/AppRegistry';
import { createAppHostState } from '../Apps/AppHostState';
import { createAppBindingController } from '../Apps/AppBinding';
import { app, fakeTimers, flush } from '../__tests__/Apps/appTestUtils';

function quizManifest(extra: Partial<FeatureModuleManifest> = {}): FeatureModuleManifest {
  return {
    id: 'quiz',
    flag: 'quiz',
    hooks: [{ event: 'reader.verseChanged' }],
    contributes: {
      apps: [app('quiz', 'never')],
      verseActions: [{ id: 'quiz.fromVerse', title: { key: 'quiz.fromVerse', fallback: 'Quiz me' } }],
    },
    ...extra,
  };
}

function spyBinding(id: string, exportsExtra: Partial<FeatureModuleExports> = {}) {
  const dispose = vi.fn();
  const onVerse = vi.fn();
  const activate = vi.fn(() => toDisposable(dispose));
  const load = vi.fn(
    async (): Promise<FeatureModuleExports> => ({
      activate,
      hooks: { 'reader.verseChanged': onVerse },
      ...exportsExtra,
    }),
  );
  const binding: FeatureModuleBinding = { id, load };
  return { binding, load, activate, dispose, onVerse };
}

function setup(flags: Partial<Record<FeatureFlagName, boolean>> = {}, extra: Partial<FeatureModuleHostOptions> = {}) {
  const flagState = { ...flags };
  const apps = new AppRegistry();
  const verseActions = new ContributionRegistry<VerseActionContribution>('verseActions');
  const host = createFeatureModuleHost({
    platform: 'web',
    points: [apps, verseActions],
    isFlagEnabled: (f) => flagState[f] ?? false,
    ...extra,
  });
  return { host, apps, verseActions, flagState };
}

describe('FeatureModuleHost: the off switch', () => {
  it('a disabled module registers nothing and its code never loads', async () => {
    const { host, apps, verseActions } = setup({ quiz: false });
    const q = spyBinding('quiz');
    host.add(quizManifest(), q.binding);
    host.reconcile();
    expect(apps.has('quiz')).toBe(false);
    expect(verseActions.list()).toEqual([]);
    await host.fire('onApp:quiz');
    await host.fire('onStartupFinished');
    host.dispatch('reader.verseChanged', { verseId: 1, module: 'KJV' });
    expect(q.load).not.toHaveBeenCalled();
    expect(q.onVerse).not.toHaveBeenCalled();
    expect(host.list()[0]).toMatchObject({ id: 'quiz', enabled: false, offReason: 'flag' });
  });

  it('switching the flag off at runtime deactivates and removes contributions', async () => {
    const { host, apps, verseActions, flagState } = setup({ quiz: true });
    const q = spyBinding('quiz');
    host.add(quizManifest(), q.binding);
    host.reconcile();
    expect(apps.has('quiz')).toBe(true);
    expect(verseActions.has('quiz.fromVerse')).toBe(true);
    await host.fire('onApp:quiz');
    expect(host.isActive('quiz')).toBe(true);

    flagState.quiz = false;
    host.reconcile();
    expect(apps.has('quiz')).toBe(false);
    expect(verseActions.has('quiz.fromVerse')).toBe(false);
    expect(q.dispose).toHaveBeenCalledTimes(1);
    expect(host.hasSubscribers('reader.verseChanged')).toBe(false);
    host.dispatch('reader.verseChanged', { verseId: 1, module: 'KJV' });
    expect(q.onVerse).not.toHaveBeenCalled();

    flagState.quiz = true;
    host.reconcile();
    expect(apps.has('quiz')).toBe(true); // back on, re-registered; code loads again only on its event
    expect(host.isActive('quiz')).toBe(false);
  });

  it('the dev override beats the flag, both ways', () => {
    const overrides: Record<string, boolean> = { quiz: true };
    const { host, apps } = setup({ quiz: false }, { overrides: () => overrides });
    host.add(quizManifest());
    host.reconcile();
    expect(apps.has('quiz')).toBe(true);
    overrides.quiz = false;
    host.reconcile();
    expect(apps.has('quiz')).toBe(false);
    expect(host.list()[0].offReason).toBe('override');
  });

  it('a module whose requirement is off is off; platform-specific items are skipped', () => {
    const { host, apps } = setup({ tagGraph: false });
    host.add({ id: 'tag-graph', flag: 'tagGraph', contributes: {} });
    host.add({ id: 'genealogy', requires: ['tag-graph'], contributes: { apps: [app('genealogy')] } });
    host.add({
      id: 'present',
      contributes: { apps: [app('present', 'while-busy', 'reopen', { platforms: ['web'] }), app('present-desk', 'always', 'reopen', { platforms: ['desktop'] })] },
    });
    host.add({ id: 'desk-only', platforms: ['desktop'], contributes: { apps: [app('desk')] } });
    host.reconcile();
    expect(apps.list().map((a) => a.id)).toEqual(['present']);
    expect(host.list().find((m) => m.id === 'genealogy')?.offReason).toBe('requires');
    expect(host.list().find((m) => m.id === 'desk-only')?.offReason).toBe('platform');
  });

  it('switching an app module off unmounts its app and the host falls back to Study', async () => {
    const { host, apps, flagState } = setup({ quiz: true });
    host.add({ id: 'study', contributes: { apps: [app('study')] } });
    host.add(quizManifest());
    host.reconcile();
    const appHost = createAppHostState({ registry: apps, timers: fakeTimers() });
    await appHost.activate('quiz');
    flagState.quiz = false;
    host.reconcile();
    await flush();
    expect(appHost.getSnapshot()).toMatchObject({ activeId: 'study', mounted: ['study'] });
  });
});

describe('FeatureModuleHost: activation events and hooks', () => {
  it('loads code only when a declared (or implicit) event fires', async () => {
    const { host } = setup({ quiz: true });
    const q = spyBinding('quiz');
    host.add(quizManifest(), q.binding);
    host.reconcile();
    await host.fire('onStartupFinished'); // not declared: no
    await host.fire('onApp:other');
    expect(q.load).not.toHaveBeenCalled();
    await host.fire('onVerseAction:quiz.fromVerse'); // implicit from contributes.verseActions
    expect(q.load).toHaveBeenCalledTimes(1);
    expect(q.activate).toHaveBeenCalledWith(expect.objectContaining({ moduleId: 'quiz', activationEvent: 'onVerseAction:quiz.fromVerse' }));
    await host.fire('onApp:quiz');
    expect(q.load).toHaveBeenCalledTimes(1);
  });

  it('onStartupFinished activates only modules that opt in', async () => {
    const { host } = setup();
    const eager = spyBinding('eager');
    const lazy = spyBinding('lazy');
    host.add({ id: 'eager', activationEvents: ['onStartupFinished'], contributes: {} }, eager.binding);
    host.add({ id: 'lazy', contributes: { apps: [app('lazy')] } }, lazy.binding);
    host.reconcile();
    await host.fire('onStartupFinished');
    expect(eager.load).toHaveBeenCalledTimes(1);
    expect(lazy.load).not.toHaveBeenCalled();
  });

  it('hooks reach only active modules that declared them, gated by `when`', async () => {
    let live = false;
    const { host } = setup({ quiz: true }, { evaluateWhen: (expr) => (expr === 'quiz.live' ? live : true) });
    const q = spyBinding('quiz');
    const undeclared = vi.fn();
    const other = spyBinding('other', { hooks: { 'reader.selectionChanged': undeclared } });
    host.add(quizManifest({ hooks: [{ event: 'reader.verseChanged', when: 'quiz.live' }] }), q.binding);
    host.add({ id: 'other', activationEvents: ['onStartupFinished'], contributes: {} }, other.binding);
    host.reconcile();

    host.dispatch('reader.verseChanged', { verseId: 1, module: 'KJV' }); // inactive: nothing
    expect(host.hasSubscribers('reader.verseChanged')).toBe(false);
    await host.fire('onApp:quiz');
    await host.fire('onStartupFinished');
    host.dispatch('reader.verseChanged', { verseId: 2, module: 'KJV' }); // when false
    expect(q.onVerse).not.toHaveBeenCalled();
    live = true;
    host.dispatch('reader.verseChanged', { verseId: 3, module: 'KJV' });
    expect(q.onVerse).toHaveBeenCalledWith({ verseId: 3, module: 'KJV' });
    host.dispatch('reader.selectionChanged', { verseIds: [1], module: 'KJV' });
    expect(undeclared).not.toHaveBeenCalled(); // exported but not declared in the manifest

    host.deactivate('quiz');
    host.dispatch('reader.verseChanged', { verseId: 4, module: 'KJV' });
    expect(q.onVerse).toHaveBeenCalledTimes(1);
  });

  it('activates required modules first and reports timings', async () => {
    const order: string[] = [];
    const timings: string[] = [];
    let t = 0;
    const { host } = setup({}, { now: () => (t += 5), onActivationTiming: (x) => timings.push(`${x.moduleId}:${x.loadMs}/${x.activateMs}`) });
    const mk = (id: string): FeatureModuleBinding => ({
      id,
      load: async () => ({ activate: () => void order.push(id) }),
    });
    host.add({ id: 'base', contributes: {} }, mk('base'));
    host.add({ id: 'top', requires: ['base'], contributes: { apps: [app('top')] } }, mk('top'));
    host.reconcile();
    await host.fire('onApp:top');
    expect(order).toEqual(['base', 'top']);
    expect(timings).toEqual(['base:5/5', 'top:5/5']);
    expect(host.list().find((m) => m.id === 'top')?.lastTiming?.event).toBe('onApp:top');
  });

  it('a failing activation is reported and leaves the module inactive', async () => {
    const warn = vi.fn();
    const { host } = setup({}, { onWarning: warn });
    host.add({ id: 'bad', contributes: { apps: [app('bad')] } }, { id: 'bad', load: () => Promise.reject(new Error('404')) });
    host.reconcile();
    await host.fire('onApp:bad');
    expect(host.isActive('bad')).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('activation on onApp:bad failed'), expect.any(Error));
  });

  it('a module switched off while loading never activates', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const activate = vi.fn();
    const { host, flagState } = setup({ quiz: true });
    host.add(quizManifest({ hooks: [] }), { id: 'quiz', load: async () => { await gate; return { activate }; } });
    host.reconcile();
    const p = host.fire('onApp:quiz');
    flagState.quiz = false;
    host.reconcile();
    release();
    await p;
    expect(activate).not.toHaveBeenCalled();
    expect(host.isActive('quiz')).toBe(false);
  });

  it('the app binding controller fires onApp:<id> so the module is active before the view', async () => {
    const { host, apps } = setup({ quiz: true });
    const q = spyBinding('quiz');
    host.add(quizManifest(), q.binding);
    host.reconcile();
    const appHost = createAppHostState({ registry: apps, timers: fakeTimers() });
    createAppBindingController({
      host: appHost,
      bindings: [{ id: 'quiz', load: async () => ({ View: 'Quiz', activate: () => expect(host.isActive('quiz')).toBe(true) }) }],
      fireActivationEvent: (e) => host.fire(e),
    });
    expect((await appHost.activate('quiz')).status).toBe('activated');
    expect(q.activate).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed manifests', () => {
    const { host } = setup();
    expect(() => host.add({ id: 'Bad', contributes: {} })).toThrow(/lowercase/);
    expect(() => host.add({ id: 'x', activationEvents: ['*' as never], contributes: {} })).toThrow(/activation event/);
    expect(() => host.add({ id: 'y', contributes: {} }, { id: 'z', load: async () => ({}) })).toThrow(/does not match/);
  });
});

describe('parseFeatureModuleOverrides', () => {
  it('parses lists and JSON', () => {
    expect(parseFeatureModuleOverrides('-present, quiz !timeline')).toEqual({ present: false, quiz: true, timeline: false });
    expect(parseFeatureModuleOverrides('{"present":false,"x":1}')).toEqual({ present: false });
    expect(parseFeatureModuleOverrides(null)).toEqual({});
  });
});

describe('FeatureModuleHost: the feature-flag overrides and the module overrides work together', () => {
  // Flags (`FEATURE_FLAGS`, with its dev override) switch whole features that are off by default; the
  // per-module override switches any module by id, including ungated ones that have no flag.
  const gated = (id: string, flag?: FeatureFlagName): FeatureModuleManifest => ({ id, contributes: {}, ...(flag ? { flag } : {}) });
  function hostWith(flagOverrideText: string, moduleOverrideText: string) {
    const flags = createFeatureFlags({ overrides: parseFlagOverrides(flagOverrideText) });
    const host = createFeatureModuleHost({
      platform: 'web',
      points: [],
      isFlagEnabled: (f) => flags.isEnabled(f),
      overrides: () => parseFeatureModuleOverrides(moduleOverrideText),
    });
    host.add(gated('quiz', 'quiz'));
    host.add(gated('plain'));
    host.reconcile();
    return Object.fromEntries(host.list().map((m) => [m.id, m.enabled]));
  }

  it('the flag override turns a gated module on or off', () => {
    expect(hostWith('quiz', '')).toEqual({ quiz: true, plain: true });
    expect(hostWith('', '')).toEqual({ quiz: false, plain: true });
  });

  it('the module override turns off an ungated module, which no flag can', () => {
    expect(hostWith('', '-plain')).toEqual({ quiz: false, plain: false });
  });

  it('both at once: the module override wins for its module, the flag decides the rest', () => {
    expect(hostWith('quiz', '-quiz')).toEqual({ quiz: false, plain: true });
    expect(hostWith('-quiz', 'quiz')).toEqual({ quiz: true, plain: true });
    expect(hostWith('quiz', '-plain')).toEqual({ quiz: true, plain: false });
  });
});
