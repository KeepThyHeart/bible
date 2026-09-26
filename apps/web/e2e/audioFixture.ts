/**
 * The audio fixture for the e2e suite: one recorded chapter, John 3 in the KJV,
 * published the way a real build is (`index.json`, an immutable chapter manifest
 * and its audio file) under `<dataDir>/audio`, which the server serves at `/audio`
 * when `features.audio` is on.
 *
 * No other translation has a recording, which is also the state the app ships in:
 * the specs use ASV to see the "nothing can play this" case with zero recordings.
 * The audio is generated here rather than committed: a quiet tone, half a second
 * per verse, as a WAV (every browser the suite drives can play one).
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

export const FIXTURE_MODULE = 'KJV';
export const FIXTURE_BOOK = 43;
export const FIXTURE_CHAPTER = 3;
export const FIXTURE_VERSES = 36;
/** Seconds of audio per verse. Long enough to observe the highlight move, short enough to keep the suite quick. */
export const FIXTURE_VERSE_SECONDS = 0.5;

const SAMPLE_RATE = 8000;

function wav(seconds: number): Buffer {
  const samples = Math.round(seconds * SAMPLE_RATE);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE) * 1500), 44 + i * 2);
  return buf;
}

export function writeAudioFixture(dataDir: string): void {
  const chapterDir = join(dataDir, 'audio', 'v1', FIXTURE_MODULE, 'fixture', 'r1', String(FIXTURE_BOOK));
  mkdirSync(chapterDir, { recursive: true });
  const duration = FIXTURE_VERSES * FIXTURE_VERSE_SECONDS;
  const audio = wav(duration);
  const ccc = String(FIXTURE_CHAPTER).padStart(3, '0');
  writeFileSync(join(chapterDir, `${ccc}.wav`), audio);
  writeFileSync(join(chapterDir, `${ccc}.json`), JSON.stringify({
    schema: 'kth-audio-chapter/1',
    module: FIXTURE_MODULE,
    book: FIXTURE_BOOK,
    chapter: FIXTURE_CHAPTER,
    narrator: 'fixture',
    rev: 'r1',
    duration,
    files: [{ codec: 'pcm', mime: 'audio/wav', path: `${FIXTURE_BOOK}/${ccc}.wav`, bytes: audio.length }],
    verses: Array.from({ length: FIXTURE_VERSES }, (_, i) => [i + 1, i * FIXTURE_VERSE_SECONDS, (i + 1) * FIXTURE_VERSE_SECONDS]),
  }, null, 2));
  writeFileSync(join(dataDir, 'audio', 'v1', FIXTURE_MODULE, 'index.json'), JSON.stringify({
    schema: 'kth-audio-index/1',
    module: FIXTURE_MODULE,
    narrators: [{ id: 'fixture', label: 'Fixture narrator', language: 'en', rev: 'r1', books: [], chapters: { [String(FIXTURE_BOOK)]: [FIXTURE_CHAPTER] } }],
  }, null, 2));
}
