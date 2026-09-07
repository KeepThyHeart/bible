/**
 * Component tests for ConnectionBanner.
 *
 * Pattern: Store-connected component with conditional rendering.
 * Tests manipulate the store directly, then verify the component reacts.
 * i18n is mocked to return translation keys (avoids loading locale files).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/preact';

// Mock i18n before importing the component — useTranslation returns the key as-is.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

import { ConnectionBanner } from './ConnectionBanner';
import { connectionStore } from '../stores/connectionStore';

describe('ConnectionBanner', () => {
  beforeEach(() => {
    connectionStore.dismiss();
  });

  it('renders nothing when there is no error', () => {
    const { container } = render(<ConnectionBanner />);
    expect(container.querySelector('.connection-banner')).toBeNull();
  });

  it('renders the error message when connectionStore has an error', () => {
    connectionStore.setError('Server unreachable');
    render(<ConnectionBanner />);

    expect(screen.getByText('Server unreachable')).toBeTruthy();
  });

  it('dismisses the banner when the close button is clicked', () => {
    connectionStore.setError('Connection lost');
    const { container } = render(<ConnectionBanner />);

    // Banner should be visible
    expect(container.querySelector('.connection-banner')).toBeTruthy();

    // Click the dismiss button
    const dismissBtn = container.querySelector('.connection-banner__dismiss')!;
    fireEvent.click(dismissBtn);

    // Banner should disappear
    expect(container.querySelector('.connection-banner')).toBeNull();
  });

  it('updates when the store error changes', () => {
    connectionStore.setError('Error A');
    const { container } = render(<ConnectionBanner />);
    expect(screen.getByText('Error A')).toBeTruthy();

    // Update the error — wrap in act() to flush Preact's re-render
    act(() => { connectionStore.setError('Error B'); });
    expect(screen.getByText('Error B')).toBeTruthy();
    expect(container.querySelector('.connection-banner')).toBeTruthy();
  });

  it('shows the warning icon', () => {
    connectionStore.setError('Something went wrong');
    const { container } = render(<ConnectionBanner />);
    expect(container.querySelector('.fa-triangle-exclamation')).toBeTruthy();
  });
});
