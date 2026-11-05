import { describe, expect, it } from 'vitest';
import { withValidationMessage } from './validationError';

describe('withValidationMessage (W-035)', () => {
  const body = JSON.stringify({ error: { code: 'INVALID_PARAM', message: 'Unmatched quote in search query' } });

  it('exposes the message of a 400 INVALID_PARAM body', () => {
    const err = withValidationMessage(new Error('Keyword search failed: 400'), 400, body);
    expect((err as Error & { validationMessage?: string }).validationMessage).toBe('Unmatched quote in search query');
    expect(err.message).toBe('Keyword search failed: 400');
  });

  it('ignores other statuses, codes and non-JSON bodies', () => {
    for (const [status, b] of [[500, body], [400, '<html>'], [400, JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'x' } })], [400, JSON.stringify({ error: 'flat' })]] as const) {
      const err = withValidationMessage(new Error('x'), status, b);
      expect((err as Error & { validationMessage?: string }).validationMessage).toBeUndefined();
    }
  });
});
