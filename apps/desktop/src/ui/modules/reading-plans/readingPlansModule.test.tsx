/**
 * The Reading plans feature module through the real desktop host (task 0125): manifest, "on by
 * default loads nothing", the off switch (boot and runtime, including the Bible-pane bar slot),
 * activation, the bar rendered through the slot, and saved layouts naming the panel type.
 */
import type { ComponentProps } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { validateBuiltinManifest } from '@bible/core/browser';
import { readingPlansManifest } from './manifest';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string) => k, language: 'en' }),
}));
vi.mock('./ReadingPlans/ReadingPlanBar', () => ({
  default: (p: { currentBook: number; currentChapter: number }) => (
    <div data-testid="plan-bar">{p.currentBook}:{p.currentChapter}</div>
  ),
}));
vi.mock('./ReadingPlans/ReadingPlansPane', () => ({ default: () => <div data-testid="plans-pane" /> }));

async function boot(override = '') {
  vi.resetModules();
  window.localStorage.setItem('kth.modules', override);
  const { readingPlansModule } = await import('./binding');
  const loadSpy = vi.spyOn(readingPlansModule.binding!, 'load');
  const { registerBuiltinModules } = await import('../builtinModules');
  const host = await import('../moduleHost');
  const apps = await import('../../apps/appHost');
  const slots = await import('../host/slots');
  registerBuiltinModules();
  return { ...host, appRegistry: apps.appRegistry, readerBars: slots.readerBars, ReaderBars: slots.ReaderBars, loadSpy };
}

function fakeCommandRegistry() {
  const live = new Set<string>();
  return {
    live,
    registry: {
      register: vi.fn((cmd: { id: string }) => {
        live.add(cmd.id);
        return { dispose: () => void live.delete(cmd.id) };
      }),
    } as never,
  };
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe('reading-plans manifest', () => {
  it('validates and keeps the persisted ids, orders and label keys', () => {
    expect(validateBuiltinManifest(readingPlansManifest)).toEqual([]);
    expect(readingPlansManifest.id).toBe('reading-plans');
    expect(readingPlansManifest.flag).toBeUndefined();
    expect(readingPlansManifest.platforms).toEqual(['desktop']);
    expect(readingPlansManifest.activationEvents).toEqual(['onStartupFinished']);
    const c = readingPlansManifest.contributes;
    expect(c.panelTypes).toEqual([{ id: 'reading-plans', title: { key: 'paneName.readingPlans', fallback: 'Reading plans' }, order: 62 }]);
    expect(c.newTabTiles).toEqual([
      {
        id: 'reading-plans',
        title: { key: 'newTabPage.type.readingPlans', fallback: 'Reading plans' },
        icon: { kind: 'builtin', name: 'reading-plans' },
        order: 55,
        target: { panelType: 'reading-plans' },
        keywords: ['plans', 'plan', 'reading'],
      },
    ]);
    expect(c.apps?.map((a) => a.id)).toEqual(['reading-plans']);
    expect(c.apps?.[0]).toMatchObject({ order: 30, platforms: ['desktop'], lifecycle: { keepAlive: 'never', restore: 'default' } });
    expect(c.i18nNamespace).toBe('readingPlans');
  });
});

describe('reading-plans module in the desktop host', () => {
  it('is on by default: contributions exist and no module code has loaded before startup finishes', async () => {
    const { modulePoints, appRegistry, loadSpy, featureModules, readerBars } = await boot('');
    expect(modulePoints.panelTypes.has('reading-plans')).toBe(true);
    expect(modulePoints.newTabTiles.list().some((t) => t.id === 'reading-plans')).toBe(true);
    expect(modulePoints.i18nNamespace.list().some((n) => n.id === 'readingPlans')).toBe(true);
    expect(appRegistry.has('reading-plans')).toBe(true);
    expect(modulePoints.views.resolve('panel:reading-plans')).toBeTypeOf('function');
    expect(loadSpy).not.toHaveBeenCalled();
    expect(featureModules.isActive('reading-plans')).toBe(false);
    expect(readerBars.list()).toHaveLength(0);
    // Settle the pending onStartupFinished activation so it cannot leak into the next test's module graph.
    await waitFor(() => expect(featureModules.isActive('reading-plans')).toBe(true));
  }, 60_000);

  it('activates after startup and registers the reader bar, rendered through the slot', async () => {
    const { loadSpy, featureModules, readerBars, ReaderBars } = await boot('');
    await waitFor(() => expect(featureModules.isActive('reading-plans')).toBe(true));
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(readerBars.list()).toHaveLength(1);
    render(<ReaderBars currentBook={43} currentChapter={3} />);
    expect(await screen.findByTestId('plan-bar')).toHaveTextContent('43:3');
  }, 60_000);

  it('off switch: no panel type, tile, view, app, commands or reader bar; other modules unaffected', async () => {
    const { modulePoints, appRegistry, loadSpy, featureModules, bindModuleCommands, readerBars } = await boot('-reading-plans');
    const { registry, live } = fakeCommandRegistry();
    bindModuleCommands(registry);
    await new Promise((r) => setTimeout(r, 20)); // let onStartupFinished fire
    expect(modulePoints.panelTypes.has('reading-plans')).toBe(false);
    expect(modulePoints.newTabTiles.list().some((t) => t.id === 'reading-plans')).toBe(false);
    expect(modulePoints.views.resolve('panel:reading-plans')).toBeUndefined();
    expect(modulePoints.i18nNamespace.list().some((n) => n.id === 'readingPlans')).toBe(false);
    expect(appRegistry.has('reading-plans')).toBe(false);
    expect([...live].some((id) => id.startsWith('readingPlans.'))).toBe(false);
    expect(featureModules.list().find((m) => m.id === 'reading-plans')).toMatchObject({ enabled: false, offReason: 'override' });
    expect(modulePoints.panelTypes.has('bible')).toBe(true);
    expect(modulePoints.panelTypes.has('quiz')).toBe(true);
    expect(loadSpy).not.toHaveBeenCalled();
    expect(readerBars.list()).toEqual([]);
  }, 60_000);

  it('registers its command while on and removes everything when switched off at runtime', async () => {
    const { modulePoints, appRegistry, reconcileModules, bindModuleCommands, featureModules, readerBars } = await boot('');
    const { registry, live } = fakeCommandRegistry();
    bindModuleCommands(registry);
    expect([...live]).toContain('readingPlans.open');
    await waitFor(() => expect(readerBars.list()).toHaveLength(1));
    window.localStorage.setItem('kth.modules', '-reading-plans');
    reconcileModules();
    expect([...live]).not.toContain('readingPlans.open');
    expect(modulePoints.panelTypes.has('reading-plans')).toBe(false);
    expect(modulePoints.newTabTiles.list().some((t) => t.id === 'reading-plans')).toBe(false);
    expect(appRegistry.has('reading-plans')).toBe(false);
    expect(readerBars.list()).toEqual([]);
    expect(featureModules.isEnabled('reading-plans')).toBe(false);
    window.localStorage.setItem('kth.modules', '');
    reconcileModules();
    expect([...live]).toContain('readingPlans.open');
    expect(modulePoints.panelTypes.has('reading-plans')).toBe(true);
  }, 60_000);

  it('activates on onApp:reading-plans', async () => {
    const { featureModules } = await boot('');
    await featureModules.fire('onApp:reading-plans');
    expect(featureModules.isActive('reading-plans')).toBe(true);
  }, 60_000);
});

describe('a saved layout naming the reading-plans panel type', () => {
  async function renderPanel() {
    const { default: PanelContentRenderer } = await import('../../components/PanelContentRenderer');
    const props = { params: { contentType: 'reading-plans' }, api: { id: 'p1' } } as unknown as ComponentProps<typeof PanelContentRenderer>;
    return render(<PanelContentRenderer {...props} />);
  }

  it('renders the pane with the module on (the panel activates the module)', async () => {
    const { featureModules } = await boot('');
    await renderPanel();
    expect(await screen.findByTestId('plans-pane')).toBeInTheDocument();
    await waitFor(() => expect(featureModules.isActive('reading-plans')).toBe(true));
  }, 60_000);

  it('degrades to the unavailable placeholder with the module off', async () => {
    await boot('-reading-plans');
    await act(async () => { await renderPanel(); });
    expect(screen.getByTestId('panel-unavailable')).toHaveAttribute('data-panel-type', 'reading-plans');
    expect(screen.queryByTestId('plans-pane')).toBeNull();
  }, 60_000);
});
