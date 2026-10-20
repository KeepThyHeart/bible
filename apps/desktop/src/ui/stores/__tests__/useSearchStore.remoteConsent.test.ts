import { describe, it, expect, vi, beforeEach } from 'vitest';

// Consent gate for the online meaning search (task 0190).
const semanticSearchExMock = vi.fn();
const getStatusMock = vi.fn();
const setConsentMock = vi.fn();

vi.mock('../../services/electronAPI', () => ({
  searchAPI: {
    performSearch: vi.fn(),
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
  useSearchStore.setState({
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

  it('Not now records declined and still runs the search', async () => {
    getStatusMock.mockResolvedValue(status('unset'));
    setConsentMock.mockResolvedValue(status('declined'));
    semanticSearchExMock.mockResolvedValue({ results: [], source: 'local', notice: { kind: 'declined' } });

    const pending = useSearchStore.getState().performSemanticSearch('love');
    await vi.waitFor(() => expect(useSearchStore.getState().consentDialogOpen).toBe(true));
    await useSearchStore.getState().answerRemoteConsent('declined');
    await pending;

    expect(setConsentMock).toHaveBeenCalledWith('declined');
    expect(semanticSearchExMock).toHaveBeenCalledTimes(1);
    expect(useSearchStore.getState().semanticNotice).toEqual({ kind: 'declined' });
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
