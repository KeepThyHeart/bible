/**
 * The Quiz feature module through the real desktop host (task 0125): manifest,
 * "on by default loads nothing", the off switch (boot and runtime), activation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateBuiltinManifest } from '@bible/core/browser';
import { quizManifest } from './manifest';

const activate = vi.fn();

async function boot(override = '') {
  vi.resetModules();
  window.localStorage.setItem('kth.modules', override);
  activate.mockClear();
  vi.doMock('./module', () => ({ activate }));
  const { quizModule } = await import('./binding');
  const loadSpy = vi.spyOn(quizModule.binding!, 'load');
  const { registerBuiltinModules } = await import('../builtinModules');
  const host = await import('../moduleHost');
  const apps = await import('../../apps/appHost');
  registerBuiltinModules();
  return { ...host, appRegistry: apps.appRegistry, loadSpy };
}

function fakeCommandRegistry() {
  const all = new Set<string>();
  // Other modules' commands share the registry; only the quiz ones are asserted on.
  const live = { get size() { return quizIds().length; }, [Symbol.iterator]: () => quizIds()[Symbol.iterator]() };
  const quizIds = () => [...all].filter((id) => id.startsWith('quiz.'));
  return {
    live,
    registry: {
      register: vi.fn((cmd: { id: string }) => {
        all.add(cmd.id);
        return { dispose: () => void all.delete(cmd.id) };
      }),
    } as never,
  };
}

beforeEach(() => window.localStorage.clear());

describe('quiz manifest', () => {
  it('validates and keeps the persisted ids, orders and label keys', () => {
    expect(validateBuiltinManifest(quizManifest)).toEqual([]);
    expect(quizManifest.id).toBe('quiz');
    expect(quizManifest.flag).toBeUndefined();
    expect(quizManifest.platforms).toEqual(['desktop']);
    const c = quizManifest.contributes;
    expect(c.panelTypes).toEqual([{ id: 'quiz', title: { key: 'paneName.quiz', fallback: 'Quiz' }, order: 63 }]);
    expect(c.newTabTiles).toEqual([
      {
        id: 'quiz',
        title: { key: 'newTabPage.type.quiz', fallback: 'Quiz' },
        icon: { kind: 'builtin', name: 'quiz' },
        order: 60,
        target: { panelType: 'quiz' },
        keywords: ['quiz'],
      },
    ]);
    expect(c.apps?.map((a) => a.id)).toEqual(['quiz']);
    expect(c.apps?.[0]).toMatchObject({ order: 20, platforms: ['desktop'], lifecycle: { keepAlive: 'while-busy', restore: 'default' } });
    expect(c.i18nNamespace).toBe('quizPane');
  });
});

describe('quiz module in the desktop host', () => {
  it('is on by default: contributions exist and no module code has loaded', async () => {
    const { modulePoints, appRegistry, loadSpy, featureModules } = await boot('');
    expect(modulePoints.panelTypes.has('quiz')).toBe(true);
    expect(modulePoints.newTabTiles.list().some((t) => t.id === 'quiz')).toBe(true);
    expect(modulePoints.i18nNamespace.list().some((n) => n.id === 'quizPane')).toBe(true);
    expect(appRegistry.has('quiz')).toBe(true);
    expect(modulePoints.views.resolve('panel:quiz')).toBeTypeOf('function');
    expect(loadSpy).not.toHaveBeenCalled();
    expect(featureModules.isActive('quiz')).toBe(false);
  }, 60_000);

  it('off switch: no panel type, tile, view, app or commands; other modules are unaffected', async () => {
    const { modulePoints, appRegistry, loadSpy, featureModules, bindModuleCommands } = await boot('-quiz');
    const { registry, live } = fakeCommandRegistry();
    bindModuleCommands(registry);
    expect(modulePoints.panelTypes.has('quiz')).toBe(false);
    expect(modulePoints.newTabTiles.list().some((t) => t.id === 'quiz')).toBe(false);
    expect(modulePoints.views.resolve('panel:quiz')).toBeUndefined();
    expect(appRegistry.has('quiz')).toBe(false);
    expect([...live]).toEqual([]);
    expect(featureModules.list().find((m) => m.id === 'quiz')).toMatchObject({ enabled: false, offReason: 'override' });
    expect(modulePoints.panelTypes.has('bible')).toBe(true);
    expect(modulePoints.newTabTiles.list().some((t) => t.id === 'bible')).toBe(true);
    await featureModules.fire('onPanel:quiz');
    expect(loadSpy).not.toHaveBeenCalled();
  }, 60_000);

  it('registers its commands while on and removes them when switched off at runtime', async () => {
    const { modulePoints, appRegistry, reconcileModules, bindModuleCommands } = await boot('');
    const { registry, live } = fakeCommandRegistry();
    bindModuleCommands(registry);
    expect([...live].sort()).toEqual(['quiz.open', 'quiz.thisChapter']);
    window.localStorage.setItem('kth.modules', '-quiz');
    reconcileModules();
    expect([...live]).toEqual([]);
    expect(modulePoints.panelTypes.has('quiz')).toBe(false);
    expect(modulePoints.newTabTiles.list().some((t) => t.id === 'quiz')).toBe(false);
    expect(appRegistry.has('quiz')).toBe(false);
    window.localStorage.setItem('kth.modules', '');
    reconcileModules();
    expect([...live].sort()).toEqual(['quiz.open', 'quiz.thisChapter']);
    expect(modulePoints.panelTypes.has('quiz')).toBe(true);
  }, 60_000);

  it('activates on onPanel:quiz and on onApp:quiz, loading its code once', async () => {
    const a = await boot('');
    await a.featureModules.fire('onPanel:quiz');
    expect(a.featureModules.isActive('quiz')).toBe(true);
    expect(a.loadSpy).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledTimes(1);
    const b = await boot('');
    await b.featureModules.fire('onApp:quiz');
    expect(b.featureModules.isActive('quiz')).toBe(true);
  }, 60_000);
});
