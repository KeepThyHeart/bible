import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, act } from '@testing-library/preact';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { UpdateBanner } from './UpdateBanner';
import { updateStore } from '../stores/updateStore';

describe('UpdateBanner', () => {
  beforeEach(() => { updateStore.setAvailable(false); });

  it('renders nothing until an update is available', () => {
    render(<UpdateBanner />);
    expect(screen.queryByTestId('update-banner')).toBeNull();
    act(() => updateStore.setAvailable(true));
    expect(screen.getByTestId('update-banner')).toBeTruthy();
  });

  it('can be dismissed', () => {
    updateStore.setAvailable(true);
    render(<UpdateBanner />);
    fireEvent.click(screen.getByTitle('updateBanner.later'));
    expect(screen.queryByTestId('update-banner')).toBeNull();
  });
});
