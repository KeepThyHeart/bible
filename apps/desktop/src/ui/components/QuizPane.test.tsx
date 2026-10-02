import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuizPane from './QuizPane';
import { useQuizLaunchStore } from '../stores/useQuizLaunchStore';

const mockOpenModuleManager = vi.fn();
vi.mock('../utils/openModuleManager', () => ({ openModuleManager: (...a: unknown[]) => mockOpenModuleManager(...a) }));

vi.mock('../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => `<${key}>` }),
}));

vi.mock('../stores/useBibleStore', () => ({
  DEFAULT_PANEL_ID: 'default',
  useBibleStore: (selector: (s: unknown) => unknown) =>
    selector({ panels: new Map([['default', { currentBook: 41, currentChapter: 4 }]]) }),
}));

vi.mock('../stores/crossStoreBridge', () => ({ navigateToVerseInPrimary: vi.fn() }));
vi.mock('../services/electronAPI', () => ({ bibleAPI: { getAllBooks: vi.fn().mockResolvedValue([]) } }));

type PanelProps = Record<string, any>;
const panelProps: { current: PanelProps } = { current: {} };
vi.mock('@bible/ui', () => ({
  QuizPanel: (props: PanelProps) => {
    panelProps.current = props;
    return <div data-testid="quiz-panel" />;
  },
}));

const ok = (value: unknown) => Promise.resolve({ ok: true, value });
const catalog = { modules: [], coverage: [{ book: 41, chapter: 4, count: 3 }] };

function stubElectron(getCatalog: () => Promise<unknown>) {
  (window as any).electron = {
    quiz: {
      getCatalog: vi.fn(getCatalog),
      getQuestions: vi.fn(() => ok([])),
      getStats: vi.fn(() => ok({})),
      recordAttempt: vi.fn(() => ok(undefined)),
      recordSession: vi.fn(() => ok(undefined)),
      listSessions: vi.fn(() => ok([])),
    },
  };
}

describe('QuizPane', () => {
  beforeEach(() => {
    mockOpenModuleManager.mockClear();
    useQuizLaunchStore.setState({ pending: null });
  });

  it('hands the catalog, the reading chapter and the labels to the quiz panel', async () => {
    stubElectron(() => ok(catalog));
    render(<QuizPane />);
    await waitFor(() => expect(panelProps.current.catalog).toEqual(catalog));
    expect(panelProps.current.currentChapter).toEqual({ book: 41, chapter: 4 });
    expect(panelProps.current.todaysReading).toBeNull();
    expect(panelProps.current.labels.title).toBe('<quizPane.title>');
    expect(panelProps.current.labels.kinds.recall).toBe('<quizPane.kind.recall>');
    expect(panelProps.current.labels.difficultyBadge['3']).toBe('<quizPane.difficultyBadge.3>');
    expect(panelProps.current.formatReference(41004005, 41004006)).toBe('Mark 4:5-6');
    expect(panelProps.current.emptyAction.label).toBe('<quizPane.openModuleManager>');
    panelProps.current.emptyAction.onClick();
    expect(mockOpenModuleManager).toHaveBeenCalled();
  });

  it('takes a pending launch request once and starts it', async () => {
    stubElectron(() => ok(catalog));
    const request = { passages: [{ start: 41004001, end: 41004999 }], label: 'Mark 4' };
    act(() => { useQuizLaunchStore.getState().request(request); });
    render(<QuizPane />);
    await waitFor(() => expect(panelProps.current.startRequest).toEqual(request));
    expect(useQuizLaunchStore.getState().pending).toBeNull();
  });

  it('shows an error with a retry button when the catalog cannot be loaded', async () => {
    const getCatalog = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'internal', message: 'boom' } })
      .mockResolvedValue({ ok: true, value: catalog });
    stubElectron(getCatalog);
    render(<QuizPane />);
    expect(await screen.findByTestId('quiz-pane-error')).toBeInTheDocument();
    await userEvent.click(screen.getByText('<quizPane.retry>'));
    await waitFor(() => expect(screen.getByTestId('quiz-pane')).toBeInTheDocument());
    expect(getCatalog).toHaveBeenCalledTimes(2);
  });
});
