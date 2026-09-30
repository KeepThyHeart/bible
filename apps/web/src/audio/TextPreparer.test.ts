import { describe, it, expect } from 'vitest';
import { TextPreparer } from './TextPreparer';

const p = new TextPreparer();
const v = (text: string, html?: string) => ({ verse: 1, text, html });

describe('verse text (English)', () => {
  it.each<[string, string, string]>([
    ['plain KJV verse is unchanged',
      'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.',
      'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.'],
    ['divine name in capitals', 'The LORD is my shepherd; I shall not want.', 'The Lord is my shepherd; I shall not want.'],
    ['LORD GOD together', 'Thus saith the Lord GOD, the LORD of hosts.', 'Thus saith the Lord God, the Lord of hosts.'],
    ['possessives', "The LORD'S mercies and GOD’S word.", "The Lord's mercies and God's word."],
    ['Jehovah / Selah', 'JEHOVAH is his name. SELAH.', 'Jehovah is his name. Selah.'],
    ['other small-caps words are sentence-cased', 'the ALMIGHTY hath spoken', 'the Almighty hath spoken'],
    ['short capitals such as Roman numerals are left', 'Herod II ruled', 'Herod II ruled'],
    ['brackets round supplied words keep the words', 'And the Word [was] with God.', 'And the Word was with God.'],
    ['footnote letters in brackets vanish', 'In the beginning[a] God created[b] the heavens.', 'In the beginning God created the heavens.'],
    ['footnote glyphs vanish', 'In the beginning† God* created‡ it.', 'In the beginning God created it.'],
    ['superscript markers vanish', 'And God said¹ let there be light².', 'And God said let there be light.'],
    ['pilcrows vanish', '¶ In the beginning God created.', 'In the beginning God created.'],
    ['publisher braces vanish', 'And he said {Gr. saith} unto them,', 'And he said unto them,'],
    ['em dashes become pauses', 'He answered—and said—Yes.', 'He answered, and said, Yes.'],
    ['spaced double hyphen', 'He answered -- and said.', 'He answered, and said.'],
    ['ellipsis', 'And so…', 'And so...'],
    ['curly quotes', '“It is I,” he said, ‘Fear not.’', '"It is I," he said, \'Fear not.\''],
    ['whitespace collapses', '  In   the\n beginning was  ', 'In the beginning was'],
    ['digits are left for the engine to read', 'about 153 great fishes', 'about 153 great fishes'],
    ['a leading dash does not leave a comma', '—And he said.', 'And he said.'],
  ])('%s', (_name, input, expected) => {
    expect(p.verse(v(input), 'en')).toBe(expected);
  });

  it('strips Strong\'s tags, spans and other markup from html', () => {
    const html = '<span class="christ-words">For God so <WG2316> loved <WG25></span> the <span class="divine-name">LORD</span>&nbsp;&amp; he.';
    expect(p.verse({ verse: 1, text: '', html }, 'en')).toBe('For God so loved the Lord & he.');
  });

  it('decodes numeric and named entities, and leaves unknown ones alone', () => {
    expect(p.verse({ verse: 1, text: '', html: 'Tom &#39;s &#x41; &amp; &unknown; &#0; end' }, 'en')).toBe("Tom 's A & &unknown; end");
  });

  it('prefers the canonical text over the html', () => {
    expect(p.verse({ verse: 1, text: 'Clean text.', html: '<b>Other</b>' }, 'en')).toBe('Clean text.');
  });

  it('an empty or markup-only verse becomes an empty string', () => {
    expect(p.verse(v(''), 'en')).toBe('');
    expect(p.verse({ verse: 1, text: '', html: '<span></span>' }, 'en')).toBe('');
    expect(p.verse(v('¶ [a]'), 'en')).toBe('');
  });

  it('does not treat an escaped angle bracket as a tag', () => {
    expect(p.verse({ verse: 1, text: '', html: 'a &lt;b&gt; c' }, 'en')).toBe('a <b> c');
  });
});

describe('verse text (other languages)', () => {
  it('gets the neutral cleanup but no English rewrites', () => {
    expect(p.verse(v('El SEÑOR es mi pastor [a]; no me faltará.'), 'es')).toBe('El SEÑOR es mi pastor; no me faltará.');
    expect(p.verse(v('耶和华是我的牧者†，我必不至缺乏。'), 'zh-Hans')).toBe('耶和华是我的牧者，我必不至缺乏。');
  });
});

describe('chapterIntro', () => {
  const ref = (book: number, chapter: number) => ({ moduleAbbr: 'KJV', book, chapter });

  it.each<[number, number, string, string]>([
    [43, 3, 'John', 'John, chapter 3.'],
    [1, 1, 'Genesis', 'Genesis, chapter 1.'],
    [19, 23, 'Psalms', 'Psalm 23.'],
    [65, 1, 'Jude', 'Jude.'],
    [63, 1, '2 John', 'Second John.'],
    [62, 4, '1 John', 'First John, chapter 4.'],
    [46, 13, '1 Corinthians', 'First Corinthians, chapter 13.'],
    [22, 2, 'Song of Solomon', 'Song of Solomon, chapter 2.'],
  ])('English: book %i chapter %i', (book, chapter, name, expected) => {
    expect(p.chapterIntro(ref(book, chapter), name)).toBe(expected);
    expect(p.chapterIntro(ref(book, chapter), name, 'en-US')).toBe(expected);
  });

  it('Spanish, Chinese and unknown languages', () => {
    expect(p.chapterIntro(ref(43, 3), 'Juan', 'es')).toBe('Juan, capítulo 3.');
    expect(p.chapterIntro(ref(43, 3), '约翰福音', 'zh-Hans')).toBe('约翰福音，第3章。');
    expect(p.chapterIntro(ref(65, 1), '犹大书', 'zh')).toBe('犹大书。');
    expect(p.chapterIntro(ref(43, 3), 'Johannes', 'sw')).toBe('Johannes 3.');
    expect(p.chapterIntro(ref(65, 1), 'Yuda', 'sw')).toBe('Yuda.');
  });
});
