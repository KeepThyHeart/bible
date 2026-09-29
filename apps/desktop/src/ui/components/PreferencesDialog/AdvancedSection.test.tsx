import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AdvancedSection } from './AdvancedSection';
import { usePreferencesStore } from '../../stores/usePreferencesStore';
import { getDesktopSettingsStore } from '../../settings/desktopSettings';

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
  act(() => usePreferencesStore.setState({ advancedPaneManagerEnabled: false }));
});

describe('AdvancedSection (registry-rendered)', () => {
  it('renders the registry setting with its catalog labels', () => {
    render(<AdvancedSection />);
    const box = screen.getByLabelText('preferencesDialog.advancedPaneManagerLabel');
    expect(box).toBeInTheDocument();
    expect(box).not.toBeChecked();
    expect(box).toHaveAccessibleDescription('preferencesDialog.advancedPaneManagerDescription');
  });

  it('writes through to the preferences store (the persisted source of truth)', async () => {
    const user = userEvent.setup();
    render(<AdvancedSection />);
    await user.click(screen.getByLabelText('preferencesDialog.advancedPaneManagerLabel'));
    expect(usePreferencesStore.getState().advancedPaneManagerEnabled).toBe(true);
    expect(screen.getByLabelText('preferencesDialog.advancedPaneManagerLabel')).toBeChecked();
  });

  it('follows changes made elsewhere (session restore, the gate dialog)', () => {
    render(<AdvancedSection />);
    act(() => usePreferencesStore.getState().loadFromSession({ advancedPaneManagerEnabled: true }));
    expect(screen.getByLabelText('preferencesDialog.advancedPaneManagerLabel')).toBeChecked();
    expect(getDesktopSettingsStore().get('advancedPaneManagerEnabled')).toBe(true);
  });
});
