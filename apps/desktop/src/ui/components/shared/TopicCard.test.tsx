import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TopicCard from './TopicCard';
import { enT } from '../../testing/enCatalog';

// The card localizes its count badges now, which pulls `useI18n` in.
vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => enT(key, params), locale: 'en', i18n: {} }),
}));

describe('TopicCard', () => {
  it('renders topic name', () => {
    const onClick = vi.fn();
    render(
      <TopicCard
        name="Jesus Christ"
        onClick={onClick}
      />
    );

    expect(screen.getByText('Jesus Christ')).toBeInTheDocument();
  });

  it('renders description', () => {
    const onClick = vi.fn();
    render(
      <TopicCard
        name="Jesus Christ"
        description="Son of God, Savior of mankind"
        onClick={onClick}
      />
    );

    expect(
      screen.getByText('Son of God, Savior of mankind')
    ).toBeInTheDocument();
  });

  it('renders relationship label', () => {
    const onClick = vi.fn();
    render(
      <TopicCard
        name="John"
        relationship="Brother of"
        onClick={onClick}
      />
    );

    expect(screen.getByText('Brother of')).toBeInTheDocument();
  });

  it('renders category badge', () => {
    const onClick = vi.fn();
    render(
      <TopicCard
        name="David"
        categoryLabel="People"
        categoryColor="#3b82f6"
        onClick={onClick}
      />
    );

    expect(screen.getByText('People')).toBeInTheDocument();
  });

  it('displays verse count badge', () => {
    const onClick = vi.fn();
    render(
      <TopicCard
        name="Love"
        verseCount={42}
        onClick={onClick}
      />
    );

    // `verseCount` is `verse_count`, which expands ranges - it counts verses.
    // Saying "passages" would disagree with the list it is summarising.
    expect(screen.getByText('42 verses')).toBeInTheDocument();
  });

  it('displays single verse correctly', () => {
    const onClick = vi.fn();
    render(
      <TopicCard
        name="Grace"
        verseCount={1}
        onClick={onClick}
      />
    );

    expect(screen.getByText('1 verse')).toBeInTheDocument();
  });

  it('displays child count badge', () => {
    const onClick = vi.fn();
    render(
      <TopicCard
        name="Fruit of the Spirit"
        childCount={9}
        onClick={onClick}
      />
    );

    expect(screen.getByText('9 subtopics')).toBeInTheDocument();
  });

  it('displays single child correctly', () => {
    const onClick = vi.fn();
    render(
      <TopicCard
        name="Beatitudes"
        childCount={1}
        onClick={onClick}
      />
    );

    expect(screen.getByText('1 subtopic')).toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <TopicCard
        name="Prayer"
        onClick={onClick}
      />
    );

    const button = screen.getByRole('button');
    await user.click(button);

    expect(onClick).toHaveBeenCalled();
  });

  it('renders with child variant', () => {
    const onClick = vi.fn();
    const { container } = render(
      <TopicCard
        name="Gospel"
        variant="child"
        onClick={onClick}
      />
    );

    const button = container.querySelector('button');
    expect(button?.style.border).toContain('solid');
  });

  it('renders with related variant', () => {
    const onClick = vi.fn();
    const { container } = render(
      <TopicCard
        name="Parables"
        variant="related"
        onClick={onClick}
      />
    );

    const button = container.querySelector('button');
    expect(button?.style.border).toContain('dashed');
  });

  it('displays strength indicator', () => {
    const onClick = vi.fn();
    const { container } = render(
      <TopicCard
        name="Redemption"
        strength={0.8}
        onClick={onClick}
      />
    );

    const strengthDot = container.querySelector('span[title*="Strength"]');
    expect(strengthDot).toBeInTheDocument();
  });

  it('renders all information together', () => {
    const onClick = vi.fn();
    render(
      <TopicCard
        name="The Last Supper"
        relationship="Event in"
        description="Final meal Jesus shared with disciples"
        categoryLabel="Events"
        categoryColor="#8b5cf6"
        verseCount={15}
        childCount={3}
        strength={0.9}
        onClick={onClick}
      />
    );

    expect(screen.getByText('The Last Supper')).toBeInTheDocument();
    expect(screen.getByText('Event in')).toBeInTheDocument();
    expect(
      screen.getByText('Final meal Jesus shared with disciples')
    ).toBeInTheDocument();
    expect(screen.getByText('Events')).toBeInTheDocument();
    expect(screen.getByText('15 verses')).toBeInTheDocument();
    expect(screen.getByText('3 subtopics')).toBeInTheDocument();
  });

  it('handles undefined optional properties', () => {
    const onClick = vi.fn();
    render(
      <TopicCard
        name="Topic"
        onClick={onClick}
      />
    );

    expect(screen.getByText('Topic')).toBeInTheDocument();
  });

  it('is a button element', () => {
    const onClick = vi.fn();
    const { container } = render(
      <TopicCard
        name="Button Topic"
        onClick={onClick}
      />
    );

    const button = container.querySelector('button');
    expect(button).toBeInTheDocument();
  });

  it('does not render verse count badge when count is zero', () => {
    const onClick = vi.fn();
    render(
      <TopicCard
        name="Empty Topic"
        verseCount={0}
        onClick={onClick}
      />
    );

    expect(screen.queryByText(/verses/i)).not.toBeInTheDocument();
  });

  it('does not render child count badge when count is zero', () => {
    const onClick = vi.fn();
    render(
      <TopicCard
        name="Leaf Topic"
        childCount={0}
        onClick={onClick}
      />
    );

    expect(screen.queryByText(/subtopic/i)).not.toBeInTheDocument();
  });
});
