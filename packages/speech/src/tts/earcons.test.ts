import { describe, expect, it } from 'vitest';
import { EARCON_NOTES, playEarcon } from './earcons';
import { FakeAudioContext } from './fakes.testutil';

describe('playEarcon', () => {
  it.each(['listen', 'ok', 'miss', 'done'] as const)('%s plays its notes in sequence', async (kind) => {
    const ctx = new FakeAudioContext();
    await playEarcon(ctx as unknown as AudioContext, kind);
    expect(ctx.nodes.map((n) => n.frequency.value)).toEqual(EARCON_NOTES[kind].map(([f]) => f));
    expect(ctx.nodes.every((n) => n.started && n.stopped)).toBe(true);
  });

  it('resumes a suspended context', async () => {
    const ctx = new FakeAudioContext();
    ctx.state = 'suspended';
    await playEarcon(ctx as unknown as AudioContext, 'ok');
    expect(ctx.state).toBe('running');
  });
});
