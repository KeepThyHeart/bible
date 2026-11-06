import { describe, it, expect, vi } from 'vitest';
import { applyPresetLayout } from './PresetApplier';

describe('applyPresetLayout tab roles (U-057)', () => {
  it('gives every tab of the rebuilt layout role=tab and its strip role=tablist', () => {
    const element = document.createElement('div');
    element.innerHTML =
      '<div class="dv-tabs-container"><div class="dv-tab"></div><div class="dv-tab"></div></div>';
    const api = {
      groups: [{ element, panels: [{ id: 'a', title: 'Bible' }, { id: 'b', title: 'Study' }], activePanel: { id: 'b' } }],
      fromJSON: vi.fn(),
      getGroup: vi.fn(),
    };
    applyPresetLayout(api as never, { layout: {}, collapsedGroups: [] } as never);
    const tabs = element.querySelectorAll('.dv-tab');
    expect(element.querySelector('.dv-tabs-container')?.getAttribute('role')).toBe('tablist');
    expect(tabs[0].getAttribute('role')).toBe('tab');
    expect(tabs[1].getAttribute('role')).toBe('tab');
    expect(tabs[0].getAttribute('aria-selected')).toBe('false');
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
  });
});
