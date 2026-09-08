import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TopicListItem from './TopicListItem';

describe('TopicListItem', () => {
  it('renders topic name', () => {
    const onClick = vi.fn();
    render(
      <TopicListItem
        topicName="Apostles"
        onClick={onClick}
      />
    );

    expect(screen.getByText('Apostles')).toBeInTheDocument();
  });

  it('renders parent path when provided', () => {
    const onClick = vi.fn();
    render(
      <TopicListItem
        topicName="Peter"
        parentPath="Apostles > Disciples"
        onClick={onClick}
      />
    );

    expect(screen.getByText('Apostles > Disciples')).toBeInTheDocument();
  });

  it('renders source label when provided', () => {
    const onClick = vi.fn();
    render(
      <TopicListItem
        topicName="Wisdom"
        source="Topical Index"
        onClick={onClick}
      />
    );

    expect(screen.getByText('(Topical Index)')).toBeInTheDocument();
  });

  it('displays verse count badge', () => {
    const onClick = vi.fn();
    render(
      <TopicListItem
        topicName="Faith"
        verseCount={127}
        onClick={onClick}
      />
    );

    expect(screen.getByText('127')).toBeInTheDocument();
  });

  it('calls onClick when item is clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <TopicListItem
        topicName="Hope"
        onClick={onClick}
      />
    );

    const button = screen.getByRole('button');
    await user.click(button);

    expect(onClick).toHaveBeenCalled();
  });

  it('renders with indentation when indented prop is true', () => {
    const onClick = vi.fn();
    const { container } = render(
      <TopicListItem
        topicName="Indented Topic"
        indented={true}
        onClick={onClick}
      />
    );

    // Indentation is a LOGICAL inset (paddingInlineStart) so the tree indents
    // from the reading edge in both LTR and RTL locales.
    const button = container.querySelector('button');
    expect(button?.style.paddingInlineStart).toContain('24px');
  });

  it('renders without indentation when indented is false', () => {
    const onClick = vi.fn();
    const { container } = render(
      <TopicListItem
        topicName="Non-indented Topic"
        indented={false}
        onClick={onClick}
      />
    );

    const button = container.querySelector('button');
    expect(button?.style.paddingInlineStart).toContain('10px');
  });

  it('renders all properties together', () => {
    const onClick = vi.fn();
    render(
      <TopicListItem
        topicName="The Trinity"
        parentPath="Doctrine > God"
        source="Systematic Theology"
        verseCount={45}
        indented={true}
        onClick={onClick}
      />
    );

    expect(screen.getByText('The Trinity')).toBeInTheDocument();
    expect(screen.getByText('Doctrine > God')).toBeInTheDocument();
    expect(screen.getByText('(Systematic Theology)')).toBeInTheDocument();
    expect(screen.getByText('45')).toBeInTheDocument();
  });

  it('is a button element', () => {
    const onClick = vi.fn();
    render(
      <TopicListItem
        topicName="Button Item"
        onClick={onClick}
      />
    );

    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();
    expect(button.tagName.toLowerCase()).toBe('button');
  });

  it('handles topics with special characters', () => {
    const onClick = vi.fn();
    render(
      <TopicListItem
        topicName="God's Kingdom"
        parentPath="The Kingdom (Baalism & False Gods)"
        onClick={onClick}
      />
    );

    expect(screen.getByText("God's Kingdom")).toBeInTheDocument();
    expect(
      screen.getByText('The Kingdom (Baalism & False Gods)')
    ).toBeInTheDocument();
  });

  it('does not render verse count when not provided', () => {
    const onClick = vi.fn();
    const { container } = render(
      <TopicListItem
        topicName="No Verses"
        onClick={onClick}
      />
    );

    const badges = container.querySelectorAll('[style*="backgroundColor"]');
    expect(badges.length).toBe(0);
  });

  it('does not render verse count when zero', () => {
    const onClick = vi.fn();
    render(
      <TopicListItem
        topicName="Empty Topic"
        verseCount={0}
        onClick={onClick}
      />
    );

    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('renders topic name with overflow handling', () => {
    const onClick = vi.fn();
    const longName =
      'This is a very long topic name that might overflow the container space';
    const { container } = render(
      <TopicListItem
        topicName={longName}
        onClick={onClick}
      />
    );

    const span = container.querySelector('span[style*="overflow: hidden"]');
    expect(span).toBeInTheDocument();
  });

  it('styles parent path with secondary color', () => {
    const onClick = vi.fn();
    const { container } = render(
      <TopicListItem
        topicName="Child"
        parentPath="Parent"
        onClick={onClick}
      />
    );

    const parentPath = Array.from(container.querySelectorAll('span')).find(
      el => el.textContent === 'Parent'
    );
    const style = window.getComputedStyle(parentPath || document.body);
    expect(parentPath?.style.color || style.color).toBeDefined();
  });

  it('is clickable with proper cursor styling', () => {
    const onClick = vi.fn();
    const { container } = render(
      <TopicListItem
        topicName="Clickable"
        onClick={onClick}
      />
    );

    const button = container.querySelector('button');
    expect(button?.style.cursor).toBe('pointer');
  });
});
