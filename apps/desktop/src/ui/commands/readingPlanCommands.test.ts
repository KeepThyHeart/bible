import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CommandRegistry } from '../services/CommandRegistry';
import { I18nService } from '../services/I18nService';
import { whenContextService } from '../services/WhenContextService';
import { useLayoutStore } from '../stores/useLayoutStore';
import { registerReadingPlanCommands } from './readingPlanCommands';
import type { IDisposable } from '../types/Command';
import enCommands from '../../../locales/en/commands.json';

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
