/** Short WebAudio tones for listening feedback; no assets. */

export type EarconKind = 'listen' | 'ok' | 'miss' | 'done';

/** [frequency Hz, duration s] per note. */
export const EARCON_NOTES: Record<EarconKind, Array<[number, number]>> = {
  listen: [[523.25, 0.08], [783.99, 0.1]],
  ok: [[1046.5, 0.12]],
  miss: [[220, 0.2]],
  done: [[523.25, 0.1], [659.25, 0.1], [783.99, 0.16]],
};

/** Plays the tones on `ctx`; resolves when the last one has ended. */
export async function playEarcon(ctx: AudioContext, kind: EarconKind): Promise<void> {
  if (ctx.state === 'suspended') await ctx.resume();
  const gain = ctx.createGain();
  gain.gain.value = 0.15;
  gain.connect(ctx.destination);
  let t = ctx.currentTime;
  let last: OscillatorNode | undefined;
  for (const [freq, dur] of EARCON_NOTES[kind]) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + dur);
    t += dur;
    last = osc;
  }
  if (!last) return;
  const end = last;
  await new Promise<void>((resolve) => {
    end.onended = () => {
      gain.disconnect();
      resolve();
    };
  });
}
