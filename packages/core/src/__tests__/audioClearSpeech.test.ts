import { describe, it, expect } from 'vitest';
import { CLEAR_SPEECH_VERSION, clearSpeechIpa, clearSpeechSymbols } from '../audio/clearSpeech';
import { phonemizePiper } from '../audio/piperPhonemes';

// espeak-ng en-us output (1.52), as printed by `espeak-ng -q --ipa -v en-us`.
const JOHN_3_16 = 'fɔːɹ ɡˈɑːd sˌoʊ lˈʌvd ðə wˈɜːld, ðæt hiː ɡˈeɪv hɪz ˈoʊnli bᵻɡˈɑːʔn̩ sˈʌn, ðæt huːsˌoʊˈɛvɚ bᵻlˈiːvəθ ɪn hˌɪm ʃˌʊd nˌɑːt pˈɛɹɪʃ, bˌʌt hæv ˌɛvɚlˈæstɪŋ lˈaɪf.';

describe('clear speech', () => {
  it('rewrites John 3:16 as heard in the A/B, keeping stress and punctuation', () => {
    expect(clearSpeechIpa(JOHN_3_16)).toBe(
      'fɔːɹ ɡˈɑːd sˌoʊ lˈʌvd ðə wˈɜːld, ðæt hiː ɡˈeɪv hɪz ˈoʊnli bɪɡˈɑːtən sˈʌn, ðæt huːsˌoʊˈɛvɚ bɪlˈiːvəθ ɪn hˌɪm ʃˌʊd nˌɑːt pˈɛɹɪʃ, bˌʌt hæv ˌɛvɚlˈæstɪŋ lˈaɪf.',
    );
  });

  it.each([
    ['glottal stop before a syllabic n', 'ɹˈɪʔn̩', 'ɹˈɪtən'],
    ['glottal stop before a syllabic l', 'lˈɪʔl̩', 'lˈɪtəl'],
    ['other glottal stop', 'ʌʔˈoʊ', 'ʌtˈoʊ'],
    ['syllabic n alone', 'sˈiːzn̩', 'sˈiːzən'],
    ['flap', 'sˈɪɾi', 'sˈɪti'],
    ['reduced i', 'bᵻfˈoːɹ', 'bɪfˈoːɹ'],
    ['reduced a', 'ɐɡˈɛnst', 'ʌɡˈɛnst'],
  ])('%s', (_name, from, to) => {
    expect(clearSpeechIpa(from)).toBe(to);
  });

  it('leaves "the" light, joined or free-standing (version 2)', () => {
    expect(clearSpeechIpa('ðə')).toBe('ðə');
    expect(clearSpeechIpa('ʌv ðə ˈɔːɹdɚ ʌvðə')).toBe('ʌv ðə ˈɔːɹdɚ ʌvðə');
    expect(CLEAR_SPEECH_VERSION).toBe(2);
  });

  it('leaves text without reductions unchanged', () => {
    const plain = 'ɪn ðɪ bɪɡˈɪnɪŋ ɡˈɑːd kɹiːˈeɪtɪd';
    expect(clearSpeechIpa(plain)).toBe(plain);
  });

  it('skips a rule whose new symbols the engine cannot say', () => {
    const noT = (s: string): boolean => s !== 't';
    expect(clearSpeechIpa('sˈɪɾi bᵻɡˈɑːʔn̩', noT)).toBe('sˈɪɾi bɪɡˈɑːʔən');
  });

  it('works on single-code-point symbol arrays', () => {
    expect(clearSpeechSymbols([...'bᵻɡˈɑːʔn̩'])).toEqual([...'bɪɡˈɑːtən']);
  });
});

describe('phonemizePiper clearSpeech option', () => {
  /** A fake espeak: one line per entry, each word from a small table, words joined by spaces. */
  const WORDS: Record<string, string> = { the: 'ðə', begotten: 'bᵻɡˈɑːʔn̩', son: 'sˈʌn', mango: 'mˈæŋɡoʊ', olive: 'ˈɑːlɪv' };
  const run = async (args: string[]): Promise<string[]> => {
    const entries = JSON.parse(args[args.indexOf('--input') + 1]) as Array<{ text: string }>;
    return entries.map(({ text }) => JSON.stringify({
      phonemes: [...(text.toLowerCase().match(/[a-z]+/g) ?? []).map(w => WORDS[w] ?? w).join(' ')],
    }));
  };

  it('is off by default', async () => {
    expect(await phonemizePiper(run, 'en-us', 'begotten Son')).toEqual([[...'bᵻɡˈɑːʔn̩ sˈʌn']]);
  });

  it('rewrites every sentence when on, honouring the voice symbol test', async () => {
    expect(await phonemizePiper(run, 'en-us', 'begotten Son', undefined, { clearSpeech: true })).toEqual([[...'bɪɡˈɑːtən sˈʌn']]);
    expect(await phonemizePiper(run, 'en-us', 'begotten Son', s => s !== 'ɪ', { clearSpeech: true })).toEqual([[...'bᵻɡˈɑːtən sˈʌn']]);
  });

  it('applies after pronunciation markers are spliced in', async () => {
    const out = await phonemizePiper(run, 'en-us', 'the ⟦Melchisedec|mɛlkˈɪzᵻdɛk⟧', undefined, { clearSpeech: true });
    expect(out[0].join('')).toBe('ðə mɛlkˈɪzɪdɛk');
  });
});
