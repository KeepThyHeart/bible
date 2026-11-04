import { describe, it, expect } from 'vitest';
import { connectionStore, CONNECTION_ERROR_NETWORK } from './connectionStore';

describe('connectionStore (soak WV-04)', () => {
  it('a successful request clears the stale network-error banner', () => {
    connectionStore.setError(CONNECTION_ERROR_NETWORK);
    expect(connectionStore.error).toBe(CONNECTION_ERROR_NETWORK);
    connectionStore.clearNetworkError();
    expect(connectionStore.error).toBeNull();
  });

  it('does not clear other errors', () => {
    connectionStore.setError('Something else');
    connectionStore.clearNetworkError();
    expect(connectionStore.error).toBe('Something else');
    connectionStore.dismiss();
  });

  it('going back online clears the network banner', () => {
    connectionStore.setError(CONNECTION_ERROR_NETWORK);
    window.dispatchEvent(new Event('online'));
    expect(connectionStore.error).toBeNull();
  });
});
