import { render, screen } from '@testing-library/react';
import { MessageBox } from './MessageBox';

describe('MessageBox (closed)', () => {
  it('renders nothing when closed', () => {
    render(<MessageBox open={false} title="T" confirmLabel="OK" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
