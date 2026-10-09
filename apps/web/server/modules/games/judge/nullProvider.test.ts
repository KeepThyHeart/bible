import { describe, it, expect } from 'vitest';
import { nullJudge } from './nullProvider.js';
import type { JudgeRequest } from '../../../../src/modules/games/shared/protocol.js';

const REQUEST: JudgeRequest = {
  question: 'Who was thrown into the lions den?',
  canonicalAnswer: 'Daniel',
  accept: ['the prophet Daniel'],
  contextNote: null,
  seenPrefix: 'Who was thrown',
  playerAnswer: 'Daniel',
};

describe('the null provider', () => {
  it('offers nothing, which is what leaves the host deciding', async () => {
    expect(await nullJudge.suggest(REQUEST)).toBeNull();
  });

  it('offers nothing even for an answer that is plainly right', async () => {
    // Worth stating outright: this provider is not a stub that fails to
    // recognise a correct answer, it is a provider that never volunteers one.
    expect(await nullJudge.suggest({ ...REQUEST, playerAnswer: 'Daniel' })).toBeNull();
    expect(await nullJudge.suggest({ ...REQUEST, playerAnswer: 'nonsense' })).toBeNull();
  });

  it('survives a request with nothing in it', async () => {
    // A round whose content carries no judge block still asks for a
    // suggestion; the request is empty rather than absent.
    const empty: JudgeRequest = {
      question: '',
      canonicalAnswer: '',
      accept: [],
      contextNote: null,
      seenPrefix: '',
      playerAnswer: '',
    };
    expect(await nullJudge.suggest(empty)).toBeNull();
  });

  it('identifies itself, so a log line can say why no suggestion appeared', () => {
    expect(nullJudge.id).toBe('none');
  });
});
