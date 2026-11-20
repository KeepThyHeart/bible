import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog } from './Dialog';
import { MessageBox } from './MessageBox';

describe('Dialog', () => {
  it('renders nothing when closed', () => {
    render(<Dialog open={false} onClose={() => {}} title="T">body</Dialog>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is a modal named by its title and described by its subtitle', () => {
    render(<Dialog open onClose={() => {}} title="Plan" subtitle="Pick one">body</Dialog>);
    const d = screen.getByRole('dialog', { name: 'Plan' });
    expect(d).toHaveAttribute('aria-modal', 'true');
    expect(d).toHaveAccessibleDescription('Pick one');
    expect(d).toHaveClass('kth-dialog--md');
  });

  it('supports size, alertdialog role and a footer', () => {
    render(<Dialog open onClose={() => {}} title="T" size="lg" role="alertdialog" footer={<button type="button">Go</button>}>x</Dialog>);
    expect(screen.getByRole('alertdialog')).toHaveClass('kth-dialog--lg');
    expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();
  });

  it('focuses the first control of the body, else the dialog', () => {
    const { unmount } = render(<Dialog open onClose={() => {}} title="T"><input aria-label="name" /></Dialog>);
    expect(screen.getByLabelText('name')).toHaveFocus();
    unmount();
    render(<Dialog open onClose={() => {}} title="T2">text</Dialog>);
    expect(screen.getByRole('dialog')).toHaveFocus();
  });

  it('closes on the close button, Escape and a backdrop press', async () => {
    const onClose = vi.fn();
    const { container } = render(<Dialog open onClose={onClose} title="T" labels={{ close: 'Fermer' }} portal={false}>body</Dialog>);
    await userEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    await userEvent.keyboard('{Escape}');
    fireEvent.click(container.querySelector('.kth-dialog-backdrop') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('closeOnBackdropPress=false and showClose=false', () => {
    const onClose = vi.fn();
    const { container } = render(<Dialog open onClose={onClose} title="T" closeOnBackdropPress={false} showClose={false} portal={false}>x</Dialog>);
    fireEvent.click(container.querySelector('.kth-dialog-backdrop') as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('cycles Tab inside', async () => {
    render(<Dialog open onClose={() => {}} title="T" footer={<button type="button">Last</button>}><button type="button">one</button></Dialog>);
    const close = screen.getByRole('button', { name: 'Close' });
    const last = screen.getByRole('button', { name: 'Last' });
    screen.getByRole('button', { name: 'one' }).focus();
    await userEvent.tab();
    expect(last).toHaveFocus();
    await userEvent.tab();
    expect(close).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(last).toHaveFocus();
  });

  it('returns focus to the opener on close', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = render(<Dialog open onClose={() => {}} title="T">x</Dialog>);
    rerender(<Dialog open={false} onClose={() => {}} title="T">x</Dialog>);
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('Escape closes only the top-most dialog', async () => {
    const lower = vi.fn();
    const top = vi.fn();
    const box = (open: boolean) => (
      <Dialog open onClose={lower} title="Lower">
        <MessageBox open={open} title="Sure?" confirmLabel="Yes" cancelLabel="No" onConfirm={() => {}} onCancel={top} />
      </Dialog>
    );
    const { rerender } = render(box(false));
    rerender(box(true));
    await userEvent.keyboard('{Escape}');
    expect(top).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
  });
});

describe('MessageBox', () => {
  it('is an alertdialog with confirm and cancel; confirm takes the focus', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<MessageBox open title="Delete?" message="Gone for good." confirmLabel="Delete" cancelLabel="Keep" onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByRole('alertdialog', { name: 'Delete?' })).toBeInTheDocument();
    expect(screen.getByText('Gone for good.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('kth-btn--primary');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('danger focuses cancel and styles confirm as danger', () => {
    render(<MessageBox open tone="danger" title="T" confirmLabel="Delete" cancelLabel="Keep" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('button', { name: 'Keep' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('kth-btn--danger');
  });

  it('has a single button without cancelLabel, no close button, and Escape cancels', async () => {
    const onCancel = vi.fn();
    render(<MessageBox open title="Done" confirmLabel="OK" onConfirm={() => {}} onCancel={onCancel} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
  });

  it('busy disables the buttons', () => {
    render(<MessageBox open busy title="T" confirmLabel="Yes" cancelLabel="No" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('button', { name: 'Yes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'No' })).toBeDisabled();
  });
});
