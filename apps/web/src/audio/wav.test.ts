import { describe, it, expect } from 'vitest';
import { encodeWav, joinPcm, pcmSeconds, wavBlob } from './wav';

const ascii = (v: DataView, o: number, n: number) =>
  Array.from({ length: n }, (_, i) => String.fromCharCode(v.getUint8(o + i))).join('');

describe('encodeWav', () => {
  it('writes a canonical 44-byte header for mono 16-bit PCM', () => {
    const buf = encodeWav(new Float32Array(100), 22050);
    const v = new DataView(buf);
    expect(buf.byteLength).toBe(44 + 200);
    expect(ascii(v, 0, 4)).toBe('RIFF');
    expect(v.getUint32(4, true)).toBe(36 + 200);
    expect(ascii(v, 8, 4)).toBe('WAVE');
    expect(ascii(v, 12, 4)).toBe('fmt ');
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(22050);
    expect(v.getUint32(28, true)).toBe(44100);
    expect(v.getUint16(32, true)).toBe(2);
    expect(v.getUint16(34, true)).toBe(16);
    expect(ascii(v, 36, 4)).toBe('data');
    expect(v.getUint32(40, true)).toBe(200);
  });

  it('converts samples: full scale, silence, clamping and NaN', () => {
    const v = new DataView(encodeWav(new Float32Array([1, -1, 0, 2, -3, NaN, 0.5]), 8000));
    const s = (i: number) => v.getInt16(44 + i * 2, true);
    expect(s(0)).toBe(32767);
    expect(s(1)).toBe(-32768);
    expect(s(2)).toBe(0);
    expect(s(3)).toBe(32767);
    expect(s(4)).toBe(-32768);
    expect(s(5)).toBe(0);
    expect(s(6)).toBe(16384);
  });

  it('accepts empty audio (a header and no data)', () => {
    const buf = encodeWav(new Float32Array(0), 16000);
    expect(buf.byteLength).toBe(44);
    expect(new DataView(buf).getUint32(40, true)).toBe(0);
  });

  it('rounds a fractional sample rate and rejects nonsense', () => {
    expect(new DataView(encodeWav(new Float32Array(1), 22050.4)).getUint32(24, true)).toBe(22050);
    for (const bad of [0, -1, NaN, Infinity]) expect(() => encodeWav(new Float32Array(1), bad)).toThrow(RangeError);
  });

  it('makes a blob with the WAV type and the encoded size', () => {
    const b = wavBlob(new Float32Array(10), 8000);
    expect(b.type).toBe('audio/wav');
    expect(b.size).toBe(64);
  });
});

describe('pcm helpers', () => {
  it('pcmSeconds divides by the sample rate and guards zero', () => {
    expect(pcmSeconds(22050, 22050)).toBe(1);
    expect(pcmSeconds(10, 0)).toBe(0);
  });

  it('joinPcm puts silence between pieces only', () => {
    const a = new Float32Array([1, 1]);
    const b = new Float32Array([2]);
    expect(Array.from(joinPcm([a, b], 4, 0.5))).toEqual([1, 1, 0, 0, 2]);
    expect(Array.from(joinPcm([a], 4, 0.5))).toEqual([1, 1]);
    expect(joinPcm([], 4).length).toBe(0);
    expect(Array.from(joinPcm([a, b], 4, 0))).toEqual([1, 1, 2]);
  });
});
