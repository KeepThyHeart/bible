import { describe, it, expect, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CollapsedPanesRevealBar from './CollapsedPanesRevealBar';
import { ContextProvider, type AppServices } from '../contexts/ContextProvider';

const STRINGS: Record<string, string> = {
  'layout.expandCollapsed.label': 'Show hidden panes',
  'layout.showStudyPanes.label': 'Show Study Panes',
  'layout.expandCollapsed.tooltip': 'Bring the collapsed study panes back into view',
  'layout.expandCollapsed.tooltipNamed': 'Bring back: {titles}',
};

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: {
      t: (key: string, params?: Record<string, unknown>) => {
        const template = STRINGS[key] ?? key;
        if (!params) return template;
        return template.replace(/\{(\w+)\}/g, (match, name: string) =>
          Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
        );
      },
      currentLocale: 'en' as const,
      onDidChangeLocale: () => ({ dispose: vi.fn() }),
      resolve: (v: unknown) => String(v),
      loadCatalog: vi.fn(),
      setLocale: vi.fn(),
    } as unknown as AppServices['i18n'],
  };
}

function renderBar(props: Partial<ComponentProps<typeof CollapsedPanesRevealBar>> = {}) {
  const onExpand = props.onExpand ?? vi.fn();
  return {
    onExpand,
    ...render(
      <ContextProvider services={createMockServices()}>
        <CollapsedPanesRevealBar
          collapsedGroups={props.collapsedGroups ?? []}
          hiddenTitles={props.hiddenTitles ?? []}
          onExpand={onExpand}
        />
      </ContextProvider>,
    ),
  };
}

describe('CollapsedPanesRevealBar', () => {
  it('renders nothing when no group is collapsed', () => {
    renderBar({ collapsedGroups: [] });
    expect(screen.queryByTestId('collapsed-panes-reveal-bar')).toBeNull();
  });

  it('renders the bar when a group is collapsed', () => {
    renderBar({ collapsedGroups: [{ groupId: 'group-2', axis: 'width' }] });
    expect(screen.getByTestId('collapsed-panes-reveal-bar')).toBeInTheDocument();
  });

  it('uses a generic tooltip when hidden pane titles are not available', () => {
    renderBar({ collapsedGroups: [{ groupId: 'group-2', axis: 'width' }], hiddenTitles: [] });
    expect(screen.getByTestId('collapsed-panes-reveal-bar')).toHaveAttribute(
      'title',
      'Bring the collapsed study panes back into view',
    );
  });

  it('names the hidden panes in the tooltip when available', () => {
    renderBar({
      collapsedGroups: [{ groupId: 'group-2', axis: 'width' }],
      hiddenTitles: ['Study', 'Commentary'],
    });
    expect(screen.getByTestId('collapsed-panes-reveal-bar')).toHaveAttribute(
      'title',
      'Bring back: Study, Commentary',
    );
  });

  it('uses physical, not logical, edge properties', () => {
    // dockview's grid never mirrors for RTL - its splitview positions views
    // with a JS-computed physical `left` (see the RTL section of
    // styles/dockview-overrides.css). A logical `borderInlineStart` resolves to
    // the right-hand side under dir="rtl" and would draw the rule on the wrong
    // face of the rail; the row itself flips to `row-reverse` there so the rail
    // stays on the physical right.
    renderBar({ collapsedGroups: [{ groupId: 'group-2', axis: 'width' }] });
    const bar = screen.getByTestId('collapsed-panes-reveal-bar');
    expect(bar.style.borderLeft).not.toBe('');
    expect(bar.style.borderInlineStart).toBe('');
  });

  it('sits beside the workbench rather than overlaying it, and is opaque', () => {
    // REGRESSION: the rail must not be `absolute inset-y-0 right-0 z-10` on top
    // of a full-width DockviewReact - the panes then run underneath it and its
    // translucent fill lets them show through. It has to be a real flex sibling
    // of the dockview container (what the web app's `.main-layout` does) with a
    // solid background, or "collapse the right pane" still hides content behind
    // the thing that is supposed to reveal it.
    renderBar({ collapsedGroups: [{ groupId: 'group-2', axis: 'width' }] });
    const bar = screen.getByTestId('collapsed-panes-reveal-bar');

    expect(bar.className).not.toContain('absolute');
    expect(bar.className).not.toContain('inset-y-0');
    expect(bar).toHaveClass('flex-shrink-0');
    expect(bar.style.position).toBe('');

    // Opaque: no alpha channel anywhere in the background colour.
    expect(bar.style.backgroundColor).not.toBe('');
    expect(bar.style.backgroundColor).not.toMatch(/rgba|\/\s*0?\.\d|transparent/);
  });

  it('labels itself "Show Study Panes", matching the web app', () => {
    renderBar({ collapsedGroups: [{ groupId: 'group-2', axis: 'width' }] });
    expect(screen.getByTestId('collapsed-panes-reveal-bar')).toHaveTextContent('Show Study Panes');
  });

  it('calls the expand handler when clicked', async () => {
    const { onExpand } = renderBar({ collapsedGroups: [{ groupId: 'group-2', axis: 'width' }] });
    await userEvent.click(screen.getByTestId('collapsed-panes-reveal-bar'));
    expect(onExpand).toHaveBeenCalledOnce();
  });
});
