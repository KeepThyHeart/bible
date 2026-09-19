import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TabStrip } from './TabStrip';

describe('TabStrip', () => {
  const tabs = [
    { id: 'bible', label: 'Bible', testId: 'tab-bible' },
    { id: 'commentary', label: 'Commentary', testId: 'tab-commentary' },
    { id: 'dictionary', label: 'Dictionary' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all tabs', () => {
    const onChange = vi.fn();
    render(<TabStrip tabs={tabs} activeId="bible" onChange={onChange} />);

    expect(screen.getByText('Bible')).toBeInTheDocument();
    expect(screen.getByText('Commentary')).toBeInTheDocument();
    expect(screen.getByText('Dictionary')).toBeInTheDocument();
  });

  it('marks the active tab with aria-selected="true"', () => {
    const onChange = vi.fn();
    render(<TabStrip tabs={tabs} activeId="commentary" onChange={onChange} />);

    const commentaryTab = screen.getByRole('tab', { name: 'Commentary' });
    expect(commentaryTab).toHaveAttribute('aria-selected', 'true');
  });

  it('marks inactive tabs with aria-selected="false"', () => {
    const onChange = vi.fn();
    render(<TabStrip tabs={tabs} activeId="commentary" onChange={onChange} />);

    const bibleTab = screen.getByRole('tab', { name: 'Bible' });
    const dictionaryTab = screen.getByRole('tab', { name: 'Dictionary' });

    expect(bibleTab).toHaveAttribute('aria-selected', 'false');
    expect(dictionaryTab).toHaveAttribute('aria-selected', 'false');
  });

  it('sets tabIndex to 0 for active tab, -1 for inactive tabs', () => {
    const onChange = vi.fn();
    render(<TabStrip tabs={tabs} activeId="bible" onChange={onChange} />);

    const bibleTab = screen.getByRole('tab', { name: 'Bible' });
    const commentaryTab = screen.getByRole('tab', { name: 'Commentary' });

    expect(bibleTab).toHaveAttribute('tabIndex', '0');
    expect(commentaryTab).toHaveAttribute('tabIndex', '-1');
  });

  it('calls onChange when a tab is clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TabStrip tabs={tabs} activeId="bible" onChange={onChange} />);

    await user.click(screen.getByRole('tab', { name: 'Commentary' }));
    expect(onChange).toHaveBeenCalledWith('commentary');
  });

  it('supports arrow key navigation', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TabStrip tabs={tabs} activeId="bible" onChange={onChange} />);

    const tablist = screen.getByRole('tablist');
    await user.click(tablist);
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });

    expect(onChange).toHaveBeenCalledWith('commentary');
  });

  it('supports arrow key navigation backwards', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TabStrip tabs={tabs} activeId="commentary" onChange={onChange} />);

    const tablist = screen.getByRole('tablist');
    await user.click(tablist);
    fireEvent.keyDown(tablist, { key: 'ArrowLeft' });

    expect(onChange).toHaveBeenCalledWith('bible');
  });

  it('wraps around when navigating past the last tab', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TabStrip tabs={tabs} activeId="dictionary" onChange={onChange} />);

    const tablist = screen.getByRole('tablist');
    await user.click(tablist);
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });

    expect(onChange).toHaveBeenCalledWith('bible');
  });

  it('supports Home key to select first tab', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TabStrip tabs={tabs} activeId="dictionary" onChange={onChange} />);

    const tablist = screen.getByRole('tablist');
    await user.click(tablist);
    fireEvent.keyDown(tablist, { key: 'Home' });

    expect(onChange).toHaveBeenCalledWith('bible');
  });

  it('supports End key to select last tab', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TabStrip tabs={tabs} activeId="bible" onChange={onChange} />);

    const tablist = screen.getByRole('tablist');
    await user.click(tablist);
    fireEvent.keyDown(tablist, { key: 'End' });

    expect(onChange).toHaveBeenCalledWith('dictionary');
  });

  it('applies testId to tabs when provided', () => {
    const onChange = vi.fn();
    render(<TabStrip tabs={tabs} activeId="bible" onChange={onChange} />);

    expect(screen.getByTestId('tab-bible')).toBeInTheDocument();
    expect(screen.getByTestId('tab-commentary')).toBeInTheDocument();
  });

  it('renders trailing tabs separated visually', () => {
    const onChange = vi.fn();
    const trailingTabs = [
      { id: 'features', label: 'Feature packs' },
      { id: 'sources', label: 'Sources' },
    ];
    render(
      <TabStrip tabs={tabs} activeId="bible" onChange={onChange} trailingTabs={trailingTabs} />
    );

    expect(screen.getByText('Feature packs')).toBeInTheDocument();
    expect(screen.getByText('Sources')).toBeInTheDocument();
  });

  it('activates trailing tabs when clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const trailingTabs = [
      { id: 'features', label: 'Feature packs' },
      { id: 'sources', label: 'Sources' },
    ];
    render(
      <TabStrip tabs={tabs} activeId="bible" onChange={onChange} trailingTabs={trailingTabs} />
    );

    await user.click(screen.getByRole('tab', { name: 'Feature packs' }));
    expect(onChange).toHaveBeenCalledWith('features');
  });

  it('includes trailing tabs in keyboard navigation', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const trailingTabs = [
      { id: 'features', label: 'Feature packs' },
    ];
    render(
      <TabStrip tabs={tabs} activeId="dictionary" onChange={onChange} trailingTabs={trailingTabs} />
    );

    const tablist = screen.getByRole('tablist');
    await user.click(tablist);
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });

    expect(onChange).toHaveBeenCalledWith('features');
  });

  it('applies aria-label when provided', () => {
    const onChange = vi.fn();
    render(
      <TabStrip
        tabs={tabs}
        activeId="bible"
        onChange={onChange}
        ariaLabel="Module types"
      />
    );

    expect(screen.getByRole('tablist')).toHaveAttribute('aria-label', 'Module types');
  });

  it('has role="tablist" on container', () => {
    const onChange = vi.fn();
    render(<TabStrip tabs={tabs} activeId="bible" onChange={onChange} />);

    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('has role="tab" on each tab button', () => {
    const onChange = vi.fn();
    render(<TabStrip tabs={tabs} activeId="bible" onChange={onChange} />);

    expect(screen.getAllByRole('tab').length).toBe(3);
  });
});
