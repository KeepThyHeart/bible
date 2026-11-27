/**
 * Mapping of whatever an engine (or the worker around it) throws to `AudioError`.
 */

import type { AudioError, AudioErrorCode } from '@bible/core/browser';

export const abortedError = (): AudioError => ({ code: 'aborted', message: 'Aborted', retryable: false });

export function toTtsError(e: unknown, fallback: AudioErrorCode = 'engine'): AudioError {
  const x = e as { code?: unknown; message?: unknown; name?: unknown; retryable?: unknown } | null;
  if (x && typeof x === 'object') {
    if (x.name === 'AbortError' || x.code === 'aborted') return abortedError();
    if (typeof x.code === 'string' && typeof x.message === 'string') {
      return { code: x.code as AudioErrorCode, message: x.message, retryable: x.retryable === true };
    }
    // fetch() failing outright (offline, DNS, CORS) is a TypeError.
    if (e instanceof TypeError && /fetch|network|load failed/i.test(String(x.message))) {
      return { code: 'network', message: 'The voice could not be downloaded. Check your connection.', retryable: true };
    }
    if (typeof x.message === 'string' && x.message) {
      return { code: fallback, message: x.message, retryable: true };
    }
  }
  return { code: fallback, message: 'On-device speech failed.', retryable: true };
}
