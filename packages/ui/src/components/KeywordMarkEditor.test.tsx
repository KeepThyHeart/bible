import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KeywordMarkEditor } from './KeywordMarkEditor';
import type { KeywordMark } from '@bible/core/browser';

function setup(mark?: KeywordMark, extra: { onDelete?: () => void } = {}) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(<KeywordMarkEditor mark={mark} onSave={onSave} onCancel={onCancel} {...extra} />);
  return { onSave, onCancel, user: userEvent.setup() };
}

const existing: KeywordMark = {
  id: 'k1', label: 'Love', rule: { kind: 'word', forms: ['love', 'loved'] },
  style: { color: 'mark.4', line: 'dotted', symbol: '●' }, enabled: false,
};

describe('KeywordMarkEditor', () => {
  it('shows validation errors for an empty new mark and does not save', async () => {
    const { onSave, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    const alerts = screen.getAllByRole('alert').map((a) => a.textContent);
    expect(alerts).toEqual(['Enter a name.', 'Enter at least one word form.']);
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('textbox', { name: 'Word forms' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('saves a word mark with trimmed comma-separated forms', async () => {
    const { onSave, user } = setup();
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Love');
    await user.type(screen.getByRole('textbox', { name: 'Word forms' }), 'love, loved , loveth');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as KeywordMark;
    expect(saved.label).toBe('Love');
    expect(saved.rule).toEqual({ kind: 'word', forms: ['love', 'loved', 'loveth'] });
    expect(saved.style).toEqual({ color: 'mark.1', line: 'solid' });
    expect(saved.enabled).toBe(true);
    expect(saved.id).toBeTruthy();
  });

  it('validates Strong\'s numbers', async () => {
    const { onSave, user } = setup();
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Faith');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Match by' }), 'strongs');
    await user.type(screen.getByRole('textbox', { name: "Strong's numbers" }), 'faith');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent("Enter Strong's numbers like G4102 or H430.");
    await user.clear(screen.getByRole('textbox', { name: "Strong's numbers" }));
    await user.type(screen.getByRole('textbox', { name: "Strong's numbers" }), 'g4102, G4100');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect((onSave.mock.calls[0][0] as KeywordMark).rule).toEqual({ kind: 'strongs', numbers: ['G4102', 'G4100'] });
  });

  it('requires a connective category, then saves it', async () => {
    const { onSave, user } = setup();
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Therefore');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Match by' }), 'connective');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a category.');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Category' }), 'inference');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect((onSave.mock.calls[0][0] as KeywordMark).rule).toEqual({ kind: 'connective', category: 'inference' });
  });

  it('saves a phrase with match case', async () => {
    const { onSave, user } = setup();
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Kingdom');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Match by' }), 'phrase');
    await user.type(screen.getByRole('textbox', { name: 'Phrase' }), 'kingdom of God');
    await user.click(screen.getByRole('checkbox', { name: 'Match case' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect((onSave.mock.calls[0][0] as KeywordMark).rule).toEqual({ kind: 'phrase', text: 'kingdom of God', matchCase: true });
  });

  it('loads an existing mark, keeps its id, and edits the style', async () => {
    const { onSave, user } = setup(existing);
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Love');
    expect(screen.getByRole('textbox', { name: 'Word forms' })).toHaveValue('love, loved');
    expect(screen.getByRole('checkbox', { name: 'Enabled' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Pink' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('radio', { name: 'Green' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const saved = onSave.mock.calls[0][0] as KeywordMark;
    expect(saved.id).toBe('k1');
    expect(saved.style).toEqual({ color: 'mark.3', line: 'dotted', symbol: '●' });
    expect(saved.enabled).toBe(false);
  });

  it('cancel and delete call back; delete only shows when provided', async () => {
    const onDelete = vi.fn();
    const { onCancel, user } = setup(existing, { onDelete });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalled();
  });

  it('has no Delete button for a new mark', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });
});
