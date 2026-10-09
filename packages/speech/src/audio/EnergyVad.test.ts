import { EnergyVad } from './EnergyVad';

const tone = (amp: number, n = 320) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(i * 0.3));
let seed = 1;
const noise = (amp: number, n = 320) =>
  Float32Array.from({ length: n }, () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * amp);
const run = (v: EnergyVad, f: () => Float32Array, n: number) => Array.from({ length: n }, () => v.process(f()));

describe('EnergyVad', () => {
  it('stays silent on silence and quiet noise', () => {
    const v = new EnergyVad();
    expect(run(v, () => new Float32Array(320), 50)).not.toContain('speech');
    v.reset();
    expect(run(v, () => noise(0.002), 100)).not.toContain('speech');
  });

  it('debounces onset by 3 frames, then holds 8 frames of hangover', () => {
    const v = new EnergyVad();
    run(v, () => noise(0.002), 15);
    const on = run(v, () => tone(0.3), 10);
    expect(on.slice(0, 2)).toEqual(['silence', 'silence']);
    expect(on.slice(2)).not.toContain('silence');
    const off = run(v, () => noise(0.002), 12);
    expect(off.slice(0, 8)).not.toContain('silence');
    expect(off.slice(9)).not.toContain('speech');
  });

  it('ignores a single click', () => {
    const v = new EnergyVad();
    run(v, () => noise(0.002), 15);
    expect(v.process(tone(0.5))).toBe('silence');
    expect(run(v, () => noise(0.002), 5)).not.toContain('speech');
  });

  it('adapts to steady background noise', () => {
    const v = new EnergyVad();
    run(v, () => noise(0.05), 15);
    expect(run(v, () => noise(0.05), 50)).not.toContain('speech');
    expect(run(v, () => tone(0.5), 6)).toContain('speech');
  });

  it('reset clears state', () => {
    const v = new EnergyVad();
    run(v, () => noise(0.002), 15);
    run(v, () => tone(0.3), 5);
    v.reset();
    expect(v.process(tone(0.3))).toBe('silence');
  });
});
