import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import NotesSetupDialog from './NotesSetupDialog';

vi.mock('../../contexts/useI18n', () => ({ useI18n: () => ({ t: (k: string) => k }) }));
vi.mock('../../services/fileNotesAPI', () => ({
  getNotesDir: () => Promise.resolve('/tmp/notes'),
  showFolderDialog: vi.fn(),
  initialize: vi.fn(),
}));

describe('NotesSetupDialog focus (B-187)', () => {
  it('moves focus into the dialog on open and keeps Tab inside it', async () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    render(<NotesSetupDialog onComplete={() => {}} onCancel={() => {}} />);
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    const user = userEvent.setup();
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    outside.remove();
  });
});
