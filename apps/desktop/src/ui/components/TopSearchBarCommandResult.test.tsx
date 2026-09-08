import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TopSearchBarCommandResult from './TopSearchBarCommandResult';
import type { CommandQueryResult } from '../types/Command';

describe('TopSearchBarCommandResult', () => {
  const mockCommand: CommandQueryResult = {
    id: 'nav.goToVerse',
    order: 0,
    title: 'Go to Verse',
    category: 'Navigation',
    icon: '🔍',
    shortcut: 'Ctrl+G',
  };

  it('renders command title', () => {
    const onClick = vi.fn();
    render(
      <TopSearchBarCommandResult
        command={mockCommand}
        isSelected={false}
        onClick={onClick}
      />
    );

    expect(screen.getByText('Navigation: Go to Verse')).toBeInTheDocument();
  });

  it('displays category with title', () => {
    const onClick = vi.fn();
    render(
      <TopSearchBarCommandResult
        command={mockCommand}
        isSelected={false}
        onClick={onClick}
      />
    );

    expect(screen.getByText('Navigation: Go to Verse')).toBeInTheDocument();
  });

  it('displays icon when provided', () => {
    const onClick = vi.fn();
    render(
      <TopSearchBarCommandResult
        command={mockCommand}
        isSelected={false}
        onClick={onClick}
      />
    );

    expect(screen.getByText('🔍')).toBeInTheDocument();
  });

  it('displays shortcut badge', () => {
    const onClick = vi.fn();
    render(
      <TopSearchBarCommandResult
        command={mockCommand}
        isSelected={false}
        onClick={onClick}
      />
    );

    expect(screen.getByText('Ctrl+G')).toBeInTheDocument();
  });

  it('renders command without category', () => {
    const onClick = vi.fn();
    const command: CommandQueryResult = {
      id: 'cmd.simple',
      order: 0,
      title: 'Simple Command',
      shortcut: 'Ctrl+S',
    };

    render(
      <TopSearchBarCommandResult
        command={command}
        isSelected={false}
        onClick={onClick}
      />
    );

    expect(screen.getByText('Simple Command')).toBeInTheDocument();
    expect(screen.queryByText(':')).not.toBeInTheDocument();
  });

  it('renders command without shortcut', () => {
    const onClick = vi.fn();
    const command: CommandQueryResult = {
      id: 'cmd.noShortcut',
      order: 0,
      title: 'No Shortcut Command',
      category: 'View',
    };

    render(
      <TopSearchBarCommandResult
        command={command}
        isSelected={false}
        onClick={onClick}
      />
    );

    expect(screen.getByText('View: No Shortcut Command')).toBeInTheDocument();
  });

  it('highlights when selected', () => {
    const onClick = vi.fn();
    const { container } = render(
      <TopSearchBarCommandResult
        command={mockCommand}
        isSelected={true}
        onClick={onClick}
      />
    );

    const button = container.querySelector('button');
    expect(button).toHaveClass('bg-accent-soft');
  });

  it('shows hover state when not selected', () => {
    const onClick = vi.fn();
    const { container } = render(
      <TopSearchBarCommandResult
        command={mockCommand}
        isSelected={false}
        onClick={onClick}
      />
    );

    const button = container.querySelector('button');
    expect(button).toHaveClass('hover:bg-accent-light');
  });

  it('calls onClick handler when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { container } = render(
      <TopSearchBarCommandResult
        command={mockCommand}
        isSelected={false}
        onClick={onClick}
      />
    );

    const button = container.querySelector('button')!;
    await user.click(button);

    expect(onClick).toHaveBeenCalled();
  });

  it('uses onMouseDown for click handling', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { container } = render(
      <TopSearchBarCommandResult
        command={mockCommand}
        isSelected={false}
        onClick={onClick}
      />
    );

    const button = container.querySelector('button')!;
    await user.pointer({ target: button, keys: '[MouseLeft>]' });

    expect(onClick).toHaveBeenCalled();
  });

  it('renders with proper button attributes', () => {
    const onClick = vi.fn();
    const { container } = render(
      <TopSearchBarCommandResult
        command={mockCommand}
        isSelected={false}
        onClick={onClick}
      />
    );

    const button = container.querySelector('button');
    expect(button).toHaveAttribute('type', 'button');
  });

  it('handles command with icon and no shortcut', () => {
    const onClick = vi.fn();
    const command: CommandQueryResult = {
      id: 'cmd.popOut',
      order: 0,
      title: 'Pop Out Pane',
      category: 'Window',
      icon: '📤',
    };

    render(
      <TopSearchBarCommandResult
        command={command}
        isSelected={false}
        onClick={onClick}
      />
    );

    expect(screen.getByText('📤')).toBeInTheDocument();
    expect(screen.getByText('Window: Pop Out Pane')).toBeInTheDocument();
  });

  it('renders title as text element', () => {
    const onClick = vi.fn();
    const { container } = render(
      <TopSearchBarCommandResult
        command={mockCommand}
        isSelected={false}
        onClick={onClick}
      />
    );

    const titleElement = container.querySelector('button span:nth-child(2)');
    expect(titleElement).toBeInTheDocument();
  });
});
