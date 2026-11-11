import { describe, expect, it } from 'vitest';
import {
  applyPronunciation,
  hasPronunciation,
  parsePronunciationLexicon,
  parsePronunciationModule,
  parsePronunciationSenses,
  pronunciationFiles,
  pronunciationLocale,
  pronunciationVerseKey,
  spokenTextHash,
  splitPronunciation,
  stripPronunciation,
  type PronunciationOverlay,
} from '../audio/pronunciation';
import { phonemizePiper, piperPhonemizerArgs, planPiperPhonemizer } from '../audio/piperPhonemes';

const lexicon = parsePronunciationLexicon({
  format: 'kth-pron-lexicon/2',
  locale: 'en-us',
  entries: {
    hast: 'hˈæst',
    Job: 'dʒˈoʊb',
    Abraham: 'ˈeɪbɹəhæm',
    Moses: 'mˈoʊzᵻz',
    'beth-lehem': 'bˈɛθlᵻhɛm',
    bad: 'a b',
    broken: 'x.y',
  },
  senses: {
    blessed: { adjective: 'blˈɛsᵻd', verb: 'blˈɛst', 'Bad Label': 'x' },
    read: { past: 'ɹˈɛd' },
  },
})!;

const VERSE = 'And God blessed them, saying, Be fruitful.';
const senses = parsePronunciationSenses({
  format: 'kth-pron-senses/1',
  module: 'KJV',
  language: 'en',
  verses: {
    'GEN.1.22': { hash: spokenTextHash(VERSE), words: { 2: ['blessed', 'verb'], 9: ['wrong', 'verb'] } },
    'GEN.1.23': { hash: 'stale', words: { 0: ['And', 'verb'] } },
    'MAT.5.3': { hash: spokenTextHash('Blessed are the poor'), words: { 0: ['Blessed', 'adjective'] } },
    'MAT.5.4': { hash: spokenTextHash('Blessed are they'), words: { 0: ['Blessed', 'noun'] } },
  },
})!;

const module = parsePronunciationModule({
  format: 'kth-pron-module/1',
  module: 'KJV',
  locale: 'en-us',
  verses: {
    'MAT.5.3': { hash: spokenTextHash('Blessed are the poor'), words: { 3: ['poor', 'pˈʊɹ'] } },
  },
})!;

const overlay: PronunciationOverlay = { lexicon, senses, module };

describe('pronunciation files', () => {
  it('parse, dropping entries that are not usable IPA', () => {
    expect(lexicon.locale).toBe('en-us');
    expect(lexicon.entries.get('hast')).toBe('hˈæst');
    expect(lexicon.entries.has('bad')).toBe(false); // whitespace
    expect(lexicon.entries.has('broken')).toBe(false); // sentence punctuation would break the splitters
    expect(lexicon.senses.get('blessed')?.get('verb')).toBe('blˈɛst');
    expect(lexicon.senses.get('blessed')?.has('Bad Label')).toBe(false);
    expect(senses.verses.get('GEN.1.22')?.words.get(2)).toEqual(['blessed', 'verb']);
    expect(module.verses.get('MAT.5.3')?.words.get(3)).toEqual(['poor', 'pˈʊɹ']);
  });

  it('reject other formats', () => {
    expect(parsePronunciationLexicon({ format: 'kth-pron-lexicon/1', accent: 'en-us', entries: {} })).toBeNull();
    expect(parsePronunciationModule({ format: 'kth-pron-senses/1', module: 'KJV', locale: 'en-us', verses: {} })).toBeNull();
    expect(parsePronunciationSenses({ format: 'kth-pron-senses/1', module: 'KJV', locale: 'en-us', verses: {} })).toBeNull(); // no language
    expect(parsePronunciationLexicon(null)).toBeNull();
  });

  it('hash is FNV-1a 64 over UTF-8 (the same value the data tooling writes)', () => {
    expect(spokenTextHash('In the beginning')).toBe('f642a3d0a0b5176a');
    expect(spokenTextHash('Ænon')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('keys and accents', () => {
    expect(pronunciationVerseKey(1, 1, 22)).toBe('GEN.1.22');
    expect(pronunciationVerseKey(19, 3, 0)).toBe('PSA.3.0');
    expect(pronunciationVerseKey(99, 1, 1)).toBeUndefined();
    expect(pronunciationLocale('en-US')).toBe('en-us');
    expect(pronunciationLocale('en_GB')).toBe('en-gb');
    expect(pronunciationFiles('KJV', 'en-us')).toEqual({ lexicon: 'en-us/lexicon.json', senses: 'en/KJV.json', module: 'en-us/KJV.json' });
  });
});

describe('applyPronunciation', () => {
  it('marks lexicon words, keeping the text around them', () => {
    expect(applyPronunciation('Why hast thou?', overlay)).toBe('Why ⟦hast|hˈæst⟧ thou?');
    expect(applyPronunciation('Hast thou?', overlay)).toBe('⟦Hast|hˈæst⟧ thou?');
  });

  it('a capitalised entry matches only a capitalised word', () => {
    expect(applyPronunciation('the man Job said', overlay)).toBe('the man ⟦Job|dʒˈoʊb⟧ said');
    expect(applyPronunciation('a hard job', overlay)).toBe('a hard job');
  });

  it('derives possessives from the base', () => {
    expect(applyPronunciation("Job's friends", overlay)).toBe("⟦Job's|dʒˈoʊbz⟧ friends");
    expect(applyPronunciation("Abraham's seed", overlay)).toBe("⟦Abraham's|ˈeɪbɹəhæmz⟧ seed");
    expect(applyPronunciation("Moses' rod and Moses's", overlay)).toBe("⟦Moses|mˈoʊzᵻz⟧' rod and ⟦Moses's|mˈoʊzᵻzᵻz⟧");
  });

  it('a hyphenated compound entry covers the whole compound', () => {
    expect(applyPronunciation('to Beth-lehem.', overlay)).toBe('to ⟦Beth-lehem|bˈɛθlᵻhɛm⟧.');
  });

  it('applies occurrences only when the verse text and the word still match', () => {
    const key = 'GEN.1.22';
    expect(applyPronunciation(VERSE, overlay, key)).toBe('And God ⟦blessed|blˈɛst⟧ them, saying, Be fruitful.');
    // Word 9 does not exist / does not match: ignored.
    expect(applyPronunciation(`${VERSE} More`, overlay, key)).toBe(`${VERSE} More`); // hash differs
    expect(applyPronunciation('And God', overlay, 'GEN.1.23')).toBe('And God'); // stale hash
    expect(applyPronunciation(VERSE, overlay)).toBe(VERSE); // no key: lexicon only
  });

  it('a locale override beats the sense; an unknown sense falls through to espeak', () => {
    expect(applyPronunciation('Blessed are the poor', overlay, 'MAT.5.3')).toBe('⟦Blessed|blˈɛsᵻd⟧ are the ⟦poor|pˈʊɹ⟧');
    expect(applyPronunciation('Blessed are they', overlay, 'MAT.5.4')).toBe('Blessed are they');
  });

  it('senses need the lexicon that defines them', () => {
    expect(applyPronunciation(VERSE, { senses }, 'GEN.1.22')).toBe(VERSE);
  });

  it('word indices count the words of a compound', () => {
    const text = 'from Beth-el to Ai blessed';
    const m = parsePronunciationSenses({
      format: 'kth-pron-senses/1', module: 'X', language: 'en',
      verses: { 'GEN.1.1': { hash: spokenTextHash(text), words: { 5: ['blessed', 'adjective'] } } },
    });
    expect(applyPronunciation(text, { lexicon, senses: m }, 'GEN.1.1')).toBe('from Beth-el to Ai ⟦blessed|blˈɛsᵻd⟧');
  });

  it('no overlay leaves the text alone', () => {
    expect(applyPronunciation('Why hast thou?', null)).toBe('Why hast thou?');
  });

  it('strip and split are inverses of marking', () => {
    const marked = applyPronunciation("Why hast thou, Job's son?", overlay);
    expect(hasPronunciation(marked)).toBe(true);
    expect(stripPronunciation(marked)).toBe("Why hast thou, Job's son?");
    expect(splitPronunciation(marked)).toEqual([
      { kind: 'text', text: 'Why ' },
      { kind: 'ipa', word: 'hast', ipa: 'hˈæst' },
      { kind: 'text', text: ' thou, ' },
      { kind: 'ipa', word: "Job's", ipa: 'dʒˈoʊbz' },
      { kind: 'text', text: ' son?' },
    ]);
  });
});

// -- Piper splicing -------------------------------------------------------------

/**
 * A fake espeak: one line per entry; each word becomes its letters (stress mark before the first
 * vowel), words joined by spaces, clause punctuation kept with a following space, and leading
 * punctuation dropped, as the real phonemizer does.
 */
function fakeRun(args: string[]): Promise<string[]> {
  const entries = JSON.parse(args[args.indexOf('--input') + 1]) as Array<{ text: string }>;
  return Promise.resolve(entries.map(({ text }) => {
    const out: string[] = [];
    for (const tok of text.replace(/^[^a-z]+/i, '').match(/[a-z]+|[,.;:!?]/gi) ?? []) {
      if (/^[,.;:!?]$/.test(tok)) { out.push(tok, ' '); continue; }
      if (out.length > 0 && out[out.length - 1] !== ' ') out.push(' ');
      const w = [...tok.toLowerCase()];
      const v = w.findIndex(c => 'aeiou'.includes(c));
      if (v >= 0) w.splice(v, 0, 'ˈ');
      out.push(...w);
    }
    while (out[out.length - 1] === ' ') out.pop();
    return JSON.stringify({ phonemes: out });
  }));
}

const join = (s: string[][]): string => s.map(x => x.join('')).join('|');

describe('Piper with pronunciation markers', () => {
  it('unmarked text gets exactly the old arguments', async () => {
    const text = 'One. Two words here!';
    const plan = planPiperPhonemizer('en-us', text);
    expect(plan.args).toEqual(piperPhonemizerArgs('en-us', text));
  });

  it('placeholder plan: the whole sentence is phonemized once, the stand-in swapped for the IPA', async () => {
    const plain = join(await phonemizePiper(fakeRun, 'en-us', 'And God blessed them, saying.'));
    const spliced = join(await phonemizePiper(fakeRun, 'en-us', 'And God ⟦blessed|blˈɛst⟧ them, saying.'));
    expect(plain).toBe('ˈand gˈod blˈessed thˈem, sˈaying.');
    expect(spliced).toBe('ˈand gˈod blˈɛst thˈem, sˈaying.');
    const plan = planPiperPhonemizer('en-us', 'And God ⟦blessed|blˈɛst⟧ them.');
    const entries = JSON.parse(plan.args[plan.args.indexOf('--input') + 1]) as Array<{ text: string }>;
    expect(entries.map(e => e.text)).toEqual(['And God mango them.', 'mango', 'olive']);
  });

  it('a vowel-initial correction gets the vowel stand-in, and several markers keep their order', async () => {
    const plan = planPiperPhonemizer('en-us', '⟦Esau|ˈiːsɔː⟧ and ⟦Job|dʒˈoʊb⟧ met ⟦Esau|ˈiːsɔː⟧.');
    const entries = JSON.parse(plan.args[plan.args.indexOf('--input') + 1]) as Array<{ text: string }>;
    expect(entries[0].text).toBe('olive and mango met olive.');
    expect(join(plan.assemble(await fakeRun(plan.args))!)).toBe('ˈiːsɔː ˈand dʒˈoʊb mˈet ˈiːsɔː.');
  });

  it('split plan keeps clause punctuation that espeak drops at the start of a run', async () => {
    const plan = planPiperPhonemizer('en-us', 'And God ⟦blessed|blˈɛst⟧, saying.', undefined, 'split');
    expect(join(plan.assemble(await fakeRun(plan.args))!)).toBe('ˈand gˈod blˈɛst, sˈaying.');
  });

  it('a marker with a symbol the voice lacks is read as its word', async () => {
    const out = join(await phonemizePiper(fakeRun, 'en-us', 'And ⟦God|ɡˈɑːd⟧ spake.', s => s !== 'ɡ'));
    expect(out).toBe('ˈand gˈod spˈake.');
  });

  it('falls back to the split plan, then to plain text, when the stand-in cannot be found', async () => {
    // A phonemizer that turns every "mango" into something else: placeholders are not found.
    const odd = async (args: string[]) => (await fakeRun(args)).map(l => l.replace(/"m","ˈa","n","g","o"/g, '"z"'));
    const out = join(await phonemizePiper(odd, 'en-us', 'And God ⟦blessed|blˈɛst⟧ them.'));
    expect(out).toBe('ˈand gˈod blˈɛst thˈem.');
    const broken = async () => [JSON.stringify({ phonemes: ['x'] })];
    expect(join(await phonemizePiper(broken, 'en-us', 'And God ⟦blessed|blˈɛst⟧ them.'))).toBe('x');
  });
});
