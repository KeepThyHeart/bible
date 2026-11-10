import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import NotesSetupDialog from './NotesSetupDialog';
import * as fileNotesAPI from '../../services/fileNotesAPI';

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

describe('NotesSetupDialog Enter in the Location field', () => {
  it('submits "Use This Folder"', async () => {
    vi.mocked(fileNotesAPI.initialize).mockResolvedValue('/tmp/notes');
    const onComplete = vi.fn();
    render(<NotesSetupDialog onComplete={onComplete} onCancel={() => {}} />);
    const input = screen.getByLabelText('notesSetupDialog.locationLabel');
    await waitFor(() => expect(input).toHaveValue('/tmp/notes'));
    const user = userEvent.setup();
    await user.click(input);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith('/tmp/notes'));
    expect(fileNotesAPI.initialize).toHaveBeenCalledWith('/tmp/notes');
  });
});

describe('NotesSetupDialog inside a hidden app (G-003)', () => {
  // A restored session can start in the Memory app while the Notes pane (in the hidden Study app)
  // needs its first-time setup. The dialog is invisible there; it must not make the page inert.
  it('leaves the rest of the page interactive while its app is hidden, and traps once shown', async () => {
    const sibling = document.createElement('button');
    document.body.appendChild(sibling);
    const stage = document.createElement('div');
    stage.hidden = true;
    document.body.appendChild(stage);
    render(<NotesSetupDialog onComplete={() => {}} onCancel={() => {}} />, {
      container: stage.appendChild(document.createElement('div')),
    });
    await Promise.resolve();
    expect(sibling.hasAttribute('inert')).toBe(false);

    stage.hidden = false;
    await waitFor(() => expect(sibling.hasAttribute('inert')).toBe(true));
    stage.remove();
    sibling.remove();
  });
});
