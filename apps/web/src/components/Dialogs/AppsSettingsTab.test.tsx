// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d: string) => d, i18n: { language: 'en' } }),
}));
vi.mock('../../utils/bootGuard', () => ({ reloadForUpdateOnce: () => false }));

import { appRegistry } from '../../host/appHost';
import { webSettings } from '../../stores/settingsRegistry';
import { AppsSettingsTab } from './AppsSettingsTab';

const desc = (id: string, title: string, order: number) => ({
  id, title: { key: `app.${id}`, fallback: title }, icon: { kind: 'builtin' as const, name: 'fa-x' }, order,
  lifecycle: { keepAlive: 'always' as const, restore: 'default' as const },
});
appRegistry.register(desc('study', 'Study', 0), { kind: 'builtin', moduleId: 'study' });
appRegistry.register(desc('present', 'Present', 10), { kind: 'builtin', moduleId: 'present' });
appRegistry.register(desc('plans', 'Plans', 20), { kind: 'builtin', moduleId: 'plans' });

const rowIds = (c: Element) => [...c.querySelectorAll('[data-app-id]')].map((r) => r.getAttribute('data-app-id'));

beforeEach(() => { webSettings.reset(['appSwitcher', 'appOrder', 'appHidden']); });

describe('AppsSettingsTab', () => {
  it('renders the switcher and every app with resolved titles', () => {
    const { container } = render(<AppsSettingsTab />);
    expect(screen.getByLabelText('App switcher')).toBeTruthy();
    expect(rowIds(container)).toEqual(['study', 'present', 'plans']);
    expect(screen.getByText('Present')).toBeTruthy();
  });

  it('changes the switcher mode', () => {
    render(<AppsSettingsTab />);
    const select = screen.getByLabelText('App switcher') as HTMLSelectElement;
    select.value = 'none';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(webSettings.getSnapshot().appSwitcher).toBe('none');
  });

  it('reorders', () => {
    const { container } = render(<AppsSettingsTab />);
    fireEvent.click(screen.getByLabelText('Move up: Plans'));
    expect(webSettings.getSnapshot().appOrder).toEqual(['study', 'plans', 'present']);
    expect(rowIds(container)).toEqual(['study', 'plans', 'present']);
  });

  it('hides and re-shows an app, keeping it listed; Study cannot be hidden', () => {
    const { container } = render(<AppsSettingsTab />);
    const present = container.querySelector('[data-app-id="present"] input') as HTMLInputElement;
    fireEvent.click(present);
    expect(webSettings.getSnapshot().appHidden).toEqual(['present']);
    expect(rowIds(container)).toContain('present');
    expect((container.querySelector('[data-app-id="present"] input') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(container.querySelector('[data-app-id="present"] input') as HTMLInputElement);
    expect(webSettings.getSnapshot().appHidden).toEqual([]);
    expect((container.querySelector('[data-app-id="study"] input') as HTMLInputElement).disabled).toBe(true);
  });
});
