import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CommandRegistry } from '../../services/CommandRegistry';
import { I18nService } from '../../services/I18nService';
import { whenContextService } from '../../services/WhenContextService';
import { useLayoutStore } from '../../stores/useLayoutStore';
import { registerReadingPlanCommands } from './readingPlanCommands';
import { installTestService, uninstallTestService } from './ReadingPlans/testSupport';
import { useActiveReadingStore } from './useActiveReadingStore';
import * as appHost from '../../apps/appHost';
import * as beside from './openBeside';
import type { IDisposable } from '../../types/Command';
import enCommands from '../../../../locales/en/commands.json';

describe('readingPlans.open command', () => {
  let disposables: IDisposable[] = [];
  const registry = new CommandRegistry({ i18n: new I18nService(), whenContext: whenContextService });
  const addPanel = vi.fn();

  beforeEach(() => {
    addPanel.mockReset();
    useLayoutStore.setState({ panels: new Map(), addPanel } as never);
    disposables = registerReadingPlanCommands(registry);
  });
  afterEach(() => {
    for (const d of disposables) d.dispose();
  });

  it('has a title and category in the English catalog', () => {
    expect(enCommands['readingPlans.open']).toBeTruthy();
    expect(enCommands['readingPlans.open.category']).toBeTruthy();
  });

  it('adds a reading-plans panel when none is open', async () => {
    await registry.execute('readingPlans.open');
    expect(addPanel).toHaveBeenCalledWith('reading-plans', undefined, 'Reading plans');
  });

  it('activates the existing panel instead of adding another', async () => {
    const setActive = vi.fn();
    useLayoutStore.setState({
      panels: new Map([['p1', { panelId: 'p1', contentType: 'reading-plans', displayName: 'Reading plans' }]]),
      dockviewApi: { getPanel: () => ({ api: { setActive } }) },
    } as never);
    await registry.execute('readingPlans.open');
    expect(setActive).toHaveBeenCalled();
    expect(addPanel).not.toHaveBeenCalled();
  });
});

describe('readingPlans.continue / openBeside', () => {
  const registry = new CommandRegistry({ i18n: new I18nService(), whenContext: whenContextService });
  let disposables: IDisposable[] = [];
  beforeEach(() => { disposables = registerReadingPlanCommands(registry); });
  afterEach(() => { for (const d of disposables) d.dispose(); uninstallTestService(); vi.restoreAllMocks(); });

  it('continue opens the first unticked reading of today', async () => {
    const { service } = installTestService();
    const e = await service.startPlan('stock:gospels-30', { startDate: '2026-10-01', pacing: 'flexible' });
    const activate = vi.spyOn(useActiveReadingStore.getState(), 'activate').mockResolvedValue();
    vi.spyOn(appHost, 'openApp').mockResolvedValue({} as never);
    await registry.execute('readingPlans.continue');
    expect(activate).toHaveBeenCalledWith({ enrollmentId: e.id, day: 1, index: 0 });
  });

  it('continue opens the Reading plans app when nothing is due', async () => {
    installTestService();
    const open = vi.spyOn(appHost, 'openApp').mockResolvedValue({} as never);
    await registry.execute('readingPlans.continue');
    expect(open).toHaveBeenCalledWith('reading-plans');
  });

  it('openBeside calls openReadingPlansBeside', async () => {
    const spy = vi.spyOn(beside, 'openReadingPlansBeside').mockResolvedValue();
    await registry.execute('readingPlans.openBeside');
    expect(spy).toHaveBeenCalled();
  });
});
