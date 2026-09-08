import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TopicSearchBar from './TopicSearchBar';
import { ContextProvider, type AppServices } from '../../contexts/ContextProvider';

// Mock window.electron.topical
const mockTopical = {
  searchTopics: vi.fn(),
};

Object.defineProperty(window, 'electron', {
  value: {
    ...window.electron,
    topical: mockTopical,
  },
  writable: true,
});

function createMockI18n() {
  return {
    t: (key: string) => {
      const map: Record<string, string> = {
        'topicSearchBar.placeholder': 'Search topics...',
      };
      return map[key] || key;
    },
    currentLocale: 'en' as const,
    onDidChangeLocale: () => ({ dispose: vi.fn() }),
    resolve: (v: unknown) => String(v),
    loadCatalog: vi.fn(),
    setLocale: vi.fn(),
  };
}

function createMockServices(): AppServices {
  return {
    registry: {} as AppServices['registry'],
    whenContext: {} as AppServices['whenContext'],
    keybindings: {} as AppServices['keybindings'],
    i18n: createMockI18n() as unknown as AppServices['i18n'],
  };
}

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ContextProvider services={createMockServices()}>{ui}</ContextProvider>
  );
}

describe('TopicSearchBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTopical.searchTopics.mockResolvedValue({
      ok: true,
      value: [],
    });
  });

  it('renders search input with placeholder', () => {
    const onSelectTopic = vi.fn();
    renderWithProviders(
      <TopicSearchBar
        onSelectTopic={onSelectTopic}
        placeholder="Find a topic..."
      />
    );

    const input = screen.getByPlaceholderText('Find a topic...');
    expect(input).toBeInTheDocument();
  });

  it('uses default placeholder when not provided', () => {
    const onSelectTopic = vi.fn();
    mockTopical.searchTopics.mockResolvedValue({
      ok: true,
      value: [],
    });

    renderWithProviders(<TopicSearchBar onSelectTopic={onSelectTopic} />);

    const input = screen.getByPlaceholderText(/Search topics/i);
    expect(input).toBeInTheDocument();
  });

  it('shows results dropdown when search query has matches', async () => {
    const user = userEvent.setup();
    const onSelectTopic = vi.fn();
    mockTopical.searchTopics.mockResolvedValue({
      ok: true,
      value: [
        {
          topic_id: 1,
          name: 'Jesus',
          source_abbreviation: 'TSK',
          source_name: 'The Sermon Keyed',
          verse_count: 50,
        },
      ],
    });

    renderWithProviders(<TopicSearchBar onSelectTopic={onSelectTopic} />);

    const input = screen.getByRole('textbox');
    await user.type(input, 'Jesus');

    await waitFor(() => {
      expect(screen.getByText('Jesus')).toBeInTheDocument();
    });
  });

  it('does not search with less than 2 characters', async () => {
    const user = userEvent.setup();
    const onSelectTopic = vi.fn();

    renderWithProviders(<TopicSearchBar onSelectTopic={onSelectTopic} />);

    const input = screen.getByRole('textbox');
    await user.type(input, 'J');

    await waitFor(() => {
      expect(mockTopical.searchTopics).not.toHaveBeenCalled();
    });
  });

  it('debounces search with 200ms delay', async () => {
    const user = userEvent.setup();
    const onSelectTopic = vi.fn();
    mockTopical.searchTopics.mockResolvedValue({
      ok: true,
      value: [],
    });

    renderWithProviders(<TopicSearchBar onSelectTopic={onSelectTopic} />);

    const input = screen.getByRole('textbox');
    await user.type(input, 'test');

    // Shouldn't be called yet due to debounce
    expect(mockTopical.searchTopics).not.toHaveBeenCalled();
  });

  it('calls onSelectTopic when result is clicked', async () => {
    const user = userEvent.setup();
    const onSelectTopic = vi.fn();
    mockTopical.searchTopics.mockResolvedValue({
      ok: true,
      value: [
        {
          topic_id: 1,
          name: 'Faith',
          source_abbreviation: 'TSK',
          source_name: 'The Sermon Keyed',
          verse_count: 100,
        },
      ],
    });

    renderWithProviders(<TopicSearchBar onSelectTopic={onSelectTopic} />);

    const input = screen.getByRole('textbox');
    await user.type(input, 'Faith');

    await waitFor(() => {
      expect(screen.getByText('Faith')).toBeInTheDocument();
    });

    const result = screen.getByText('Faith');
    await user.click(result);

    expect(onSelectTopic).toHaveBeenCalledWith('TSK', 1);
  });

  it('closes dropdown after selecting result', async () => {
    const user = userEvent.setup();
    const onSelectTopic = vi.fn();
    mockTopical.searchTopics.mockResolvedValue({
      ok: true,
      value: [
        {
          topic_id: 1,
          name: 'Hope',
          source_abbreviation: 'TSK',
          source_name: 'The Sermon Keyed',
          verse_count: 75,
        },
      ],
    });

    renderWithProviders(<TopicSearchBar onSelectTopic={onSelectTopic} />);

    const input = screen.getByRole('textbox');
    await user.type(input, 'Hope');

    await waitFor(() => {
      expect(screen.getByText('Hope')).toBeInTheDocument();
    });

    const result = screen.getByText('Hope');
    await user.click(result);

    await waitFor(() => {
      expect(screen.queryByText('Hope')).not.toBeInTheDocument();
    });
  });

  it('closes dropdown on Escape key', async () => {
    const user = userEvent.setup();
    const onSelectTopic = vi.fn();
    mockTopical.searchTopics.mockResolvedValue({
      ok: true,
      value: [
        {
          topic_id: 1,
          name: 'Test',
          source_abbreviation: 'TSK',
          source_name: 'The Sermon Keyed',
          verse_count: 10,
        },
      ],
    });

    renderWithProviders(<TopicSearchBar onSelectTopic={onSelectTopic} />);

    const input = screen.getByRole('textbox');
    await user.type(input, 'Test');

    await waitFor(() => {
      expect(screen.getByText('Test')).toBeInTheDocument();
    });

    await user.keyboard('{Escape}');

    expect(screen.queryByText('Test')).not.toBeInTheDocument();
  });

  it('handles arrow navigation', async () => {
    const user = userEvent.setup();
    const onSelectTopic = vi.fn();
    mockTopical.searchTopics.mockResolvedValue({
      ok: true,
      value: [
        {
          topic_id: 1,
          name: 'First',
          source_abbreviation: 'TSK',
          source_name: 'The Sermon Keyed',
          verse_count: 10,
        },
        {
          topic_id: 2,
          name: 'Second',
          source_abbreviation: 'TSK',
          source_name: 'The Sermon Keyed',
          verse_count: 20,
        },
      ],
    });

    renderWithProviders(<TopicSearchBar onSelectTopic={onSelectTopic} />);

    const input = screen.getByRole('textbox');
    await user.type(input, 'Test');

    await waitFor(() => {
      expect(screen.getByText('First')).toBeInTheDocument();
    });

    await user.keyboard('{ArrowDown}');
    expect(screen.getByText('First')).toBeInTheDocument();
  });

  it('selects result with Enter key', async () => {
    const user = userEvent.setup();
    const onSelectTopic = vi.fn();
    mockTopical.searchTopics.mockResolvedValue({
      ok: true,
      value: [
        {
          topic_id: 1,
          name: 'Topic',
          source_abbreviation: 'TSK',
          source_name: 'The Sermon Keyed',
          verse_count: 30,
        },
      ],
    });

    renderWithProviders(<TopicSearchBar onSelectTopic={onSelectTopic} />);

    const input = screen.getByRole('textbox');
    await user.type(input, 'Topic');

    await waitFor(() => {
      expect(screen.getByText('Topic')).toBeInTheDocument();
    });

    await user.keyboard('{Enter}');

    expect(onSelectTopic).toHaveBeenCalledWith('TSK', 1);
  });

  it('displays verse count for results', async () => {
    const user = userEvent.setup();
    const onSelectTopic = vi.fn();
    mockTopical.searchTopics.mockResolvedValue({
      ok: true,
      value: [
        {
          topic_id: 1,
          name: 'Grace',
          source_abbreviation: 'TSK',
          source_name: 'The Sermon Keyed',
          verse_count: 120,
        },
      ],
    });

    renderWithProviders(<TopicSearchBar onSelectTopic={onSelectTopic} />);

    const input = screen.getByRole('textbox');
    await user.type(input, 'Grace');

    await waitFor(() => {
      expect(screen.getByText('120')).toBeInTheDocument();
    });
  });

  it('displays source name for results', async () => {
    const user = userEvent.setup();
    const onSelectTopic = vi.fn();
    mockTopical.searchTopics.mockResolvedValue({
      ok: true,
      value: [
        {
          topic_id: 1,
          name: 'Love',
          source_abbreviation: 'TSK',
          source_name: 'The Sermon Keyed Bible',
          verse_count: 200,
        },
      ],
    });

    renderWithProviders(<TopicSearchBar onSelectTopic={onSelectTopic} />);

    const input = screen.getByRole('textbox');
    await user.type(input, 'Love');

    await waitFor(() => {
      expect(screen.getByText(/The Sermon Keyed Bible/)).toBeInTheDocument();
    });
  });

  it('filters by source when provided', async () => {
    const user = userEvent.setup();
    const onSelectTopic = vi.fn();
    mockTopical.searchTopics.mockResolvedValue({
      ok: true,
      value: [],
    });

    renderWithProviders(
      <TopicSearchBar
        onSelectTopic={onSelectTopic}
        sources={['TSK', 'NAVE']}
      />
    );

    const input = screen.getByRole('textbox');
    await user.type(input, 'Search');

    await waitFor(() => {
      expect(mockTopical.searchTopics).toHaveBeenCalledWith(
        'Search',
        ['TSK', 'NAVE']
      );
    });
  });

  it('clears search after selection', async () => {
    const user = userEvent.setup();
    const onSelectTopic = vi.fn();
    mockTopical.searchTopics.mockResolvedValue({
      ok: true,
      value: [
        {
          topic_id: 1,
          name: 'Clear',
          source_abbreviation: 'TSK',
          source_name: 'The Sermon Keyed',
          verse_count: 50,
        },
      ],
    });

    renderWithProviders(<TopicSearchBar onSelectTopic={onSelectTopic} />);

    const input = screen.getByRole('textbox') as HTMLInputElement;
    await user.type(input, 'Clear');

    await waitFor(() => {
      expect(screen.getByText('Clear')).toBeInTheDocument();
    });

    const result = screen.getByText('Clear');
    await user.click(result);

    await waitFor(() => {
      expect(input.value).toBe('');
    });
  });
});
