import { cleanTranscript, collapseRepeats, splitChunks } from './postprocess';

describe('cleanTranscript', () => {
  it('passes normal text through, normalising whitespace', () => {
    expect(cleanTranscript('  For God  so loved ', '', 3000)).toBe('For God so loved');
  });
  it('drops text equal to or contained in the prompt', () => {
    expect(cleanTranscript('Nicodemus, begotten', 'Nicodemus, begotten', 3000)).toBe('');
    expect(cleanTranscript('Nicodemus begotten', 'Nicodemus, begotten, Capernaum', 3000)).toBe('');
  });
  it('keeps a one-word answer that is only part of the prompt', () => {
    expect(cleanTranscript('Nicodemus', 'Nicodemus, begotten', 3000)).toBe('Nicodemus');
  });
  it('drops silence hallucinations only on short audio', () => {
    expect(cleanTranscript('Thank you.', '', 400)).toBe('');
    expect(cleanTranscript('[BLANK_AUDIO]', '', 300)).toBe('');
    expect(cleanTranscript('(music)', '', 100)).toBe('');
    expect(cleanTranscript('you', '', 500)).toBe('');
    expect(cleanTranscript('Thank you.', '', 2000)).toBe('Thank you.');
  });
  it('returns empty for empty or punctuation-only text', () => {
    expect(cleanTranscript('  ', '', 3000)).toBe('');
    expect(cleanTranscript('...', '', 3000)).toBe('');
  });
  it('collapses a phrase repeated three or more times', () => {
    expect(cleanTranscript('amen amen amen amen', '', 3000)).toBe('amen');
    expect(cleanTranscript('the Lord is the Lord is the Lord is my shepherd', '', 3000)).toBe('the Lord is my shepherd');
    expect(cleanTranscript('amen amen', '', 3000)).toBe('amen amen');
  });
});

describe('collapseRepeats', () => {
  it('is case and punctuation insensitive but keeps the first occurrence', () => {
    expect(collapseRepeats(['Go,', 'go', 'GO!', 'now'])).toEqual(['Go,', 'now']);
  });
});

describe('splitChunks', () => {
  it('returns one chunk up to 28 s', () => {
    expect(splitChunks(new Float32Array(16000 * 28))).toEqual([[0, 16000 * 28]]);
  });
  it('cuts at the quietest frame in the last 4 s of the window', () => {
    const pcm = new Float32Array(16000 * 40).fill(0.5);
    const quiet = 16000 * 26; // inside [24 s, 28 s)
    pcm.fill(0, quiet, quiet + 320);
    const chunks = splitChunks(pcm);
    expect(chunks).toHaveLength(2);
    expect(chunks[0][0]).toBe(0);
    expect(chunks[0][1]).toBeGreaterThanOrEqual(quiet);
    expect(chunks[0][1]).toBeLessThanOrEqual(quiet + 320);
    expect(chunks[1]).toEqual([chunks[0][1], pcm.length]);
  });
  it('covers all samples contiguously for very long audio', () => {
    const pcm = new Float32Array(16000 * 90);
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i / 7);
    const chunks = splitChunks(pcm);
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    expect(chunks[0][0]).toBe(0);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i][0]).toBe(chunks[i - 1][1]);
    expect(chunks.at(-1)![1]).toBe(pcm.length);
    for (const [s, e] of chunks) expect(e - s).toBeLessThanOrEqual(16000 * 28);
  });
});
