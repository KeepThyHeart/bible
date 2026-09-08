/**
 * @vitest-environment node
 *
 * Codec unit tests.
 *
 * Two things are being checked here, and they are not the same thing:
 *
 *   1. that binary survives the realm boundary byte-for-byte, which is the
 *      regression the codec exists to fix; and
 *   2. that *non*-binary payloads are unchanged by its presence - a codec that
 *      quietly rewrites ordinary extension data would trade one silent
 *      corruption for another.
 *
 * `QuickJSRealm.test.ts` covers the same ground through a live realm. These
 * tests are the ones that can afford to be exhaustive about edge cases.
 */

import { describe, expect, it } from 'vitest';

import {
  base64ToBytes,
  base64ToBytesJs,
  bytesToBase64,
  bytesToBase64Js,
  decodeEnvelope,
  encodeEnvelope,
  EnvelopeCodecError,
} from '../binaryCodec';

/** Encode -> decode, the way an envelope actually travels. */
function roundTrip<T>(value: T): unknown {
  return decodeEnvelope(encodeEnvelope(value));
}

describe('binaryCodec — binary fidelity', () => {
  it('round-trips a Uint8Array as a Uint8Array with identical bytes', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 254, 255]);
    const out = roundTrip({ data: bytes }) as { data: Uint8Array };
    expect(out.data).toBeInstanceOf(Uint8Array);
    expect(Array.from(out.data)).toEqual(Array.from(bytes));
  });

  it('round-trips an ArrayBuffer as an ArrayBuffer', () => {
    const buf = new Uint8Array([9, 8, 7]).buffer;
    const out = roundTrip({ contents: buf }) as { contents: ArrayBuffer };
    expect(out.contents).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(out.contents))).toEqual([9, 8, 7]);
  });

  it('preserves every byte value across a full 0..255 sweep', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    const out = roundTrip(bytes) as Uint8Array;
    expect(Array.from(out)).toEqual(Array.from(bytes));
  });

  it('handles every length modulo 3, which is where base64 padding goes wrong', () => {
    for (let len = 0; len <= 12; len++) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 37 + 11) & 0xff;
      const out = roundTrip(bytes) as Uint8Array;
      expect(Array.from(out), `length ${len}`).toEqual(Array.from(bytes));
    }
  });

  it('round-trips a payload larger than one internal chunk', () => {
    const bytes = new Uint8Array(64 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) & 0xff;
    const out = roundTrip(bytes) as Uint8Array;
    expect(out.length).toBe(bytes.length);
    expect(Buffer.from(out).equals(Buffer.from(bytes))).toBe(true);
  });

  it('copies a view without dragging its backing buffer along', () => {
    // `Buffer.from(...)`-style views are windows onto a larger pool. Encoding
    // must take the view's own bytes, not the whole pool.
    const pool = new Uint8Array([0, 0, 1, 2, 3, 0, 0]);
    const view = pool.subarray(2, 5);
    const out = roundTrip(view) as Uint8Array;
    expect(Array.from(out)).toEqual([1, 2, 3]);
    expect(out.byteLength).toBe(3);
  });

  it('treats a Node Buffer as a Uint8Array, which is what the realm can hold', () => {
    const out = roundTrip({ b: Buffer.from('hello', 'utf8') }) as { b: Uint8Array };
    expect(out.b).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(out.b).toString('utf8')).toBe('hello');
  });

  it('preserves non-byte views as their own type', () => {
    const out = roundTrip({ f: new Float64Array([1.5, -2.25]) }) as { f: Float64Array };
    expect(out.f).toBeInstanceOf(Float64Array);
    expect(Array.from(out.f)).toEqual([1.5, -2.25]);
  });

  it('finds binary nested inside arrays and objects', () => {
    const out = roundTrip({
      kind: 'request',
      args: [{ files: [{ contents: new Uint8Array([1, 2]) }] }],
    }) as { args: [{ files: [{ contents: Uint8Array }] }] };
    expect(Array.from(out.args[0].files[0].contents)).toEqual([1, 2]);
  });
});

describe('binaryCodec — ordinary payloads are untouched', () => {
  it('leaves a realistic envelope structurally identical', () => {
    const envelope = {
      kind: 'response',
      id: 'worker-7',
      result: {
        verses: [
          { verseId: 43003016, text: 'For God so loved the world…', tags: ['john'] },
          { verseId: 43003017, text: null },
        ],
        total: 2,
        nested: { deep: { deeper: [1, 2, { ok: true }] } },
      },
    };
    expect(roundTrip(envelope)).toEqual(envelope);
  });

  it('matches JSON.stringify for values JSON has opinions about', () => {
    // Dates go through `toJSON`, functions and undefined vanish from objects
    // and become null in arrays. The codec must not change any of that.
    const value = { when: new Date('2026-07-28T12:00:00.000Z'), n: 1 };
    expect(encodeEnvelope(value)).toBe(JSON.stringify(value));

    const sparse = { fn: () => 1, u: undefined, keep: 2 };
    expect(encodeEnvelope(sparse)).toBe(JSON.stringify(sparse));

    const arr = [1, undefined, () => 1, null];
    expect(encodeEnvelope(arr)).toBe(JSON.stringify(arr));
  });

  it('round-trips an object whose own key collides with the binary marker', () => {
    // Without the escape hatch this decodes into a Uint8Array - a type
    // confusion the transport would have invented on the extension's behalf.
    const value = { $bin$: { t: 'u8', d: 'AAEC' } };
    const out = roundTrip(value);
    expect(out).toEqual(value);
    expect(out).not.toBeInstanceOf(Uint8Array);
  });

  it('round-trips an object whose own key collides with the escape marker', () => {
    const value = { $esc$: { $esc$: { $bin$: 1 } } };
    expect(roundTrip(value)).toEqual(value);
  });

  it('keeps a marker-colliding object working alongside real binary', () => {
    const value = { fake: { $bin$: 'not binary' }, real: new Uint8Array([5]) };
    const out = roundTrip(value) as { fake: unknown; real: Uint8Array };
    expect(out.fake).toEqual({ $bin$: 'not binary' });
    expect(Array.from(out.real)).toEqual([5]);
  });
});

describe('binaryCodec — refusals', () => {
  it('rejects a cycle rather than looping forever', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic.self = cyclic;
    expect(() => encodeEnvelope(cyclic)).toThrow(EnvelopeCodecError);
  });

  it('rejects a payload nested past the depth ceiling', () => {
    let deep: unknown = 'leaf';
    for (let i = 0; i < 200; i++) deep = { deep };
    expect(() => encodeEnvelope(deep)).toThrow(/nested deeper/);
  });

  it('refuses over-deep input on the way in, not just on the way out', () => {
    // Hand-built JSON, because the encoder would have refused to produce it.
    // This is the direction that matters: inbound envelopes come from the
    // guest, and the host walks them.
    let json = '"leaf"';
    for (let i = 0; i < 200; i++) json = `{"deep":${json}}`;
    expect(() => decodeEnvelope(json)).toThrow(EnvelopeCodecError);
  });

  it('reports malformed JSON as a codec error', () => {
    expect(() => decodeEnvelope('{not json')).toThrow(EnvelopeCodecError);
  });

  it('rejects a binary wrapper with an unknown tag', () => {
    expect(() => decodeEnvelope('{"$bin$":{"t":"nope","d":"AAA="}}')).toThrow(/unknown binary tag/);
  });

  it('rejects a binary wrapper with a missing payload', () => {
    expect(() => decodeEnvelope('{"$bin$":{"t":"u8"}}')).toThrow(/malformed binary payload/);
  });
});

/**
 * These target the `*Js` variants on purpose. `Buffer` exists under Vitest, so
 * `bytesToBase64`/`base64ToBytes` would take the host fast path and the code
 * that actually ships into the realm - where there is no `Buffer` - would go
 * untested. Node is the oracle for both.
 */
describe('binaryCodec — pure-JS base64 (the implementation the realm uses)', () => {
  it('agrees with Node on encoding at every length', () => {
    for (let len = 0; len <= 64; len++) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 53 + 7) & 0xff;
      expect(bytesToBase64Js(bytes), `length ${len}`).toBe(Buffer.from(bytes).toString('base64'));
    }
  });

  it('agrees with Node on encoding across every byte value', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    expect(bytesToBase64Js(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('agrees with Node on encoding past the internal chunk size', () => {
    const bytes = new Uint8Array(20_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 17) & 0xff;
    expect(bytesToBase64Js(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('agrees with Node on decoding at every length', () => {
    const source = Buffer.from('The quick brown fox jumps over the lazy dog', 'utf8');
    for (let len = 0; len <= source.length; len++) {
      const slice = source.subarray(0, len);
      expect(
        Array.from(base64ToBytesJs(slice.toString('base64'))),
        `length ${len}`,
      ).toEqual(Array.from(slice));
    }
  });

  it('skips characters outside the alphabet instead of emitting garbage', () => {
    const clean = Buffer.from([1, 2, 3, 4, 5]).toString('base64');
    const dirty = clean.split('').join('\n ');
    expect(Array.from(base64ToBytesJs(dirty))).toEqual([1, 2, 3, 4, 5]);
  });

  it('is interchangeable with the host fast path in both directions', () => {
    const bytes = new Uint8Array([0, 1, 64, 128, 200, 255, 42]);
    expect(bytesToBase64Js(bytes)).toBe(bytesToBase64(bytes));
    const b64 = bytesToBase64(bytes);
    expect(Array.from(base64ToBytesJs(b64))).toEqual(Array.from(base64ToBytes(b64)));
  });
});
