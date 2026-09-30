import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FullscreenPanel } from './FullscreenPanel';

describe('FullscreenPanel', () => {
  it('renders nothing when closed', () => {
    render(<FullscreenPanel open={false} onClose={() => {}} title="T">body</FullscreenPanel>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is a modal dialog named by title or label, and focus moves in', () => {
    const { unmount } = render(<FullscreenPanel open onClose={() => {}} title="Timeline">body</FullscreenPanel>);
    const d = screen.getByRole('dialog', { name: 'Timeline' });
    expect(d).toHaveAttribute('aria-modal', 'true');
    expect(d).toHaveFocus();
    unmount();
    render(<FullscreenPanel open onClose={() => {}} label="Map">body</FullscreenPanel>);
    expect(screen.getByRole('dialog', { name: 'Map' })).toBeInTheDocument();
  });

  it('closes on Escape and the close button', async () => {
    const onClose = vi.fn();
    render(<FullscreenPanel open onClose={onClose} title="T" labels={{ close: 'Fermer' }}>body</FullscreenPanel>);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('closeOnEscape=false ignores Escape', async () => {
    const onClose = vi.fn();
    render(<FullscreenPanel open onClose={onClose} title="T" closeOnEscape={false}>body</FullscreenPanel>);
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps Tab inside', async () => {
    render(<FullscreenPanel open onClose={() => {}} title="T"><button type="button">one</button></FullscreenPanel>);
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
    const { rerender } = render(<FullscreenPanel open onClose={() => {}} title="T">x</FullscreenPanel>);
    rerender(<FullscreenPanel open={false} onClose={() => {}} title="T">x</FullscreenPanel>);
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('hideHeader omits the header but keeps the dialog named by label', () => {
    render(<FullscreenPanel open onClose={() => {}} label="Map" hideHeader>body</FullscreenPanel>);
    expect(screen.getByRole('dialog', { name: 'Map' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });
});
