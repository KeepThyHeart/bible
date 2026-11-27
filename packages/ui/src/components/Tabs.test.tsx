import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs, tabPanelProps } from './Tabs';

const TABS = [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }, { id: 'c', label: 'Gamma' }];

function Harness({ dir, start = 'a' }: { dir?: 'ltr' | 'rtl'; start?: string }) {
  const [v, setV] = useState(start);
  return (
    <div>
      <Tabs tabs={TABS} value={v} onChange={setV} label="Sections" idPrefix="t" dir={dir} />
      <div {...tabPanelProps('t', v)}>panel {v}</div>
    </div>
  );
}

describe('Tabs', () => {
  it('has tablist/tab roles, selection, ids and roving tabindex', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: 'Sections' })).toBeInTheDocument();
    const a = screen.getByRole('tab', { name: 'Alpha' });
    const b = screen.getByRole('tab', { name: 'Beta' });
    expect(a).toHaveAttribute('aria-selected', 'true');
    expect(a).toHaveAttribute('id', 't-tab-a');
    expect(a).toHaveAttribute('aria-controls', 't-panel-a');
    expect(a).toHaveAttribute('tabindex', '0');
    expect(b).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 't-tab-a');
  });

  it('selects on click', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('tab', { name: 'Beta' }));
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('panel b')).toBeInTheDocument();
  });

  it('moves and selects with arrows (wrapping), Home and End', async () => {
    render(<Harness />);
    screen.getByRole('tab', { name: 'Alpha' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Gamma' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Gamma' })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveFocus();
  });

  it('swaps the arrows in RTL', async () => {
    render(<Harness dir="rtl" />);
    screen.getByRole('tab', { name: 'Alpha' }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveFocus();
  });
});
