import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defineSettings, extractFields } from '@bible/core/browser';
import { SettingsForm } from './SettingsForm';

const registry = defineSettings([
  { key: 'swipe', type: 'boolean', default: true, scope: 'device', group: 'g', labelKey: 'k.swipe', label: 'Swipe to change chapters', description: 'Horizontal swipes navigate.' },
  { key: 'threshold', type: 'integer', default: 100, min: 20, max: 400, widget: 'slider', scope: 'device', group: 'g', labelKey: 'k.t', label: 'Threshold', dependsOn: { swipe: true } },
  { key: 'layout', type: 'enum', values: ['inline', 'stacked'], default: 'stacked', scope: 'device', group: 'g', labelKey: 'k.l', label: 'Layout', valueLabelKeys: { inline: 'k.inline' } },
  { key: 'tags', type: 'string-array', default: [], scope: 'device', group: 'g', labelKey: 'k.tags', label: 'Tags' },
]);

function setup(values: Record<string, unknown>, translate?: (k: string, f: string) => string) {
  const onChange = vi.fn();
  const fields = registry.toFields('g', { values, ...(translate ? { translate } : {}) });
  render(<SettingsForm fields={fields} values={values} onChange={onChange} />);
  return { onChange, user: userEvent.setup() };
}

describe('SettingsForm', () => {
  it('renders registry fields with labels and descriptions', () => {
    setup({ ...registry.defaults() });
    expect(screen.getByLabelText('Swipe to change chapters')).toBeChecked();
    expect(screen.getByLabelText('Swipe to change chapters')).toHaveAccessibleDescription('Horizontal swipes navigate.');
    expect(screen.getByLabelText(/Threshold/)).toHaveAttribute('type', 'range');
    expect(screen.getByLabelText(/Threshold/)).toHaveAttribute('min', '20');
  });

  it('uses translated labels and enum option text', () => {
    setup({ ...registry.defaults() }, (k, f) => (k === 'k.inline' ? 'Inline (translated)' : f));
    expect(screen.getByRole('option', { name: 'Inline (translated)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'stacked' })).toBeInTheDocument();
  });

  it('hides fields whose dependsOn does not match', () => {
    setup({ ...registry.defaults(), swipe: false });
    expect(screen.queryByLabelText(/Threshold/)).toBeNull();
  });

  it('reports changes by key', async () => {
    const { onChange, user } = setup({ ...registry.defaults() });
    await user.click(screen.getByLabelText('Swipe to change chapters'));
    expect(onChange).toHaveBeenCalledWith('swipe', false);
    await user.selectOptions(screen.getByLabelText('Layout'), 'inline');
    expect(onChange).toHaveBeenCalledWith('layout', 'inline');
    await user.type(screen.getByLabelText('Tags'), 'a');
    expect(onChange).toHaveBeenCalledWith('tags', ['a']);
  });

  it('renders JSON Schema fields too (the extension path) with a custom id prefix', () => {
    const fields = extractFields({
      type: 'object',
      properties: { endpoint: { type: 'string', title: 'Endpoint', format: 'uri' }, group: { type: 'object', title: 'Advanced', properties: { n: { type: 'integer', title: 'Count' } } } },
    });
    render(<SettingsForm fields={fields} values={{ endpoint: 'https://x' }} onChange={() => undefined} idPrefix="ext-setting" />);
    expect(screen.getByLabelText('Endpoint')).toHaveAttribute('id', 'ext-setting-endpoint');
    expect(screen.getByLabelText('Endpoint')).toHaveAttribute('type', 'url');
    expect(screen.getByRole('group', { name: 'Advanced' })).toBeInTheDocument();
    expect(screen.getByLabelText('Count')).toHaveAttribute('id', 'ext-setting-group-n');
  });

  it('an hour field is a list of clock times between its min and max, and reports the hour', async () => {
    const hours = defineSettings([
      { key: 'rollover', type: 'integer', default: 3, min: 0, max: 12, widget: 'hour', scope: 'device', group: 'h', labelKey: 'k.r', label: 'New day starts at' },
    ]);
    const onChange = vi.fn();
    render(<SettingsForm fields={hours.toFields('h', { values: { rollover: 3 } })} values={{ rollover: 3 }} onChange={onChange}
      labels={{ formatHour: (h) => `${h}h` }} />);
    const select = screen.getByLabelText('New day starts at');
    expect(select.tagName).toBe('SELECT');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(Array.from({ length: 13 }, (_, i) => `${i}h`));
    expect(select).toHaveValue('3');
    await userEvent.setup().selectOptions(select, '5');
    expect(onChange).toHaveBeenCalledWith('rollover', 5);
  });

  it('refuses an hour widget on a non-integer or out-of-range setting', () => {
    expect(() => defineSettings([{ key: 'x', type: 'number', default: 1, widget: 'hour', scope: 'device', group: 'h', labelKey: 'k', label: 'x' }])).toThrow();
    expect(() => defineSettings([{ key: 'x', type: 'integer', default: 1, max: 30, widget: 'hour', scope: 'device', group: 'h', labelKey: 'k', label: 'x' }])).toThrow();
  });
});
