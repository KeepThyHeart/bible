/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const h = vi.hoisted(() => ({ props: null as null | Record<string, unknown>, reveal: vi.fn(), open: vi.fn() }));
vi.mock('./CompilePassageNotesDialog', () => ({
  default: (p: Record<string, unknown>) => {
    h.props = p;
    return <div data-testid="dialog" />;
  },
}));
vi.mock('../../bible/revealNotesPanel', () => ({ revealNotesPanel: h.reveal }));
vi.mock('../UserNotesPane/noteOpenRequest', () => ({ requestOpenNote: h.open }));

import CompilePassageNotesHost from './CompilePassageNotesHost';
import { requestCompilePassageNotes } from '../../../services/compile/compileRequest';
import { registerNotesCommands } from '../../../commands/notesCommands';

afterEach(() => vi.clearAllMocks());

describe('CompilePassageNotesHost', () => {
  it('opens on the event with its detail and closes again', () => {
    render(<CompilePassageNotesHost />);
    expect(screen.queryByTestId('dialog')).toBeNull();
    act(() => requestCompilePassageNotes({ reference: 'Romans 8', initialOptions: { versesWithoutNotes: 'skip' } }));
    expect(screen.getByTestId('dialog')).toBeTruthy();
    expect(h.props).toMatchObject({ initialReference: 'Romans 8', initialOptions: { versesWithoutNotes: 'skip' } });
    act(() => (h.props!.onClose as () => void)());
    expect(screen.queryByTestId('dialog')).toBeNull();
  });

  it('reveals the notes pane then requests the note in the main window only', () => {
    const { rerender } = render(<CompilePassageNotesHost />);
    act(() => requestCompilePassageNotes());
    act(() => (h.props!.onCreated as (p: string) => void)('A.bn'));
    expect(h.reveal).toHaveBeenCalledTimes(1);
    expect(h.open).toHaveBeenCalledWith('A.bn');
    rerender(<CompilePassageNotesHost isDetached />);
    act(() => (h.props!.onCreated as (p: string) => void)('B.bn'));
    expect(h.reveal).toHaveBeenCalledTimes(1);
    expect(h.open).toHaveBeenCalledWith('B.bn');
  });
});

describe('notes.compilePassageNotes command', () => {
  it('is registered and dispatches the open event', () => {
    const register = vi.fn((c: unknown) => ({ dispose: vi.fn(), c }));
    registerNotesCommands({ register } as never);
    const cmd = register.mock.calls.map((c) => c[0] as { id: string; handler: () => void }).find((c) => c.id === 'notes.compilePassageNotes');
    expect(cmd).toBeTruthy();
    const seen = vi.fn();
    window.addEventListener('command:notes:compilePassageNotes', seen);
    cmd!.handler();
    window.removeEventListener('command:notes:compilePassageNotes', seen);
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
