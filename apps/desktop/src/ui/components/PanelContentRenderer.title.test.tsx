/**
 * The pane region's accessible name is the dockview panel title. A Bible pane
 * calls setTitle() as the reader navigates, so the name has to follow it.
 */
import type React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import PanelContentRenderer from './PanelContentRenderer';

vi.mock('../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string) => k, language: 'en' }),
}));
vi.mock('../modules/moduleHost', () => ({
  modulePoints: {
    panelTypes: { has: () => true, subscribe: () => () => {}, getSnapshot: () => 0 },
    views: { resolve: () => undefined },
  },
  fireActivation: vi.fn(),
}));
vi.mock('../modules/host/panels', () => ({
  eagerPanelComponent: () => () => <div data-testid="inner-pane" />,
}));

function makeApi(title: string) {
  const listeners = new Set<() => void>();
  const api = {
    id: 'p1',
    title,
    onDidTitleChange: (cb: () => void) => {
      listeners.add(cb);
      return { dispose: () => listeners.delete(cb) };
    },
    setTitle(next: string) {
      api.title = next;
      listeners.forEach((l) => l());
    },
  };
  return api;
}

describe('PanelContentRenderer region name', () => {
  it('follows the panel title when the pane navigates', () => {
    const api = makeApi('John 3');
    const props = { params: { contentType: 'bible' }, api } as unknown as React.ComponentProps<typeof PanelContentRenderer>;
    render(<PanelContentRenderer {...props} />);
    expect(screen.getByRole('region', { name: 'John 3' })).toBeInTheDocument();

    act(() => api.setTitle('Romans 8'));

    expect(screen.getByRole('region', { name: 'Romans 8' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'John 3' })).toBeNull();
  });
});
