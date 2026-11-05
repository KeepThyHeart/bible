/** B-042: dockview tabs expose tab semantics and respond to the keyboard. */
import { describe, it, expect, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../stores/useLayoutStore', () => ({ useLayoutStore: vi.fn().mockReturnValue(undefined) }));
vi.mock('../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string, v?: Record<string, string>) => (v?.name ? `${k}:${v.name}` : k) }),
}));
vi.mock('../utils/paneNames', () => ({
  localizePaneLabel: (_t: unknown, _c: unknown, l: string) => l,
  PANE_NAME_KEYS: { study: 'paneName.study' },
}));
vi.mock('../hooks/useOverlayDismissal', () => ({ useOverlayDismissal: vi.fn() }));

import DockviewTabRenderer from './DockviewTabRenderer';

function props(setActive: () => void, isActive: boolean) {
  return {
    api: {
      id: 'p1', title: 'Study', isActive, setActive,
      group: { id: 'g', panels: [{ id: 'p1' }, { id: 'p2' }] },
      onDidTitleChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidGroupChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidActiveChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      close: vi.fn(),
    },
    containerApi: {
      panels: [{ id: 'p1' }, { id: 'p2' }],
      onDidLayoutChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    },
    params: { contentType: 'study' },
  } as any;
}

describe('dockview tab a11y (B-042)', () => {
  it('sets tab roles and handles Enter/Space/arrows', async () => {
    const setActive = vi.fn();
    const { container } = render(
      <div className="dv-tabs-container">
        <div className="dv-tab" tabIndex={0}><DockviewTabRenderer {...props(setActive, true)} /></div>
        <div className="dv-tab" tabIndex={0}>other</div>
      </div>,
    );
    const strip = container.querySelector('.dv-tabs-container') as HTMLElement;
    const [a, b] = Array.from(container.querySelectorAll<HTMLElement>('.dv-tab'));
    expect(strip.getAttribute('role')).toBe('tablist');
    expect(a.getAttribute('role')).toBe('tab');
    expect(a.getAttribute('aria-selected')).toBe('true');
    const user = userEvent.setup();
    a.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(setActive).toHaveBeenCalledTimes(2);
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(b);
    cleanup();
  });

  it('marks the group\'s active panel selected even when its group is not focused', () => {
    // api.isActive is false (group unfocused) but the panel is its group's active panel.
    const p = props(vi.fn(), false);
    p.api.group.activePanel = { id: 'p1' };
    const { container } = render(
      <div className="dv-tabs-container"><div className="dv-tab" tabIndex={0}><DockviewTabRenderer {...p} /></div></div>,
    );
    expect(container.querySelector('.dv-tab')!.getAttribute('aria-selected')).toBe('true');
    cleanup();
  });

  it('does not select a tab that is not its group\'s active panel, and follows visibility changes', () => {
    const p = props(vi.fn(), true);
    p.api.group.activePanel = { id: 'p2' };
    let fire: () => void = () => {};
    p.api.onDidVisibilityChange = vi.fn((cb: () => void) => { fire = cb; return { dispose: vi.fn() }; });
    const { container } = render(
      <div className="dv-tabs-container"><div className="dv-tab" tabIndex={0}><DockviewTabRenderer {...p} /></div></div>,
    );
    const tab = container.querySelector('.dv-tab') as HTMLElement;
    expect(tab.getAttribute('aria-selected')).toBe('false');
    p.api.group.activePanel = { id: 'p1' };
    fire();
    expect(tab.getAttribute('aria-selected')).toBe('true');
    cleanup();
  });

  it('names the close button, takes it out of the tab order and closes on Delete', async () => {
    const p = props(vi.fn(), true);
    const { container, getByTestId } = render(
      <div className="dv-tabs-container"><div className="dv-tab" tabIndex={0}><DockviewTabRenderer {...p} /></div></div>,
    );
    const btn = getByTestId('close-tab');
    expect(btn.getAttribute('aria-label')).toBe('bookPane.closeTabLabel:Study');
    expect(btn.getAttribute('tabindex')).toBe('-1');
    expect(btn.textContent).toBe('\u00d7');
    expect(container.querySelector('.dv-tabs-container')!.getAttribute('aria-label')).toBe('ui.dockviewTab.tablistLabel:paneName.study');
    const user = userEvent.setup();
    (container.querySelector('.dv-tab') as HTMLElement).focus();
    await user.keyboard('{Delete}');
    expect(p.api.close).toHaveBeenCalledTimes(1);
    cleanup();
  });
});
