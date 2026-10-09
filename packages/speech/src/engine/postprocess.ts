/** Pure guards against Whisper's known failure modes, plus long-audio chunking. */

const SILENCE_HALLUCINATIONS = new Set([
  'thank you', 'thanks', 'you', 'blank audio', 'blank_audio', 'music', 'thanks for watching', 'bye',
]);
const SHORT_SPEECH_MS = 600;
const MAX_REPEAT_PHRASE_WORDS = 8;

const norm = (s: string): string =>
  s.toLowerCase().replace(/[^\p{L}\p{N}\s_]/gu, ' ').replace(/\s+/g, ' ').trim();

/** Collapse a phrase (1..8 words) repeated three or more times in a row to one occurrence. */
export function collapseRepeats(words: string[]): string[] {
  const keys = words.map(norm);
  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    let collapsed = false;
    for (let n = 1; n <= MAX_REPEAT_PHRASE_WORDS && i + n * 3 <= words.length; n++) {
      let reps = 1;
      while (i + (reps + 1) * n <= words.length && keys.slice(i, i + n).every((k, j) => k === keys[i + reps * n + j])) reps++;
      if (reps >= 3) {
        out.push(...words.slice(i, i + n));
        i += reps * n;
        collapsed = true;
        break;
      }
    }
    if (!collapsed) out.push(words[i++]);
  }
  return out;
}

/**
 * Returns the cleaned text, or '' when it is a hallucination: equal to the prompt, contained in it
 * (two words or more, so a one-word answer that happens to be a prompt word survives), or a known
 * silence phrase on under 0.6 s of audio.
 */
export function cleanTranscript(text: string, prompt: string, speechMs: number): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  const t = norm(trimmed);
  if (!t) return '';
  if (speechMs < SHORT_SPEECH_MS && SILENCE_HALLUCINATIONS.has(t)) return '';
  const p = norm(prompt);
  if (p && (t === p || (t.includes(' ') && p.includes(t)))) return '';
  return collapseRepeats(trimmed.split(' ')).join(' ');
}

/**
 * Split long audio into windows of at most `windowS` seconds, each cut at the quietest
 * `frameMs` frame inside its last `searchS` seconds. Returns [start, end) sample ranges.
 */
export function splitChunks(
  pcm: Float32Array,
  { sampleRate = 16000, windowS = 28, searchS = 4, frameMs = 20 } = {},
): Array<[number, number]> {
  const win = windowS * sampleRate;
  if (pcm.length <= win) return [[0, pcm.length]];
  const frame = Math.round((frameMs * sampleRate) / 1000);
  const search = searchS * sampleRate;
  const out: Array<[number, number]> = [];
  let start = 0;
  while (pcm.length - start > win) {
    const from = start + win - search;
    let best = start + win;
    let bestE = Infinity;
    for (let s = from; s + frame <= start + win; s += frame) {
      let e = 0;
      for (let i = s; i < s + frame; i++) e += pcm[i] * pcm[i];
      if (e < bestE) {
        bestE = e;
        best = s + Math.floor(frame / 2);
      }
    }
    out.push([start, best]);
    start = best;
  }
  out.push([start, pcm.length]);
  return out;
}
