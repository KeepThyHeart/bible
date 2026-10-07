import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppBadge } from './AppBadge';
import { AppRail } from './AppRail';
import { AppTileGrid } from './AppTileGrid';
import { AppSheet } from './AppSheet';
import { AppSwitchButton } from './AppSwitchButton';
import { AppStage } from './AppStage';
import type { AppNavEntry } from './types';

const items: AppNavEntry[] = [
  { id: 'read', title: 'Read', icon: <i>r</i>, shortcutHint: 'Ctrl+Shift+1' },
  { id: 'study', title: 'Study', icon: <i>s</i>, badge: { kind: 'count', value: 3, tone: 'attention', label: '3 unread' } },
  { id: 'quiz', title: 'Quiz', icon: <i>q</i> },
];

describe('AppBadge', () => {
  it('renders count with accessible text and tone class', () => {
    const { container } = render(<AppBadge badge={{ kind: 'count', value: 5, tone: 'attention', label: '5 new' }} />);
    expect(screen.getByText('5 new')).toHaveClass('kth-visually-hidden');
    expect(screen.getByText('5')).toHaveAttribute('aria-hidden', 'true');
    expect(container.firstElementChild).toHaveClass('kth-app-badge--count', 'kth-app-badge--attention');
  });
  it('renders dot (no value) and text variants', () => {
    const { container, rerender } = render(<AppBadge badge={{ kind: 'dot', tone: 'live', label: 'Live' }} />);
    expect(container.firstElementChild).toHaveClass('kth-app-badge--dot', 'kth-app-badge--live');
    expect(container.querySelector('.kth-app-badge__value')).toBeNull();
    expect(screen.getByText('Live')).toBeInTheDocument();
    rerender(<AppBadge badge={{ kind: 'text', value: 'New', tone: 'neutral', label: 'New feature' }} />);
    expect(container.firstElementChild).toHaveClass('kth-app-badge--text', 'kth-app-badge--neutral');
    expect(screen.getByText('New')).toBeInTheDocument();
  });
});

describe('AppRail', () => {
  it('renders a labelled nav with buttons, tooltip and aria-current', () => {
    render(<AppRail items={items} activeId="study" onSelect={() => {}} labels={{ railLabel: 'Applications' }} />);
    expect(screen.getByRole('navigation', { name: 'Applications' })).toBeInTheDocument();
    const read = screen.getByRole('button', { name: 'Read' });
    expect(read).toHaveAttribute('title', 'Read (Ctrl+Shift+1)');
    expect(read).not.toHaveAttribute('aria-current');
    const study = screen.getByRole('button', { name: /Study/ });
    expect(study).toHaveAttribute('aria-current', 'page');
    expect(study).toHaveAccessibleName(/Study.*3 unread/ );
  });

  it('uses a roving tabindex starting at the active item', () => {
    render(<AppRail items={items} activeId="study" onSelect={() => {}} />);
    const tabs = screen.getAllByRole('button').map((b) => b.getAttribute('tabindex'));
    expect(tabs).toEqual(['-1', '0', '-1']);
  });

  it('moves focus with arrows (wrapping), Home and End', async () => {
    render(<AppRail items={items} activeId="read" onSelect={() => {}} />);
    const [read, study, quiz] = screen.getAllByRole('button');
    read.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(study).toHaveFocus();
    expect(study).toHaveAttribute('tabindex', '0');
    expect(read).toHaveAttribute('tabindex', '-1');
    await userEvent.keyboard('{End}');
    expect(quiz).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(read).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(quiz).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(read).toHaveFocus();
  });

  it('horizontal orientation uses left/right arrows', async () => {
    render(<AppRail items={items} activeId="read" onSelect={() => {}} orientation="horizontal" />);
    const [read, study] = screen.getAllByRole('button');
    read.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(read).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(study).toHaveFocus();
  });

  it('calls onSelect on click and onPrefetch on hover and focus', async () => {
    const onSelect = vi.fn();
    const onPrefetch = vi.fn();
    render(<AppRail items={items} activeId="read" onSelect={onSelect} onPrefetch={onPrefetch} />);
    const quiz = screen.getByRole('button', { name: 'Quiz' });
    await userEvent.hover(quiz);
    expect(onPrefetch).toHaveBeenCalledWith('quiz');
    onPrefetch.mockClear();
    screen.getByRole('button', { name: 'Read' }).focus();
    expect(onPrefetch).toHaveBeenCalledWith('read');
    await userEvent.click(quiz);
    expect(onSelect).toHaveBeenCalledWith('quiz');
  });
});

describe('AppTileGrid', () => {
  it('renders a labelled list of tiles with badges', () => {
    render(<AppTileGrid items={items} onSelect={() => {}} labels={{ gridLabel: 'All apps' }} />);
    expect(screen.getByRole('list', { name: 'All apps' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('button', { name: /Study/ })).toHaveTextContent('3 unread');
  });
  it('selects and prefetches', async () => {
    const onSelect = vi.fn();
    const onPrefetch = vi.fn();
    render(<AppTileGrid items={items} onSelect={onSelect} onPrefetch={onPrefetch} />);
    const quiz = screen.getByRole('button', { name: 'Quiz' });
    await userEvent.hover(quiz);
    expect(onPrefetch).toHaveBeenCalledWith('quiz');
    await userEvent.click(quiz);
    expect(onSelect).toHaveBeenCalledWith('quiz');
  });
});

describe('AppSheet', () => {
  it('renders nothing when closed', () => {
    render(<AppSheet open={false} onClose={() => {}} items={items} activeId="read" onSelect={() => {}} title="Apps" />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('lists items, marks active, and selecting calls onSelect then onClose', async () => {
    const calls: string[] = [];
    render(
      <AppSheet open onClose={() => calls.push('close')} items={items} activeId="read" onSelect={(id) => calls.push(`select:${id}`)} title="Apps" />,
    );
    expect(screen.getByRole('dialog', { name: 'Apps' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Read' })).toHaveAttribute('aria-current', 'page');
    await userEvent.click(screen.getByRole('button', { name: /Study/ }));
    expect(calls).toEqual(['select:study', 'close']);
  });
  it('closes with the close button', async () => {
    const onClose = vi.fn();
    render(<AppSheet open onClose={onClose} items={items} activeId={null} onSelect={() => {}} title="Apps" labels={{ close: 'Fermer' }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('AppSwitchButton', () => {
  it('is a named button that shows the aggregate badge and clicks', async () => {
    const onClick = vi.fn();
    render(<AppSwitchButton title="Switch app" icon={<i>x</i>} badge={{ kind: 'dot', tone: 'attention', label: 'Activity elsewhere' }} onClick={onClick} />);
    const b = screen.getByRole('button', { name: /Switch app/  });
    await userEvent.click(b);
    expect(onClick).toHaveBeenCalled();
  });
  it('works without a badge', () => {
    const { container } = render(<AppSwitchButton title="Switch" icon="i" onClick={() => {}} className="mine" />);
    expect(container.querySelector('.kth-app-badge')).toBeNull();
    expect(screen.getByRole('button', { name: 'Switch' })).toHaveClass('kth-app-switch', 'mine');
  });
});

function Counter({ name }: { name: string }) {
  const [n, setN] = useState(0);
  return <button type="button" onClick={() => setN(n + 1)}>{name}:{n}</button>;
}

describe('AppStage', () => {
  const mk = (active: string) => [
    { id: 'a', active: active === 'a', view: <Counter name="A" /> },
    { id: 'b', active: active === 'b', view: <Counter name="B" /> },
  ];

  it('hides and inerts inactive apps but keeps them mounted', () => {
    const { container } = render(<AppStage apps={mk('a')} />);
    const a = container.querySelector('[data-app="a"]') as HTMLElement;
    const b = container.querySelector('[data-app="b"]') as HTMLElement;
    expect(a).not.toHaveAttribute('hidden');
    expect(a).not.toHaveAttribute('aria-hidden');
    expect(a).not.toHaveAttribute('inert');
    expect(b).toHaveAttribute('hidden');
    expect(b).toHaveAttribute('aria-hidden', 'true');
    expect(b).toHaveAttribute('inert');
    expect(a).toHaveClass('kth-app-stage__app');
  });

  it('preserves state across active switches', () => {
    const { rerender } = render(<AppStage apps={mk('a')} />);
    fireEvent.click(screen.getByText('A:0'));
    expect(screen.getByText('A:1')).toBeInTheDocument();
    rerender(<AppStage apps={mk('b')} />);
    fireEvent.click(screen.getByText('B:0', { ignore: 'none' }));
    rerender(<AppStage apps={mk('a')} />);
    expect(screen.getByText('A:1')).toBeInTheDocument();
    expect(screen.getByText('B:1')).toBeInTheDocument();
  });

  it('applies appClassName', () => {
    const { container } = render(<AppStage apps={mk('a')} appClassName={(id) => `host-${id}`} />);
    expect(container.querySelector('[data-app="b"]')).toHaveClass('kth-app-stage__app', 'host-b');
  });

  it('shows the fallback only while pending and not mounted', () => {
    const { rerender } = render(<AppStage apps={mk('a')} fallback="Loading" pendingId={null} />);
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<AppStage apps={mk('a')} fallback="Loading" pendingId="c" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    rerender(<AppStage apps={mk('a')} fallback="Loading" pendingId="b" />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

import { AppsPreferences } from './AppsPreferences';

describe('AppsPreferences', () => {
  const rows = [
    { id: 'study', title: 'Study', hidden: false, locked: true },
    { id: 'present', title: 'Presenter', hidden: false },
  ];
  it('changes mode, order and visibility', async () => {
    const onMode = vi.fn(), onOrder = vi.fn(), onHidden = vi.fn();
    render(<AppsPreferences mode="auto" onModeChange={onMode} items={rows} onOrderChange={onOrder} onHiddenChange={onHidden} />);
    await userEvent.selectOptions(screen.getByLabelText('App switcher'), 'rail');
    expect(onMode).toHaveBeenCalledWith('rail');
    await userEvent.click(screen.getByRole('button', { name: 'Move up: Presenter' }));
    expect(onOrder).toHaveBeenCalledWith(['present', 'study']);
    expect(screen.getByRole('button', { name: 'Move up: Study' })).toBeDisabled();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes[0]).toBeDisabled();
    await userEvent.click(boxes[1]);
    expect(onHidden).toHaveBeenCalledWith('present', true);
  });
});
