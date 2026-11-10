import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/preact';
import { Toolbar } from './Toolbar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// 0209 round 5: the Insert menu is a keyboard-operable menu button.
describe('Toolbar Insert menu', () => {
  it('focuses the first item, moves with arrows, and Escape returns to the button', async () => {
    const { getByText, getAllByRole } = render(<Toolbar view={null} tick={0} />);
    const button = getByText('present.editor.insert');
    fireEvent.click(button);
    const items = () => getAllByRole('menuitem');
    await waitFor(() => expect(document.activeElement).toBe(items()[0]));
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items()[1]);
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' });
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes on an outside mousedown', async () => {
    const { getByText, queryAllByRole } = render(<Toolbar view={null} tick={0} />);
    fireEvent.click(getByText('present.editor.insert'));
    await waitFor(() => expect(queryAllByRole('menuitem').length).toBe(3));
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(queryAllByRole('menuitem').length).toBe(0));
  });
});
