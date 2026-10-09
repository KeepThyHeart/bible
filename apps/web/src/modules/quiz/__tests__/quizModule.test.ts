/**
 * The Quiz module through the REAL web host: manifest, the off switch, lazy
 * activation (app, pane tab, phone Study sections) and the phone section slot.
 * Each test boots a fresh module graph, as builtinModules.test.ts does.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateBuiltinManifest } from '@bible/core/browser';
import { quizManifest } from '../manifest';

const spies = vi.hoisted(() => ({
  moduleLoaded: vi.fn(),
  moduleActivate: vi.fn(),
}));

vi.mock('../module', () => {
  spies.moduleLoaded();
  return { activate: spies.moduleActivate, hooks: {} };
});
vi.mock('../QuizApp', () => ({ QuizApp: () => null }));
vi.mock('../QuizPaneView', () => ({ default: () => null }));
vi.mock('../../../i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../i18n')>()),
  loadNamespace: async () => {},
}));
vi.mock('../../../utils/bootGuard', () => ({ reloadForUpdateOnce: () => false }));

async function boot(opts: { override?: string; disabled?: string[]; flags?: Record<string, boolean> } = {}) {
  vi.resetModules();
  localStorage.setItem('kth.modules', opts.override ?? '');
  const { setClientConfig } = await import('../../../utils/clientConfig');
  setClientConfig({
    ...(opts.disabled ? { modules: { disabled: opts.disabled } } : {}),
    features: { quiz: true, ...opts.flags },
  } as never);
  const { registerBuiltinModules } = await import('../../builtinModules');
  const host = await import('../../moduleHost');
  const apps = await import('../../../host/appHost');
  const slots = await import('../../../host/slots');
  registerBuiltinModules();
  return { ...host, ...apps, ...slots };
}

function quiz(h: Awaited<ReturnType<typeof boot>>) {
  return {
    pane: h.modulePoints.paneModes.get('quiz'),
    app: h.appRegistry.get('quiz'),
    view: h.modulePoints.views.resolve('pane:quiz'),
    ns: JSON.stringify(h.modulePoints.i18nNamespace.list()).includes('quiz'),
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('the Quiz manifest', () => {
  it('validates and keeps the old ids, orders and keys', () => {
    expect(validateBuiltinManifest(quizManifest)).toEqual([]);
    expect(quizManifest.flag).toBe('quiz');
    expect(quizManifest.contributes.paneModes).toEqual([
      { id: 'quiz', title: { key: 'rightPane.quiz', fallback: 'Quiz' }, order: 50, keepMounted: true },
    ]);
    expect(quizManifest.contributes.apps?.[0]).toMatchObject({
      id: 'quiz', title: { key: 'apps.quiz.title', fallback: 'Quiz' }, deepLink: { segment: 'quiz' }, platforms: ['web'],
    });
    expect(quizManifest.contributes.serverRoutes).toEqual([{ id: 'quiz-api', path: '/api/quiz' }]);
  });
});

describe('the Quiz module: on', () => {
  it('contributes the pane tab, app and namespace and loads no code', async () => {
    const h = await boot();
    const q = quiz(h);
    expect(q.pane).toMatchObject({ id: 'quiz', keepMounted: true });
    expect(q.app).toMatchObject({ id: 'quiz' });
    expect(q.view).toBeDefined();
    expect(q.ns).toBe(true);
    expect(h.modulePoints.paneModes.list().map((p) => p.id)).toContain('study');
    expect(spies.moduleLoaded).not.toHaveBeenCalled();
    expect(h.featureModules.isActive('quiz')).toBe(false);
  }, 60_000);

  it('opening the app fires onApp:quiz and activates the module', async () => {
    const h = await boot();
    h.setShellContext({} as never);
    expect((await h.appHost.activate('quiz')).status).toBe('activated');
    expect(h.featureModules.isActive('quiz')).toBe(true);
    expect((spies.moduleActivate.mock.calls[0] as unknown[])[0]).toMatchObject({ activationEvent: 'onApp:quiz' });
  }, 60_000);

  it('opening the pane tab (onPanel:quiz) activates the module', async () => {
    const h = await boot();
    await h.featureModules.fire('onPanel:quiz');
    expect(h.featureModules.isActive('quiz')).toBe(true);
  }, 60_000);

  it('the phone Study pane event activates the module', async () => {
    const h = await boot();
    await h.featureModules.fire('onView:studyPane.sections');
    expect(h.featureModules.isActive('quiz')).toBe(true);
    expect((spies.moduleActivate.mock.calls[0] as unknown[])[0]).toMatchObject({ activationEvent: 'onView:studyPane.sections' });
  }, 60_000);
});

describe.each([
  ['the dev override', { override: '-quiz' }],
  ['the server config', { disabled: ['quiz'] }],
  ['the feature flag', { flags: { quiz: false } }],
])('the Quiz module: off via %s', (_name, opts) => {
  it('has no pane, app, view or namespace; nothing activates; the rest stays', async () => {
    const h = await boot(opts);
    expect(quiz(h)).toEqual({ pane: undefined, app: undefined, view: undefined, ns: false });
    h.setShellContext({} as never);
    expect((await h.appHost.activate('quiz')).status).not.toBe('activated');
    await h.featureModules.fire('onPanel:quiz');
    await h.featureModules.fire('onView:studyPane.sections');
    expect(spies.moduleLoaded).not.toHaveBeenCalled();
    expect(h.featureModules.isActive('quiz')).toBe(false);
    expect(h.modulePoints.paneModes.list().map((p) => p.id)).toContain('study');
  }, 60_000);
});

describe('the Quiz module: switched off at runtime', () => {
  it('override + reconcileModules() removes everything, and back on restores it', async () => {
    const h = await boot();
    expect(quiz(h).pane).toBeDefined();
    localStorage.setItem('kth.modules', '-quiz');
    h.reconcileModules();
    expect(quiz(h)).toEqual({ pane: undefined, app: undefined, view: undefined, ns: false });
    localStorage.setItem('kth.modules', '');
    h.reconcileModules();
    expect(quiz(h).pane).toBeDefined();
    expect(quiz(h).app).toBeDefined();
  }, 60_000);
});

describe('the phone Study section slot', () => {
  it('fills when the real module activates and empties when it is switched off', async () => {
    vi.doUnmock('../module');
    vi.doMock('../QuizSection', () => ({ QuizSection: () => null }));
    const h = await boot();
    expect(h.studyPaneSections.list()).toHaveLength(0);
    await h.featureModules.fire('onView:studyPane.sections');
    expect(h.studyPaneSections.list()).toHaveLength(1);
    localStorage.setItem('kth.modules', '-quiz');
    h.reconcileModules();
    expect(h.studyPaneSections.list()).toHaveLength(0);
    vi.doUnmock('../QuizSection');
  }, 60_000);

  it('stays empty when the module is off', async () => {
    vi.doUnmock('../module');
    vi.doMock('../QuizSection', () => ({ QuizSection: () => null }));
    const h = await boot({ override: '-quiz' });
    await h.featureModules.fire('onView:studyPane.sections');
    expect(h.studyPaneSections.list()).toHaveLength(0);
    vi.doUnmock('../QuizSection');
  }, 60_000);
});
