/**
 * The audio fixture for the desktop e2e suite (a copy of apps/web/e2e/audioFixture.ts): one recorded chapter,
 * John 3, John 4 and Psalm 23 in the KJV, written under `<dir>/audio/v1/...` the way a real recordings host publishes it.
 * A quiet tone, half a second per verse, as a WAV.
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

/** Every recorded chapter the fixture publishes: John 3 (the original), then John 4 and Psalm 23 for the passage-list specs. */
export const FIXTURE_CHAPTERS: ReadonlyArray<{ book: number; chapter: number; verses: number }> = [
  { book: FIXTURE_BOOK, chapter: FIXTURE_CHAPTER, verses: FIXTURE_VERSES },
  { book: 43, chapter: 4, verses: 54 },
  { book: 19, chapter: 23, verses: 6 },
];

export function writeAudioFixture(dataDir: string): void {
  const byBook: Record<string, number[]> = {};
  for (const { book, chapter, verses } of FIXTURE_CHAPTERS) {
    const chapterDir = join(dataDir, 'audio', 'v1', FIXTURE_MODULE, 'fixture', 'r1', String(book));
    mkdirSync(chapterDir, { recursive: true });
    const duration = verses * FIXTURE_VERSE_SECONDS;
    const audio = wav(duration);
    const ccc = String(chapter).padStart(3, '0');
    writeFileSync(join(chapterDir, `${ccc}.wav`), audio);
    writeFileSync(join(chapterDir, `${ccc}.json`), JSON.stringify({
      schema: 'kth-audio-chapter/1',
      module: FIXTURE_MODULE,
      book,
      chapter,
      narrator: 'fixture',
      rev: 'r1',
      duration,
      files: [{ codec: 'pcm', mime: 'audio/wav', path: `${book}/${ccc}.wav`, bytes: audio.length }],
      verses: Array.from({ length: verses }, (_, i) => [i + 1, i * FIXTURE_VERSE_SECONDS, (i + 1) * FIXTURE_VERSE_SECONDS]),
    }, null, 2));
    (byBook[String(book)] ??= []).push(chapter);
  }
  writeFileSync(join(dataDir, 'audio', 'v1', FIXTURE_MODULE, 'index.json'), JSON.stringify({
    schema: 'kth-audio-index/1',
    module: FIXTURE_MODULE,
    narrators: [{ id: 'fixture', label: 'Fixture narrator', language: 'en', rev: 'r1', books: [], chapters: byBook }],
  }, null, 2));
}
