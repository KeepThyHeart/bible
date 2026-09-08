import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DraggableTabBar, { type TabItem } from './DraggableTabBar';
import { enT } from '../testing/enCatalog';

// The tab bar resolves its default aria-label and add-button title itself;
// mocking the hook keeps the test free of a ContextProvider.
vi.mock('../contexts/useI18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => enT(key, params),
    locale: 'en' as const,
    i18n: {},
  }),
}));

const mockTabs: TabItem[] = [
  { id: 'tab1', label: 'Genesis', subtitle: 'KJV' },
  { id: 'tab2', label: 'Exodus', subtitle: 'KJV' },
  { id: 'tab3', label: 'Matthew', subtitle: 'ESV' },
];

describe('DraggableTabBar', () => {
  const onTabClick = vi.fn();
  const onTabClose = vi.fn();
  const onReorder = vi.fn();
  const onAddClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all tab labels', () => {
    render(
      <DraggableTabBar
        tabs={mockTabs}
        activeTabIndex={0}
        droppableId="test"
        onTabClick={onTabClick}
        onTabClose={onTabClose}
        onReorder={onReorder}
        onAddClick={onAddClick}
      />,
    );
    expect(screen.getByText('Genesis')).toBeInTheDocument();
    expect(screen.getByText('Exodus')).toBeInTheDocument();
    expect(screen.getByText('Matthew')).toBeInTheDocument();
  });

  it('renders add button', () => {
    render(
      <DraggableTabBar
        tabs={mockTabs}
        activeTabIndex={0}
        droppableId="test"
        onTabClick={onTabClick}
        onTabClose={onTabClose}
        onReorder={onReorder}
        onAddClick={onAddClick}
        addButtonTitle="New Tab"
      />,
    );
    expect(screen.getByRole('button', { name: 'New Tab' })).toBeInTheDocument();
  });

  it('calls onAddClick when add button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <DraggableTabBar
        tabs={mockTabs}
        activeTabIndex={0}
        droppableId="test"
        onTabClick={onTabClick}
        onTabClose={onTabClose}
        onReorder={onReorder}
        onAddClick={onAddClick}
        addButtonTitle="New Tab"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'New Tab' }));
    expect(onAddClick).toHaveBeenCalled();
  });

  it('calls onTabClick when a tab is clicked', async () => {
    const user = userEvent.setup();
    render(
      <DraggableTabBar
        tabs={mockTabs}
        activeTabIndex={0}
        droppableId="test"
        onTabClick={onTabClick}
        onTabClose={onTabClose}
        onReorder={onReorder}
        onAddClick={onAddClick}
      />,
    );
    await user.click(screen.getByText('Exodus'));
    expect(onTabClick).toHaveBeenCalledWith(1);
  });

  it('calls onTabClose when close button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <DraggableTabBar
        tabs={mockTabs}
        activeTabIndex={0}
        droppableId="test"
        onTabClick={onTabClick}
        onTabClose={onTabClose}
        onReorder={onReorder}
        onAddClick={onAddClick}
      />,
    );
    const closeButtons = screen.getAllByRole('button', { name: /close/i });
    await user.click(closeButtons[0]);
    expect(onTabClose).toHaveBeenCalledWith('tab1');
  });

  it('marks active tab with aria-selected', () => {
    render(
      <DraggableTabBar
        tabs={mockTabs}
        activeTabIndex={1}
        droppableId="test"
        onTabClick={onTabClick}
        onTabClose={onTabClose}
        onReorder={onReorder}
        onAddClick={onAddClick}
      />,
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false');
  });

  it('renders with custom tab renderer', () => {
    render(
      <DraggableTabBar
        tabs={mockTabs}
        activeTabIndex={0}
        droppableId="test"
        onTabClick={onTabClick}
        onTabClose={onTabClose}
        onReorder={onReorder}
        onAddClick={onAddClick}
        renderTab={(tab) => <span data-testid={`custom-${tab.id}`}>{tab.label} custom</span>}
      />,
    );
    expect(screen.getByTestId('custom-tab1')).toBeInTheDocument();
    expect(screen.getByText('Genesis custom')).toBeInTheDocument();
  });

  it('uses aria-label for the tablist', () => {
    render(
      <DraggableTabBar
        tabs={mockTabs}
        activeTabIndex={0}
        droppableId="test"
        onTabClick={onTabClick}
        onTabClose={onTabClose}
        onReorder={onReorder}
        onAddClick={onAddClick}
        ariaLabel="Bible tabs"
      />,
    );
    expect(screen.getByRole('tablist', { name: 'Bible tabs' })).toBeInTheDocument();
  });
});
