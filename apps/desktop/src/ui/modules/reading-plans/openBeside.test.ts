import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as appHost from '../../apps/appHost';
import { useLayoutStore } from '../../stores/useLayoutStore';
import { openReadingPlansBeside } from './openBeside';

describe('openReadingPlansBeside', () => {
  const addPanel = vi.fn();
  beforeEach(() => {
    addPanel.mockReset();
    vi.spyOn(appHost, 'openApp').mockResolvedValue({} as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it('adds a 380px pane to the right of the last active Bible panel', async () => {
    useLayoutStore.setState({ panels: new Map(), addPanel, lastActiveBiblePanelId: 'b1', dockviewApi: { getPanel: (id: string) => (id === 'b1' ? {} : undefined) } } as never);
    await openReadingPlansBeside();
    expect(appHost.openApp).toHaveBeenCalledWith('study');
    expect(addPanel).toHaveBeenCalledWith('reading-plans', undefined, 'Reading plans', { referencePanel: 'b1', direction: 'right' }, undefined, undefined, { initialWidth: 380 });
  });

  it('activates an open Reading plans pane instead', async () => {
    const setActive = vi.fn();
    useLayoutStore.setState({
      panels: new Map([['p1', { panelId: 'p1', contentType: 'reading-plans' }]]), addPanel, lastActiveBiblePanelId: null,
      dockviewApi: { getPanel: () => ({ api: { setActive } }) },
    } as never);
    await openReadingPlansBeside();
    expect(setActive).toHaveBeenCalled();
    expect(addPanel).not.toHaveBeenCalled();
  });
});
