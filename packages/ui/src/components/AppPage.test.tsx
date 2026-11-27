import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { AppPage } from './AppPage';

const TABS = [{ id: 'today', label: 'Today' }, { id: 'plans', label: 'Plans' }];

function Harness() {
  const [tab, setTab] = useState('today');
  return (
    <AppPage title="Reading plans" tabs={TABS} tab={tab} onTabChange={setTab} tabsLabel="Sections" idPrefix="rp">
      <p>content {tab}</p>
    </AppPage>
  );
}

describe('AppPage', () => {
  it('renders the title as a focusable-by-script h1 and the content', () => {
    const { container } = render(<AppPage title="Quiz"><p>body</p></AppPage>);
    const h1 = screen.getByRole('heading', { level: 1, name: 'Quiz' });
    expect(h1).toHaveAttribute('tabindex', '-1');
    expect(container.querySelector('h1[tabindex="-1"]')).toBe(h1);
    expect(screen.getByText('body')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tabpanel')).toBeNull();
  });

  it('puts actions in the title row', async () => {
    const onNew = vi.fn();
    render(<AppPage title="Quiz" actions={<button type="button" onClick={onNew}>New</button>}>x</AppPage>);
    const header = screen.getByRole('heading', { level: 1 }).parentElement!;
    expect(header).toHaveClass('kth-app-page__header');
    await userEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(onNew).toHaveBeenCalled();
  });

  it('draws tabs and wraps the content in the selected tab panel', async () => {
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: 'Sections' })).toBeInTheDocument();
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('id', 'rp-panel-today');
    expect(panel).toHaveAttribute('aria-labelledby', 'rp-tab-today');
    expect(panel).toHaveTextContent('content today');
    await userEvent.click(screen.getByRole('tab', { name: 'Plans' }));
    expect(screen.getByRole('tab', { name: 'Plans' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'rp-panel-plans');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('content plans');
  });

  it('selects the first tab when tab is not given, and names the tab bar after the title by default', () => {
    render(<AppPage title="Memory" tabs={TABS}>x</AppPage>);
    expect(screen.getByRole('tablist', { name: 'Memory' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Today' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'app-page-panel-today');
  });

  it('takes fullWidth, className and dir on the root', () => {
    const { container, rerender } = render(<AppPage title="Presenter">x</AppPage>);
    const root = container.firstElementChild!;
    expect(root).toHaveClass('kth-app-page');
    expect(root).not.toHaveClass('kth-app-page--full');
    rerender(<AppPage title="Presenter" fullWidth className="kth-extra" dir="rtl">x</AppPage>);
    expect(root).toHaveClass('kth-app-page', 'kth-app-page--full', 'kth-extra');
    expect(root).toHaveAttribute('dir', 'rtl');
  });
});
