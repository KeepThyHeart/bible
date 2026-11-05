import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import HeaderActions from './HeaderActions';

vi.mock('../contexts/useI18n', () => ({
  useI18n: () => ({ t: (k: string) => k }),
}));
vi.mock('./HelpPanel', () => ({ default: () => null }));

describe('HeaderActions Preferences button', () => {
  it('holds focus when activated so the dialog can return focus to it', () => {
    render(
      <div>
        <h1 tabIndex={-1} data-testid="heading">John 3</h1>
        <HeaderActions />
      </div>,
    );
    screen.getByTestId('heading').focus();
    const opened = vi.fn();
    window.addEventListener('command:app:openPreferences', opened);

    // A synthetic click does not move focus by itself.
    fireEvent.click(screen.getByTestId('header-preferences'));

    expect(opened).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByTestId('header-preferences'));
    window.removeEventListener('command:app:openPreferences', opened);
  });
});
