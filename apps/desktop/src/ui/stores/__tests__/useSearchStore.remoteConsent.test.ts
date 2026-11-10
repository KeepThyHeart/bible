import { describe, it, expect, vi, beforeEach } from 'vitest';

// Consent gate for the online meaning search (task 0190).
const semanticSearchExMock = vi.fn();
const getStatusMock = vi.fn();
const setConsentMock = vi.fn();
const performSearchMock = vi.fn();

vi.mock('../../services/electronAPI', () => ({
  searchAPI: {
    performSearch: (...a: unknown[]) => performSearchMock(...a),
    semanticSearchEx: (...a: unknown[]) => semanticSearchExMock(...a),
    semanticAvailable: vi.fn().mockResolvedValue(true),
  },
  remoteSemanticAPI: {
    getStatus: () => getStatusMock(),
    setConsent: (d: string) => setConsentMock(d),
  },
  dictionaryAPI: { getAvailableDictionaries: vi.fn().mockResolvedValue([]), getEntryByKey: vi.fn() },
}));

import { useSearchStore } from '../useSearchStore';

const status = (consent: 'granted' | 'declined' | 'unset', configured = true) => ({
  configured,
  consent,
  noticeVersion: 1,
});

const REPLY = { results: [{ id: 'x' }], source: 'remote' as const };

beforeEach(() => {
  semanticSearchExMock.mockReset().mockResolvedValue(REPLY);
  getStatusMock.mockReset();
  setConsentMock.mockReset();
  performSearchMock.mockReset();
  useSearchStore.setState({
    // A local pack is installed unless a test says otherwise.
    semanticAvailable: true,
    isSemanticMode: false,
    semanticResults: [],
    isSemanticSearching: false,
    remoteSemanticStatus: null,
    consentDialogOpen: false,
    semanticSource: null,
    semanticNotice: null,
    semanticRateLimit: null,
  });
});

describe('performSemanticSearch consent gate', () => {
  it('opens the modal and calls nothing until Agree, then searches', async () => {
    getStatusMock.mockResolvedValue(status('unset'));
    setConsentMock.mockResolvedValue(status('granted'));

    const pending = useSearchStore.getState().performSemanticSearch('love');
    await vi.waitFor(() => expect(useSearchStore.getState().consentDialogOpen).toBe(true));
    expect(semanticSearchExMock).not.toHaveBeenCalled();

    await useSearchStore.getState().answerRemoteConsent('granted');
    await pending;

    expect(setConsentMock).toHaveBeenCalledWith('granted');
    expect(semanticSearchExMock).toHaveBeenCalledTimes(1);
    expect(useSearchStore.getState().consentDialogOpen).toBe(false);
    expect(useSearchStore.getState().semanticSource).toBe('remote');
    expect(useSearchStore.getState().semanticResults).toHaveLength(1);
  });

  it('Not now records nothing, skips this Ideas search, and asks again next time', async () => {
    getStatusMock.mockResolvedValue(status('unset'));
    useSearchStore.setState({ isSemanticMode: true, remoteSemanticStatus: status('unset') });

    const pending = useSearchStore.getState().performSemanticSearch('love');
    await vi.waitFor(() => expect(useSearchStore.getState().consentDialogOpen).toBe(true));
    await useSearchStore.getState().answerRemoteConsent('notNow');
    await pending;

    expect(setConsentMock).not.toHaveBeenCalled();
    expect(semanticSearchExMock).not.toHaveBeenCalled();
    const s = useSearchStore.getState();
    expect(s.consentDialogOpen).toBe(false);
    expect(s.isSemanticSearching).toBe(false);
    // back on keyword search, with no "declined" note and no local fallback
    expect(s.isSemanticMode).toBe(false);
    expect(s.semanticNotice).toBeNull();
    expect(s.semanticSource).toBeNull();

    // the next Ideas search asks again
    const again = useSearchStore.getState().performSemanticSearch('love');
    await vi.waitFor(() => expect(useSearchStore.getState().consentDialogOpen).toBe(true));
    await useSearchStore.getState().answerRemoteConsent('notNow');
    await again;
    expect(semanticSearchExMock).not.toHaveBeenCalled();
  });

  it("Don't use the online service records declined and runs the search (local pack answers)", async () => {
    getStatusMock.mockResolvedValue(status('unset'));
    setConsentMock.mockResolvedValue({ ...status('declined'), source: 'offline' });
    semanticSearchExMock.mockResolvedValue({ results: [{ id: 'y' }], source: 'local' });

    const pending = useSearchStore.getState().performSemanticSearch('love');
    await vi.waitFor(() => expect(useSearchStore.getState().consentDialogOpen).toBe(true));
    await useSearchStore.getState().answerRemoteConsent('declined');
    await pending;

    expect(setConsentMock).toHaveBeenCalledWith('declined');
    expect(semanticSearchExMock).toHaveBeenCalledTimes(1);
    expect(useSearchStore.getState().semanticSource).toBe('local');
  });

  it('after a decline with no local pack, picking Ideas asks again instead of failing', async () => {
    getStatusMock.mockResolvedValue({ ...status('declined'), source: 'offline' });
    useSearchStore.setState({ semanticAvailable: false, remoteSemanticStatus: { ...status('declined'), source: 'offline' } });
    const pending = useSearchStore.getState().performSemanticSearch('love');
    await vi.waitFor(() => expect(useSearchStore.getState().consentDialogOpen).toBe(true));
    setConsentMock.mockResolvedValue({ ...status('granted'), source: 'online' });
    await useSearchStore.getState().answerRemoteConsent('granted');
    await pending;
    expect(setConsentMock).toHaveBeenCalledWith('granted');
    expect(semanticSearchExMock).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent searches onto one modal', async () => {
    getStatusMock.mockResolvedValue(status('unset'));
    setConsentMock.mockResolvedValue(status('granted'));
    const a = useSearchStore.getState().performSemanticSearch('one');
    const b = useSearchStore.getState().performSemanticSearch('two');
    await vi.waitFor(() => expect(useSearchStore.getState().consentDialogOpen).toBe(true));
    await useSearchStore.getState().answerRemoteConsent('granted');
    await Promise.all([a, b]);
    expect(setConsentMock).toHaveBeenCalledTimes(1);
    expect(semanticSearchExMock).toHaveBeenCalledTimes(2);
  });

  it.each(['granted', 'declined'] as const)('never asks when consent is %s', async (consent) => {
    getStatusMock.mockResolvedValue(status(consent));
    await useSearchStore.getState().performSemanticSearch('love');
    await useSearchStore.getState().performSemanticSearch('grace');
    expect(useSearchStore.getState().consentDialogOpen).toBe(false);
    expect(semanticSearchExMock).toHaveBeenCalledTimes(2);
  });

  it('never opens the modal when the remote service is not configured', async () => {
    getStatusMock.mockResolvedValue(status('unset', false));
    await useSearchStore.getState().performSemanticSearch('love');
    expect(useSearchStore.getState().consentDialogOpen).toBe(false);
    expect(semanticSearchExMock).toHaveBeenCalledTimes(1);
  });

  it('behaves as before when the status call fails', async () => {
    getStatusMock.mockRejectedValue(new Error('no bridge'));
    await useSearchStore.getState().performSemanticSearch('love');
    expect(useSearchStore.getState().consentDialogOpen).toBe(false);
    expect(semanticSearchExMock).toHaveBeenCalledTimes(1);
  });

  it('setRemoteSemanticConsent withdraws, re-enables and refreshes availability', async () => {
    let current = status('granted');
    setConsentMock.mockImplementation(async (d: string) => {
      current = status(d === 'reset' ? 'unset' : (d as 'declined'));
      return current;
    });
    getStatusMock.mockImplementation(async () => current);
    await useSearchStore.getState().setRemoteSemanticConsent('declined');
    expect(useSearchStore.getState().remoteSemanticStatus?.consent).toBe('declined');
    await useSearchStore.getState().setRemoteSemanticConsent('reset');
    expect(setConsentMock).toHaveBeenLastCalledWith('reset');
    expect(useSearchStore.getState().remoteSemanticStatus?.consent).toBe('unset');
  });
});

describe('when nothing answers a semantic search', () => {
  it('falls back to keyword mode with the declined hint', async () => {
    getStatusMock.mockResolvedValue(status('declined'));
    semanticSearchExMock.mockRejectedValue(new Error('unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useSearchStore.setState({ isSemanticMode: true });
    await useSearchStore.getState().performSemanticSearch('love');
    const s = useSearchStore.getState();
    expect(s.isSemanticMode).toBe(false);
    expect(s.semanticNotice).toEqual({ kind: 'declined' });
  });
  it('does not touch the mode when remote is not configured', async () => {
    getStatusMock.mockResolvedValue(status('unset', false));
    semanticSearchExMock.mockRejectedValue(new Error('unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useSearchStore.setState({ isSemanticMode: true });
    await useSearchStore.getState().performSemanticSearch('love');
    expect(useSearchStore.getState().isSemanticMode).toBe(true);
    expect(useSearchStore.getState().semanticNotice).toBeNull();
  });
});

describe('Ideas search is opt-in', () => {
  it('a keyword search with zero hits never switches to or runs Ideas search', async () => {
    getStatusMock.mockResolvedValue(status('granted'));
    performSearchMock.mockResolvedValue([]);
    await useSearchStore.getState().performSearch('nowhere to be found');
    const s = useSearchStore.getState();
    expect(performSearchMock).toHaveBeenCalledTimes(1);
    expect(s.searchResults).toEqual([]);
    expect(s.isSemanticMode).toBe(false);
    expect(semanticSearchExMock).not.toHaveBeenCalled();
    expect(s.consentDialogOpen).toBe(false);
  });

  it('a tab the user put in Ideas mode runs Ideas search with each query', async () => {
    getStatusMock.mockResolvedValue(status('granted'));
    performSearchMock.mockResolvedValue([]);
    useSearchStore.setState({ isSemanticMode: true });
    await useSearchStore.getState().performSearch('love one another');
    await vi.waitFor(() => expect(semanticSearchExMock).toHaveBeenCalledTimes(1));
  });

  it('Ideas stays selectable after a decline with no local pack; only source off removes it', async () => {
    const { isIdeasSelectable } = await import('../useSearchStore');
    const declined = { ...status('declined'), source: 'offline' as const };
    expect(isIdeasSelectable({ semanticAvailable: false, remoteSemanticStatus: declined })).toBe(true);
    expect(isIdeasSelectable({ semanticAvailable: false, remoteSemanticStatus: { ...declined, source: 'off' } })).toBe(false);
    expect(isIdeasSelectable({ semanticAvailable: false, remoteSemanticStatus: status('unset', false) })).toBe(false);
    expect(isIdeasSelectable({ semanticAvailable: true, remoteSemanticStatus: null })).toBe(true);
  });
});
