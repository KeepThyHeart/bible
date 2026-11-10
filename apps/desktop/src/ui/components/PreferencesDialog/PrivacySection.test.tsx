import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrivacySection } from './PrivacySection';
import { useNetworkStore } from '../../stores/useNetworkStore';

/**
 * The one property that matters here: this checkbox never lies about the
 * switch. Turning it on round-trips through main's confirmation dialog
 * (mocked at the bridge level, same as `useNetworkStore.test.ts`), and a
 * cancelled dialog must snap the checkbox back to unchecked rather than
 * leaving it optimistically checked.
 */

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const setAllowWebRequests = vi.fn();

beforeEach(() => {
  useNetworkStore.setState({ allowWebRequests: false, loaded: false });
  setAllowWebRequests.mockReset();
  (window as unknown as { electron?: unknown }).electron = {
    network: {
      getAllowWebRequests: vi.fn().mockResolvedValue({ ok: true, value: false }),
      setAllowWebRequests,
    },
  };
});

describe('PrivacySection', () => {
  it('B-161: lists every online feature under the switch', () => {
    render(<PrivacySection />);
    const list = screen.getByTestId('privacy-online-features');
    for (const k of ['Modules', 'Updates', 'Speech', 'Search', 'Diagnostics', 'Links']) {
      expect(list).toHaveTextContent(`preferencesDialog.privacyOnline${k}`);
    }
  });

  it('renders unchecked when the switch is off', () => {
    render(<PrivacySection />);
    expect(screen.getByTestId('privacy-allow-web-requests-checkbox')).not.toBeChecked();
  });

  it('checks the box once the user confirms the native dialog', async () => {
    setAllowWebRequests.mockResolvedValue({ ok: true, value: true });
    render(<PrivacySection />);

    await userEvent.click(screen.getByTestId('privacy-allow-web-requests-checkbox'));

    expect(setAllowWebRequests).toHaveBeenCalledWith(true);
    await waitFor(() =>
      expect(screen.getByTestId('privacy-allow-web-requests-checkbox')).toBeChecked()
    );
  });

  it('snaps back to unchecked when the user cancels the native dialog', async () => {
    // main's `network:set-allow-web-requests` resolves the state AFTER the
    // confirmation dialog - a cancel comes back `{ value: false }`, never a
    // rejected promise.
    setAllowWebRequests.mockResolvedValue({ ok: true, value: false });
    render(<PrivacySection />);

    const checkbox = screen.getByTestId('privacy-allow-web-requests-checkbox');
    await userEvent.click(checkbox);

    expect(setAllowWebRequests).toHaveBeenCalledWith(true);
    await waitFor(() => expect(checkbox).not.toBeChecked());
  });

  it('turns off immediately with no confirmation', async () => {
    useNetworkStore.setState({ allowWebRequests: true, loaded: true });
    setAllowWebRequests.mockResolvedValue({ ok: true, value: false });
    render(<PrivacySection />);

    const checkbox = screen.getByTestId('privacy-allow-web-requests-checkbox');
    expect(checkbox).toBeChecked();
    await userEvent.click(checkbox);

    expect(setAllowWebRequests).toHaveBeenCalledWith(false);
    await waitFor(() => expect(checkbox).not.toBeChecked());
  });

  it('keeps the checkbox enabled and focused, and says why, while the native dialog is open', async () => {
    let resolve!: (v: { ok: boolean; value: boolean }) => void;
    setAllowWebRequests.mockReturnValue(new Promise(r => { resolve = r; }));
    render(<PrivacySection />);
    const box = screen.getByTestId('privacy-allow-web-requests-checkbox');
    box.focus();
    await userEvent.click(box);

    expect(box).not.toBeDisabled();
    expect(box).toHaveFocus();
    expect(box).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent(/confirmation/i);

    resolve({ ok: true, value: false });
    await waitFor(() => expect(box).toHaveAttribute('aria-busy', 'false'));
    expect(box).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('');
  });
});
