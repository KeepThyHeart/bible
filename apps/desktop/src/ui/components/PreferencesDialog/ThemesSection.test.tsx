import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ThemesSection } from './ThemesSection';
import { AVAILABLE_THEMES, usePreferencesStore } from '../../stores/usePreferencesStore';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock('../../services/announcer', () => ({ announce: vi.fn() }));

describe('ThemesSection', () => {
  it('exposes the selected theme with aria-pressed, and only that one', async () => {
    render(<ThemesSection />);
    const buttons = AVAILABLE_THEMES.map(th => screen.getByRole('button', { name: new RegExp(th.labelKey.replace('.', '\\.')) }));
    const pressed = buttons.filter(b => b.getAttribute('aria-pressed') === 'true');
    expect(pressed).toHaveLength(1);
    const other = buttons.find(b => b.getAttribute('aria-pressed') === 'false')!;
    await userEvent.click(other);
    expect(other).toHaveAttribute('aria-pressed', 'true');
    expect(buttons.filter(b => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
    expect(usePreferencesStore.getState().theme).toBeTruthy();
  });
});
