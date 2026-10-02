import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WordGroupEditor } from './WordGroupEditor';

describe('WordGroupEditor', () => {
  it('requires at least one term', async () => {
    const onSave = vi.fn();
    render(<WordGroupEditor onSave={onSave} onCancel={() => {}} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter at least one word.');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('builds a normalized group', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<WordGroupEditor onSave={onSave} onCancel={() => {}} />);
    await user.type(screen.getByLabelText('Name'), 'Love');
    await user.type(screen.getByLabelText('Words'), 'love, lov*{Enter}"loving kindness"{Enter}love');
    await user.type(screen.getByLabelText('Never match'), 'lovely');
    await user.click(screen.getByLabelText('Use stemming for this language'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const g = onSave.mock.calls[0][0];
    expect(g.label).toBe('Love');
    expect(g.terms).toEqual(['love', 'lov*', '"loving kindness"']);
    expect(g.exclude).toEqual(['lovely']);
    expect(g.stem).toBe(false);
    expect(g.id).toMatch(/^wg-/);
  });

  it('edits an existing group, keeps its id and offers delete and cancel', async () => {
    const onSave = vi.fn();
    const onDelete = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<WordGroupEditor group={{ id: 'g1', label: 'Love', terms: ['love'] }} onSave={onSave} onCancel={onCancel} onDelete={onDelete} />);
    expect(screen.getByLabelText('Words')).toHaveValue('love');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave.mock.calls[0][0]).toMatchObject({ id: 'g1', label: 'Love', terms: ['love'], stem: true });
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith('g1');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('hides delete for a new group and shows the syntax hint', () => {
    render(<WordGroupEditor onSave={() => {}} onCancel={() => {}} onDelete={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.getByText(/lov\*/)).toBeInTheDocument();
  });
});
