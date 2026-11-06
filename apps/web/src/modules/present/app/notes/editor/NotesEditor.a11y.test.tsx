import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/preact';
import { NotesEditor } from './NotesEditor';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

// 0209 U-002: the Presenter's notes editor (a ProseMirror contenteditable) had no accessible name.
describe('NotesEditor accessibility', () => {
  it('exposes the editing surface as a named multi-line textbox', () => {
    const { getByRole } = render(<NotesEditor doc={null} onChange={() => {}} label="Notes" />);
    const box = getByRole('textbox', { name: 'Notes' });
    expect(box.getAttribute('aria-multiline')).toBe('true');
    expect(box.getAttribute('contenteditable')).toBe('true');
  });
});
