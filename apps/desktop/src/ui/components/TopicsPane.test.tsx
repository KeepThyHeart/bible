import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TopicsPane from './TopicsPane';
import { useTopicsStore } from '../stores/useTopicsStore';

// Mock useTopicsPanel
const mockUseTopicsPanel = vi.fn();
vi.mock('../stores/hooks/useTopicsPanel', () => ({
  useTopicsPanel: (...args: unknown[]) => mockUseTopicsPanel(...args),
}));

// Mock stores
vi.mock('../stores/useTopicsStore', () => ({
  useTopicsStore: Object.assign(
    vi.fn().mockReturnValue(undefined),
    {
      getState: vi.fn().mockReturnValue({
        initPanel: vi.fn(),
        destroyPanel: vi.fn(),
      }),
    },
  ),
}));

vi.mock('../stores/useTopicalIndexStore', () => ({
  useTopicalIndexStore: () => ({
    availableModules: [],
    loadAvailableModules: vi.fn(),
  }),
}));

vi.mock('../stores/useBibleStore', () => ({
  useBibleStore: Object.assign(
    vi.fn().mockReturnValue(undefined),
    {
      getState: vi.fn().mockReturnValue({
        navigateToVerseInPrimary: vi.fn(),
      }),
    },
  ),
}));

// Mock data hook
const mockUseTopicsPaneData = vi.fn();
vi.mock('./TopicsPane/hooks/useTopicsPaneData', () => ({
  useTopicsPaneData: (...args: unknown[]) => mockUseTopicsPaneData(...args),
}));

vi.mock('./TopicsPane/types', () => ({
  PAGE_SIZE: 50,
}));

// Mock sub-components
vi.mock('./shared/PaneNavHeader', () => ({ default: (props: any) => (
  <div data-testid="pane-nav-header">
    <button data-testid="back-btn" onClick={props.onBack} disabled={!props.canGoBack}>Back</button>
    <button data-testid="forward-btn" onClick={props.onForward} disabled={!props.canGoForward}>Forward</button>
  </div>
) }));
vi.mock('./shared/SuggestionBanner', () => ({ default: (props: any) => (
  <div data-testid="suggestion-banner">
    <button onClick={props.onGo}>Go</button>
    <button onClick={props.onDismiss}>Dismiss</button>
  </div>
) }));
vi.mock('./TopicsPane/BrowseView', () => ({ default: () => <div data-testid="browse-view">Browse</div> }));
vi.mock('./TopicsPane/TopicView', () => ({ default: () => <div data-testid="topic-view">Topic</div> }));
vi.mock('./TopicsPane/VerseTopicsView', () => ({ default: () => <div data-testid="verse-topics-view">VerseTopics</div> }));
vi.mock('./TopicsPane/EntityDetailView', () => ({ default: () => <div data-testid="entity-detail-view">Entity</div> }));

const defaultData = {
  browseTopics: [],
  topicDetail: null,
  topicVerses: [],
  alsoIn: [],
  verseTopics: [],
  tagGraphAssociations: [],
  tagGraphMapping: new Map(),
  entityDetail: null,
  entityAssociations: [],
  entityRelationships: [],
  entityAliases: [],
  entityFacets: [],
  entityTopicLinks: [],
  loading: false,
  hasMore: false,
};

const defaultPanelState = {
  currentView: 'browse' as const,
  currentTopicId: null,
  currentTopicAbbreviation: null,
  currentVerseId: null,
  currentEntityId: null,
  currentEntityCategory: null,
  pinned: false,
  suggestionVerseId: null,
  canGoBack: false,
  canGoForward: false,
  sourceFilters: [],
  browseOffset: 0,
  browseFilter: '',
  navigateToTopic: vi.fn(),
  navigateToEntity: vi.fn(),
  navigateToBrowse: vi.fn(),
  setSourceFilter: vi.fn(),
  setBrowseFilter: vi.fn(),
  setBrowseOffset: vi.fn(),
  goBack: vi.fn(),
  goForward: vi.fn(),
  togglePin: vi.fn(),
  dismissSuggestion: vi.fn(),
  acceptSuggestion: vi.fn(),
};

describe('TopicsPane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseTopicsPanel.mockReturnValue(defaultPanelState);
    mockUseTopicsPaneData.mockReturnValue(defaultData);
  });

  it('renders the topics pane container', () => {
    const { container } = render(<TopicsPane panelId="topics_default" />);
    expect(container.querySelector('.h-full')).toBeInTheDocument();
  });

  it('renders nav header', () => {
    render(<TopicsPane panelId="topics_default" />);
    expect(screen.getByTestId('pane-nav-header')).toBeInTheDocument();
  });

  it('shows browse view when currentView is browse', () => {
    render(<TopicsPane panelId="topics_default" />);
    expect(screen.getByTestId('browse-view')).toBeInTheDocument();
  });

  it('shows topic view when currentView is topic', () => {
    mockUseTopicsPanel.mockReturnValue({
      ...defaultPanelState,
      currentView: 'topic',
      currentTopicId: 42,
      currentTopicAbbreviation: 'TSK',
    });
    render(<TopicsPane panelId="topics_default" />);
    expect(screen.getByTestId('topic-view')).toBeInTheDocument();
  });

  it('shows entity view when currentView is entity', () => {
    mockUseTopicsPanel.mockReturnValue({
      ...defaultPanelState,
      currentView: 'entity',
      currentEntityId: 'ent-1',
      currentEntityCategory: 'person',
    });
    render(<TopicsPane panelId="topics_default" />);
    expect(screen.getByTestId('entity-detail-view')).toBeInTheDocument();
  });

  it('shows verse topics view when currentView is verse-topics', () => {
    mockUseTopicsPanel.mockReturnValue({
      ...defaultPanelState,
      currentView: 'verse-topics',
      currentVerseId: 43003016,
    });
    render(<TopicsPane panelId="topics_default" />);
    expect(screen.getByTestId('verse-topics-view')).toBeInTheDocument();
  });

  it('shows suggestion banner when suggestion verse is set', () => {
    mockUseTopicsPanel.mockReturnValue({
      ...defaultPanelState,
      suggestionVerseId: 43003017,
    });
    render(<TopicsPane panelId="topics_default" />);
    expect(screen.getByTestId('suggestion-banner')).toBeInTheDocument();
  });

  it('does not show suggestion banner when no suggestion', () => {
    render(<TopicsPane panelId="topics_default" />);
    expect(screen.queryByTestId('suggestion-banner')).not.toBeInTheDocument();
  });

  it('calls dismissSuggestion when dismiss is clicked', async () => {
    const user = userEvent.setup();
    const mockDismiss = vi.fn();
    mockUseTopicsPanel.mockReturnValue({
      ...defaultPanelState,
      suggestionVerseId: 43003017,
      dismissSuggestion: mockDismiss,
    });
    render(<TopicsPane panelId="topics_default" />);
    await user.click(screen.getByText('Dismiss'));
    expect(mockDismiss).toHaveBeenCalled();
  });

  it('passes panelId to useTopicsPanel', () => {
    render(<TopicsPane panelId="custom-topics" />);
    expect(mockUseTopicsPanel).toHaveBeenCalledWith('custom-topics');
  });

  it('does not show other views when browse is active', () => {
    render(<TopicsPane panelId="topics_default" />);
    expect(screen.queryByTestId('topic-view')).not.toBeInTheDocument();
    expect(screen.queryByTestId('entity-detail-view')).not.toBeInTheDocument();
    expect(screen.queryByTestId('verse-topics-view')).not.toBeInTheDocument();
  });

  // A detached window shares no store with the main one, so a popped-out
  // Topics pane came up on the bare browse list with a Home button that had
  // nowhere to go. The verse travels in the pop-out payload instead.
  describe('popped out', () => {
    function stubStore(getPanelState: () => unknown) {
      const syncAllPanelsWithVerse = vi.fn();
      vi.mocked(useTopicsStore.getState).mockReturnValue({
        initPanel: vi.fn(),
        destroyPanel: vi.fn(),
        getPanelState,
        syncAllPanelsWithVerse,
      } as never);
      return syncAllPanelsWithVerse;
    }

    it('opens on the verse handed over by the pop-out', () => {
      const sync = stubStore(() => ({ currentVerseId: null, currentView: 'browse' }));

      render(<TopicsPane panelId="_default" initialVerseId={43003016} />);

      expect(sync).toHaveBeenCalledWith(43003016);
    });

    it('leaves the pane where the reader has since navigated', () => {
      const sync = stubStore(() => ({ currentVerseId: 43003001, currentView: 'topic' }));

      render(<TopicsPane panelId="_default" initialVerseId={43003016} />);

      expect(sync).not.toHaveBeenCalled();
    });
  });
});
