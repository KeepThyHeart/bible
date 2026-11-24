/**
 * Minimal WAV support for synthesized speech: mono, 16-bit PCM.
 *
 * Engines hand back `Float32Array` samples; the shared `<audio>` element plays
 * a WAV blob. Nothing here depends on the engine, its voice or its sample rate.
 */

const HEADER_BYTES = 44;
const MAX_UINT32 = 0xffffffff;

/** Float samples (nominally -1..1) to a complete WAV file. NaN becomes silence; out-of-range is clamped. */
export function encodeWav(pcm: Float32Array, sampleRate: number): ArrayBuffer {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('sampleRate must be positive');
  const dataBytes = pcm.length * 2;
  if (HEADER_BYTES + dataBytes > MAX_UINT32) throw new RangeError('audio too long for a WAV file');
  const buf = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const view = new DataView(buf);
  const ascii = (offset: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);            // fmt chunk size
  view.setUint16(20, 1, true);             // PCM
  view.setUint16(22, 1, true);             // mono
  view.setUint32(24, Math.round(sampleRate), true);
  view.setUint32(28, Math.round(sampleRate) * 2, true); // byte rate
  view.setUint16(32, 2, true);             // block align
  view.setUint16(34, 16, true);            // bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);

  let o = HEADER_BYTES;
  for (let i = 0; i < pcm.length; i++, o += 2) {
    let s = pcm[i];
    if (Number.isNaN(s)) s = 0;
    s = s > 1 ? 1 : s < -1 ? -1 : s;
    view.setInt16(o, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
  }
  return buf;
}

export function wavBlob(pcm: Float32Array, sampleRate: number): Blob {
  return new Blob([encodeWav(pcm, sampleRate)], { type: 'audio/wav' });
}

/** Seconds of audio in `samples` at `sampleRate`. */
export function pcmSeconds(samples: number, sampleRate: number): number {
  return sampleRate > 0 ? samples / sampleRate : 0;
}

/**
 * Join synthesized pieces (for example the sentences of a long verse) into one,
 * with `gapSeconds` of silence between them. Pieces must share a sample rate.
 */
export function joinPcm(pieces: Float32Array[], sampleRate: number, gapSeconds = 0.25): Float32Array {
  const gap = Math.max(0, Math.round(gapSeconds * sampleRate));
  const total = pieces.reduce((n, p) => n + p.length, 0) + gap * Math.max(0, pieces.length - 1);
  const out = new Float32Array(total);
  let offset = 0;
  pieces.forEach((p, i) => {
    out.set(p, offset);
    offset += p.length;
    if (i < pieces.length - 1) offset += gap; // the array is zero-filled: that is the silence
  });
  return out;
}
