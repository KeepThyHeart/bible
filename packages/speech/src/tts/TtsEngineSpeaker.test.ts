import { describe, expect, it } from 'vitest';
import { TtsEngineSpeaker } from './TtsEngineSpeaker';
import { FakeAudioContext } from './fakes.testutil';

const setup = () => {
  const reqs: Array<{ text: string; voiceId: string; rate: number }> = [];
  const engine = {
    synthesize: async (r: { text: string; voiceId: string; rate: number }) => {
      reqs.push(r);
      return { pcm: new Float32Array(100), sampleRate: 22050 };
    },
  };
  const ctx = new FakeAudioContext();
  const speaker = new TtsEngineSpeaker(engine as never, 'amy', () => ctx as unknown as AudioContext);
  return { reqs, ctx, speaker };
};

describe('TtsEngineSpeaker', () => {
  it('synthesizes per sentence chunk and plays each', async () => {
    const { reqs, ctx, speaker } = setup();
    await speaker.speak('Short text.', { language: 'en' }, new AbortController().signal);
    expect(reqs).toEqual([{ text: 'Short text.', voiceId: 'amy', rate: 1 }]);
    expect(ctx.sources).toHaveLength(1);
    await speaker.speak(`${'word '.repeat(50)}end. ${'more '.repeat(50)}fin.`, { language: 'en', voiceId: 'bob', rate: 1.2 }, new AbortController().signal);
    expect(reqs.length).toBeGreaterThan(2);
    expect(reqs[1].voiceId).toBe('bob');
    expect(reqs[1].rate).toBe(1.2);
  });

  it('does nothing when already aborted; abort stops playback', async () => {
    const { reqs, ctx, speaker } = setup();
    const ac = new AbortController();
    ac.abort();
    await speaker.speak('Hi.', { language: 'en' }, ac.signal);
    expect(reqs).toHaveLength(0);

    const ac2 = new AbortController();
    ctx.createBufferSource = () => {
      const n = new (class { onended: null | (() => void) = null; stopped = false; connect() {} start() {} stop() { this.stopped = true; } })();
      ctx.sources.push(n as never);
      return n as never;
    };
    const p = speaker.speak('Hello.', { language: 'en' }, ac2.signal);
    await new Promise((r) => setTimeout(r, 5));
    ac2.abort();
    await p;
    expect((ctx.sources[0] as unknown as { stopped: boolean }).stopped).toBe(true);
  });

  it('earcon works', async () => {
    const { ctx, speaker } = setup();
    await speaker.earcon('ok');
    expect(ctx.nodes).toHaveLength(1);
  });
});
