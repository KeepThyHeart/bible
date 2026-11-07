/**
 * Item 21: a commentary whose module file is missing must produce exactly one
 * log line and a bounded number of IPC calls, however many verses/chapters the
 * reader moves through, and must not re-fetch in a loop.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useCommentaryStore } from '../useCommentaryStore';
import { IpcResultError } from '../../../services/ipcResult';
import { resetModuleErrorLog } from '../../../services/moduleErrorLog';

const api = vi.hoisted(() => ({
  getAvailableCommentaries: vi.fn(),
  getEntriesForVerse: vi.fn(),
  getNextVerseWithContent: vi.fn(),
  getPreviousVerseWithContent: vi.fn(),
  getAllEntrySummaries: vi.fn(),
  batchRestoreSession: vi.fn(),
}));
vi.mock('../../../services/electronAPI', () => ({ commentaryAPI: api }));
vi.mock('../../helpers/sessionNotifier', () => ({ markSessionDirty: vi.fn() }));

const missing = () => new IpcResultError('module_missing', 'Module file missing: WES (/x/wes.db)');
const PANEL = 'p1';

describe('commentary store: module file missing', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetModuleErrorLog();
    Object.values(api).forEach(f => f.mockReset());
    api.getEntriesForVerse.mockRejectedValue(missing());
    api.getAllEntrySummaries.mockRejectedValue(missing());
    api.getNextVerseWithContent.mockRejectedValue(missing());
    useCommentaryStore.setState({ panels: new Map(), availableCommentaries: [] });
    useCommentaryStore.getState().initPanel(PANEL);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    error.mockRestore();
  });

  it('50 verse loads: 1 IPC call, 1 console.warn, 0 console.error, tab flagged unavailable', async () => {
    const s = useCommentaryStore.getState();
    for (let i = 0; i < 50; i++) await s.loadCommentaryForVerse(PANEL, 'WES', 43003000 + i);
    expect(api.getEntriesForVerse).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
    const ps = useCommentaryStore.getState().getPanelState(PANEL);
    expect(ps.unavailableByTab.get('WES')).toBe('module_missing');
    expect(ps.errorByTab.get('WES')).toBeNull();
    expect(ps.loadingByTab.get('WES')).toBe(false);
  });

  it('repeated summary loads (the pane effect re-firing) stop after one IPC call and one warn', async () => {
    const s = useCommentaryStore.getState();
    for (let i = 0; i < 20; i++) await s.loadEntrySummaries(PANEL, 'WES');
    expect(api.getAllEntrySummaries).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it('verse + summary + next/prev share one warn and make no IPC once flagged', async () => {
    const s = useCommentaryStore.getState();
    await s.loadCommentaryForVerse(PANEL, 'WES', 43003016);
    await s.loadEntrySummaries(PANEL, 'WES'); // flagged -> no IPC
    useCommentaryStore.getState().getPanelState(PANEL); // sanity
    useCommentaryStore.setState({
      panels: new Map(useCommentaryStore.getState().panels).set(PANEL, {
        ...useCommentaryStore.getState().getPanelState(PANEL),
        currentVerseId: 43003016,
      }),
    });
    await s.navigateToNextVerse(PANEL, 'WES');
    expect(api.getEntriesForVerse).toHaveBeenCalledTimes(1);
    expect(api.getAllEntrySummaries).not.toHaveBeenCalled();
    expect(api.getNextVerseWithContent).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('Retry (clearTabUnavailable) allows exactly one more attempt and one more warn', async () => {
    const s = useCommentaryStore.getState();
    await s.loadCommentaryForVerse(PANEL, 'WES', 43003016);
    s.clearTabUnavailable(PANEL, 'WES');
    await s.loadCommentaryForVerse(PANEL, 'WES', 43003016);
    await s.loadCommentaryForVerse(PANEL, 'WES', 43003017);
    expect(api.getEntriesForVerse).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('a non-module failure in summaries is logged as an error once and not auto-retried', async () => {
    api.getAllEntrySummaries.mockReset();
    api.getAllEntrySummaries.mockRejectedValue(new IpcResultError('internal', 'boom'));
    const s = useCommentaryStore.getState();
    for (let i = 0; i < 5; i++) await s.loadEntrySummaries(PANEL, 'WES');
    expect(api.getAllEntrySummaries).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a module-list refresh that shows the file back clears the flag', async () => {
    const s = useCommentaryStore.getState();
    await s.loadCommentaryForVerse(PANEL, 'WES', 43003016);
    api.getAvailableCommentaries.mockResolvedValue([{ abbreviation: 'WES', name: 'Wesley', database_path: 'wes.db' }]);
    await s.loadAvailableCommentaries();
    expect(useCommentaryStore.getState().getPanelState(PANEL).unavailableByTab.has('WES')).toBe(false);
  });

  it('a module-list refresh that still reports fileMissing keeps the flag', async () => {
    const s = useCommentaryStore.getState();
    await s.loadCommentaryForVerse(PANEL, 'WES', 43003016);
    api.getAvailableCommentaries.mockResolvedValue([{ abbreviation: 'WES', name: 'Wesley', database_path: 'wes.db', fileMissing: true }]);
    await s.loadAvailableCommentaries();
    expect(useCommentaryStore.getState().getPanelState(PANEL).unavailableByTab.get('WES')).toBe('module_missing');
  });
});
