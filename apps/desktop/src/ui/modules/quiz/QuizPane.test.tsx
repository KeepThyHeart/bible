import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuizPane from './QuizPane';
import { useQuizLaunchStore } from './useQuizLaunchStore';

const mockOpenModuleManager = vi.fn();
vi.mock('../../utils/openModuleManager', () => ({ openModuleManager: (...a: unknown[]) => mockOpenModuleManager(...a) }));

vi.mock('../../contexts/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => `<${key}>` }),
}));

vi.mock('../../stores/useBibleStore', () => ({
  DEFAULT_PANEL_ID: 'default',
  useBibleStore: (selector: (s: unknown) => unknown) =>
    selector({ panels: new Map([['default', { currentBook: 41, currentChapter: 4 }]]) }),
}));

vi.mock('../../stores/crossStoreBridge', () => ({ navigateToVerseInPrimary: vi.fn() }));
vi.mock('../../services/electronAPI', () => ({ bibleAPI: { getAllBooks: vi.fn().mockResolvedValue([]) } }));

const mockScope = { getTodayScope: vi.fn(), subscribe: vi.fn() };
vi.mock('../reading-plans/readingPlansAPI', () => ({ getReadingPlanService: () => mockScope }));

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
  const methods: Record<string, (...args: unknown[]) => Promise<unknown>> = {
    getCatalog: vi.fn(getCatalog),
    getQuestions: vi.fn(() => ok([])),
    getStats: vi.fn(() => ok({})),
    recordAttempt: vi.fn(() => ok(undefined)),
    recordSession: vi.fn(() => ok(undefined)),
    listSessions: vi.fn(() => ok([])),
  };
  // The renderer reaches the Quiz module's main half through the generic module bridge.
  (window as any).electron = {
    modules: { invoke: vi.fn((_ns: string, method: string, ...args: unknown[]) => methods[method](...args)), on: vi.fn() },
  };
}

describe('QuizPane', () => {
  beforeEach(() => {
    mockOpenModuleManager.mockClear();
    useQuizLaunchStore.setState({ pending: null });
    mockScope.getTodayScope.mockReset().mockResolvedValue([]);
    mockScope.subscribe.mockReset().mockReturnValue(() => {});
  });

  it("passes today's reading from the reading plans as a labelled scope, and null when nothing is due", async () => {
    stubElectron(() => ok(catalog));
    mockScope.getTodayScope.mockResolvedValue([
      { enrollmentId: 'a', planName: 'P', day: 3, done: false, readings: [{ start: 41001001, end: 41001045 }] },
      { enrollmentId: 'b', planName: 'Q', day: 1, done: false, readings: [{ start: 41004001, end: 41004041 }] },
    ]);
    render(<QuizPane />);
    await waitFor(() => expect(panelProps.current.todaysReading).not.toBeNull());
    expect(panelProps.current.todaysReading).toEqual({
      label: 'Mark 1; Mark 4',
      passages: [{ start: 41001001, end: 41001045 }, { start: 41004001, end: 41004041 }],
    });
  });

  it("keeps today's reading null with no active plan or when the service fails", async () => {
    stubElectron(() => ok(catalog));
    mockScope.getTodayScope.mockRejectedValue(new Error('ipc'));
    render(<QuizPane />);
    await waitFor(() => expect(mockScope.getTodayScope).toHaveBeenCalled());
    await waitFor(() => expect(panelProps.current.catalog).toEqual(catalog));
    expect(panelProps.current.todaysReading).toBeNull();
  });

  it("refreshes today's reading when the plan service reports a change", async () => {
    stubElectron(() => ok(catalog));
    let listener: (() => void) | undefined;
    mockScope.subscribe.mockImplementation((l: () => void) => { listener = l; return () => {}; });
    render(<QuizPane />);
    await waitFor(() => expect(listener).toBeDefined());
    expect(panelProps.current.todaysReading).toBeNull();
    mockScope.getTodayScope.mockResolvedValue([
      { enrollmentId: 'a', planName: 'P', day: 1, done: false, readings: [{ start: 41001001, end: 41001045 }] },
    ]);
    act(() => { listener!(); });
    await waitFor(() => expect(panelProps.current.todaysReading?.label).toBe('Mark 1'));
  });

  it('hands the catalog, the reading chapter and the labels to the quiz panel', async () => {
    stubElectron(() => ok(catalog));
    render(<QuizPane />);
    await waitFor(() => expect(panelProps.current.catalog).toEqual(catalog));
    expect(panelProps.current.currentChapter).toEqual({ book: 41, chapter: 4 });
    expect(panelProps.current.todaysReading).toBeNull(); // no active plan
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
