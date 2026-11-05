import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/preact';
import { PresentHelp } from './PresentHelp';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

describe('PresentHelp', () => {
  it('is a named modal dialog that takes focus and returns it on close', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const onClose = vi.fn();
    const { getByRole, rerender } = render(<PresentHelp isOpen onClose={onClose} />);
    const dialog = getByRole('dialog', { name: 'present.title' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    rerender(<PresentHelp isOpen={false} onClose={onClose} />);
    await waitFor(() => expect(document.activeElement).toBe(opener));
    opener.remove();
  });

  it('closes from its Close button', () => {
    const onClose = vi.fn();
    const { getByLabelText } = render(<PresentHelp isOpen onClose={onClose} />);
    fireEvent.click(getByLabelText('present.close'));
    expect(onClose).toHaveBeenCalled();
  });
});
