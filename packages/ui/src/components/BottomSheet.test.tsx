import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BottomSheet } from './BottomSheet';

describe('BottomSheet', () => {
  it('renders nothing when closed', () => {
    render(<BottomSheet open={false} onClose={() => {}} title="T">body</BottomSheet>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is a modal dialog named by its title, and focus moves into it', () => {
    render(<BottomSheet open onClose={() => {}} title="John 3:16">body</BottomSheet>);
    const d = screen.getByRole('dialog', { name: 'John 3:16' });
    expect(d).toHaveAttribute('aria-modal', 'true');
    expect(d).toHaveFocus();
  });

  it('uses label when there is no title', () => {
    render(<BottomSheet open onClose={() => {}} label="Definition">body</BottomSheet>);
    expect(screen.getByRole('dialog', { name: 'Definition' })).toBeInTheDocument();
  });

  it('closes on the close button (with a translatable label), Escape and a backdrop press', async () => {
    const onClose = vi.fn();
    const { container } = render(
      <BottomSheet open onClose={onClose} title="T" labels={{ close: 'Fermer' }} portal={false}>body</BottomSheet>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    await userEvent.keyboard('{Escape}');
    fireEvent.click(container.querySelector('.kth-sheet-backdrop') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('closeOnBackdropPress=false keeps it open on a backdrop press', () => {
    const onClose = vi.fn();
    const { container } = render(<BottomSheet open onClose={onClose} title="T" closeOnBackdropPress={false} portal={false}>x</BottomSheet>);
    fireEvent.click(container.querySelector('.kth-sheet-backdrop') as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps Tab inside the sheet', async () => {
    render(<BottomSheet open onClose={() => {}} title="T"><button type="button">one</button></BottomSheet>);
    const close = screen.getByRole('button', { name: 'Close' });
    const one = screen.getByRole('button', { name: 'one' });
    one.focus();
    await userEvent.tab();
    expect(close).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(one).toHaveFocus();
  });

  it('restores focus to the opener on close', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = render(<BottomSheet open onClose={() => {}} title="T">x</BottomSheet>);
    rerender(<BottomSheet open={false} onClose={() => {}} title="T">x</BottomSheet>);
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('applies a max height', () => {
    render(<BottomSheet open onClose={() => {}} title="T" maxHeight="70dvh">x</BottomSheet>);
    expect(screen.getByRole('dialog').style.maxBlockSize).toBe('70dvh');
  });
});
