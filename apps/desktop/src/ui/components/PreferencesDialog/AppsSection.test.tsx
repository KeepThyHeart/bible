import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key, i18n: { resolve: (v: unknown) => String(v) } }),
}));

import { appRegistry } from '../../apps/appHost';
import { usePreferencesStore } from '../../stores/usePreferencesStore';
import { AppsSection } from './AppsSection';

const desc = (id: string, title: string, order: number) => ({
  id, title: { key: `app.${id}`, fallback: title }, icon: { kind: 'builtin' as const, name: 'app' }, order,
  lifecycle: { keepAlive: 'always' as const, restore: 'default' as const },
});
appRegistry.register(desc('study', 'Study', 0), { kind: 'builtin', moduleId: 'study' });
appRegistry.register(desc('present', 'Present', 10), { kind: 'builtin', moduleId: 'present' });
appRegistry.register(desc('plans', 'Plans', 20), { kind: 'builtin', moduleId: 'plans' });

const rowIds = (c: HTMLElement) => [...c.querySelectorAll('[data-app-id]')].map((r) => r.getAttribute('data-app-id'));
const row = (c: HTMLElement, id: string) => c.querySelector(`[data-app-id="${id}"] input`) as HTMLInputElement;

beforeEach(() => {
  act(() => usePreferencesStore.setState({ appSwitcher: 'auto', appOrder: [], appHidden: [] }));
});

describe('AppsSection', () => {
  it('renders the switcher and all apps with English fallbacks', () => {
    const { container } = render(<AppsSection />);
    expect(screen.getByLabelText('App switcher')).toBeInTheDocument();
    expect(rowIds(container)).toEqual(['study', 'present', 'plans']);
  });

  it('changes the switcher mode', () => {
    render(<AppsSection />);
    fireEvent.change(screen.getByLabelText('App switcher'), { target: { value: 'rail' } });
    expect(usePreferencesStore.getState().appSwitcher).toBe('rail');
  });

  it('reorders', () => {
    const { container } = render(<AppsSection />);
    fireEvent.click(screen.getByLabelText('Move up: Plans'));
    expect(usePreferencesStore.getState().appOrder).toEqual(['study', 'plans', 'present']);
    expect(rowIds(container)).toEqual(['study', 'plans', 'present']);
  });

  it('hides and re-shows an app; Study cannot be hidden', () => {
    const { container } = render(<AppsSection />);
    fireEvent.click(row(container, 'present'));
    expect(usePreferencesStore.getState().appHidden).toEqual(['present']);
    expect(row(container, 'present').checked).toBe(false);
    expect(rowIds(container)).toContain('present');
    fireEvent.click(row(container, 'present'));
    expect(usePreferencesStore.getState().appHidden).toEqual([]);
    expect(row(container, 'study').disabled).toBe(true);
  });
});
