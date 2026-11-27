/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { requestOpenNote, useNoteOpenRequest, claimRecentOpenNoteRequest } from './noteOpenRequest';

describe('noteOpenRequest', () => {
  it('delivers a request made before the pane mounted, once', () => {
    requestOpenNote('A.bn');
    const handler = vi.fn();
    renderHook(() => useNoteOpenRequest(handler));
    expect(handler).toHaveBeenCalledWith('A.bn');
    expect(claimRecentOpenNoteRequest()).toBeUndefined();
  });

  it('delivers live requests and does not leave them claimable', () => {
    const handler = vi.fn();
    renderHook(() => useNoteOpenRequest(handler));
    requestOpenNote('B.bn');
    expect(handler).toHaveBeenCalledWith('B.bn');
    expect(claimRecentOpenNoteRequest()).toBeUndefined();
  });
});
