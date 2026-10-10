import { createResampleState, resampleTo16k } from './resample';

const sine = (f: number, rate: number, n: number) =>
  Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * f * i) / rate));
const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
const zeroCross = (a: Float32Array) => {
  let c = 0;
  for (let i = 1; i < a.length; i++) if (a[i - 1] < 0 && a[i] >= 0) c++;
  return c;
};

describe('resampleTo16k', () => {
  it.each([48000, 44100, 22050, 8000])('keeps a 440 Hz tone at %i Hz', (rate) => {
    const out = resampleTo16k(sine(440, rate, rate), rate, createResampleState());
    expect(16000 - out.length).toBeLessThanOrEqual(40); // the kernel's look-ahead is held back
    expect(out.length).toBeLessThanOrEqual(16000);
    expect(rms(out)).toBeGreaterThan(0.5 / Math.SQRT2 - 0.04);
    expect(rms(out)).toBeLessThan(0.5 / Math.SQRT2 + 0.02);
    expect(Math.abs(zeroCross(out) - 440)).toBeLessThanOrEqual(2);
  });

  it('is identical when chunked', () => {
    const x = sine(300, 48000, 48000);
    const whole = resampleTo16k(x, 48000, createResampleState());
    const st = createResampleState();
    const parts: Float32Array[] = [];
    for (let i = 0; i < x.length; i += 128) parts.push(resampleTo16k(x.subarray(i, i + 128), 48000, st));
    const joined = Float32Array.from(parts.flatMap((p) => Array.from(p)));
    expect(joined.length).toBe(whole.length);
    for (let i = 0; i < whole.length; i++) expect(joined[i]).toBeCloseTo(whole[i], 5);
  });

  it('attenuates content above the new Nyquist', () => {
    const out = resampleTo16k(sine(20000, 48000, 48000), 48000, createResampleState());
    expect(rms(out)).toBeLessThan(0.1) /* input rms 0.35 */;
  });

  it('passes 16 kHz through', () => {
    const x = sine(440, 16000, 320);
    expect(Array.from(resampleTo16k(x, 16000, createResampleState()))).toEqual(Array.from(x));
  });
});
