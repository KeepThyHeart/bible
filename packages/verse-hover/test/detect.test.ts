import { describe, it, expect } from 'vitest';
import { createDetector } from '../src/detect';
import { pack as en, chapters } from '../src/locales/en.generated';
import { pack as es } from '../src/locales/es.generated';

const fmt = (t: string, o = {}, pack = en) =>
  createDetector(pack, chapters, o).detect(t).map((r) => `${r.book}:${r.chapter}${r.verse !== undefined ? ':' + r.verse : ''}${r.endChapter ? '-' + r.endChapter : ''}${r.endVerse ? '~' + r.endVerse : ''}|${t.slice(r.start, r.end)}`);

const positive: [string, string[], object?][] = [
  ['Read John 3:16 today', ['43:3:16|John 3:16']],
  ['John 3:16', ['43:3:16|John 3:16']],
  ['See 1 John 3:16.', ['62:3:16|1 John 3:16']],
  ['In 1 John 3:16 we see', ['62:3:16|1 John 3:16']],
  ['Read 2 Timothy 1:7 now', ['55:1:7|2 Timothy 1:7']],
  ['II Corinthians 5:17', ['47:5:17|II Corinthians 5:17']],
  ['I Corinthians 13:4-7', ['46:13:4~7|I Corinthians 13:4-7']],
  ['1Cor 13', ['46:13|1Cor 13'], { threshold: 'normal' }],
  ['First John 4:8', ['62:4:8|First John 4:8']],
  ['3 John 4', ['64:1:4|3 John 4']],
  ['Song of Solomon 2:1', ['22:2:1|Song of Solomon 2:1']],
  ['See Song of Solomon 2:1', ['22:2:1|Song of Solomon 2:1']],
  ['Rom. 8:28', ['45:8:28|Rom. 8:28']],
  ['Rom 8:28', ['45:8:28|Rom 8:28']],
  ['Romans 8:28-30', ['45:8:28~30|Romans 8:28-30']],
  ['Romans 8:28–30', ['45:8:28~30|Romans 8:28–30']],
  ['John 3:16-4:2', ['43:3:16-4~2|John 3:16-4:2']],
  ['Genesis 1-3', ['1:1-3|Genesis 1-3']],
  ['Isaiah 53', ['23:53|Isaiah 53']],
  ['Psalm 23', ['19:23|Psalm 23']],
  ['Psalms 119:105', ['19:119:105|Psalms 119:105']],
  ['Ps 23', ['19:23|Ps 23']],
  ['Ps. 23:1', ['19:23:1|Ps. 23:1']],
  ['Luke 4', ['42:4|Luke 4']],
  ['Jude 5', ['65:1:5|Jude 5']],
  ['Jude 3-4', ['65:1:3~4|Jude 3-4']],
  ['Obadiah 1:3', ['31:1:3|Obadiah 1:3']],
  ['(Rom 3:23)', ['45:3:23|Rom 3:23']],
  ['Rom 3:23; 6:23, 25', ['45:3:23|Rom 3:23', '45:6:23|6:23', '45:6:25|25']],
  ['John 3:16, 18', ['43:3:16|John 3:16', '43:3:18|18']],
  ['John 3:16, 18-20', ['43:3:16|John 3:16', '43:3:18~20|18-20']],
  ['Matt 5:3, 5:8', ['40:5:3|Matt 5:3', '40:5:8|5:8']],
  ['John 3:16; 4', ['43:3:16|John 3:16', '43:4|4']],
  ['Matthew 5 John 3', ['40:5|Matthew 5', '43:3|John 3']],
  ['See John 3:16 and Rom 5:8.', ['43:3:16|John 3:16', '45:5:8|Rom 5:8']],
  ['Is 1:5', ['23:1:5|Is 1:5']],
  ['Isa 1:5', ['23:1:5|Isa 1:5']],
  ['Job 38:4', ['18:38:4|Job 38:4']],
  ['Mark 4:3', ['41:4:3|Mark 4:3']],
  ['Mark 4', ['41:4|Mark 4'], { threshold: 'loose' }],
  ['Acts 2:38', ['44:2:38|Acts 2:38']],
  ['Revelation 22:21', ['66:22:21|Revelation 22:21']],
  ['Rev 22:21', ['66:22:21|Rev 22:21']],
  ['“John 3:16”', ['43:3:16|John 3:16']],
  ['<b>x</b> Heb 11:1', ['58:11:1|Heb 11:1']],
  ['John 3:16', ['43:3:16|John 3:16']],
  ['JOHN 3:16', ['43:3:16|JOHN 3:16']],
  ['Dan 5:1', ['27:5:1|Dan 5:1']],
  ['Exodus 20:1-17 is the law', ['2:20:1~17|Exodus 20:1-17']],
  ['John 3:16 (ASV) says', ['43:3:16|John 3:16 (ASV)'], { translations: ['KJV', 'ASV'] }],
  ['John 3:16 ASV says', ['43:3:16|John 3:16 ASV'], { translations: ['KJV', 'ASV'] }],
];

const negative: [string, object?][] = [
  ['is 1'], ['Is 1'], ['I am 5 years old'], ['at 3 am'], ['so 2'], ['Job 5 applicants'], ['Mark 4'], ['Acts 2'], ['Numbers 13'],
  ['Judges 6'], ['Song 3'], ['go to page 5'], ['Chapter 3'], ['John'], ['II Corinthians'], ['Job'], ['I Corinthians'],
  ['2 Corinthians'], ['Genesis'], ['Revelation of John'], ['See Job.'], ['the book of Isaiah is long'], ['Isaiah and John'],
  ['John 200'], ['Genesis 51'], ['Psalm 151'], ['Romans 17'], ['John 3:1234'], ['Rom 5 km'], ['Rom 8 times'], ['Luke 4th'],
  ['Mark 3 km'], ['rom 8'], ['john 3'], ['Dan 5 people'], ['Ex 4'], ['Ps 23%'], ['john3:16abc'], ['3:16'], ['16'], ['Mar 5'],
  ['Mat 5'], ['Rev 22'], ['Gen 1'], ['In 2020 I read'], ['Matthew'], ['Version 2.0'], ['Rom'], ['pp. 5'],
];

describe('detect: positive cases', () => {
  for (const [text, want, opts] of positive) it(JSON.stringify(text), () => expect(fmt(text, opts)).toEqual(want));
});

describe('detect: never links a book name on its own, or a false positive', () => {
  for (const [text, opts] of negative) it(JSON.stringify(text), () => expect(fmt(text, opts)).toEqual([]));
});

describe('detect: thresholds', () => {
  it('strict drops chapter-only and ambiguous', () => {
    expect(fmt('Isaiah 53', { threshold: 'strict' })).toEqual([]);
    expect(fmt('Isaiah 53:5', { threshold: 'strict' })).toEqual(['23:53:5|Isaiah 53:5']);
    expect(fmt('Is 1:5', { threshold: 'strict' })).toEqual([]);
  });
  it('numeric threshold', () => {
    expect(fmt('Is 1', { threshold: 5 })).toEqual(['23:1|Is 1']);
  });
  it('requireVerse', () => {
    expect(fmt('Isaiah 53', { requireVerse: true })).toEqual([]);
  });
  it('lowercase is penalised, a cue helps', () => {
    expect(fmt('see rom 8:28')).toEqual(['45:8:28|rom 8:28']);
    expect(fmt('rom 8')).toEqual([]);
  });
  it('ignore list', () => {
    expect(fmt('Rom 8:28', { ignore: ['rom'] })).toEqual([]);
  });
  it('version suffix only when configured', () => {
    expect(fmt('John 3:16 ASV')).toEqual(['43:3:16|John 3:16']);
  });
  it('lowercase bare version suffix is not a version', () => {
    expect(fmt('John 3:16 asv', { translations: ['ASV'] })).toEqual(['43:3:16|John 3:16']);
  });
});

describe('detect: score is exposed', () => {
  it('Rom 8:28 scores 85+', () => {
    const r = createDetector(en, chapters).detect('Rom 8:28')[0];
    expect(r.score).toBeGreaterThanOrEqual(85);
  });
  it('continuations carry the parent score', () => {
    const r = createDetector(en, chapters).detect('Rom 3:23; 6:23');
    expect(r[1].score).toBe(r[0].score);
  });
});

describe('detect: ranges', () => {
  it('descending range links the first verse only', () => {
    expect(fmt('John 3:18-16')).toEqual(['43:3:18|John 3:18']);
  });
});

describe('detect: Spanish pack', () => {
  it('detects with accents', () => {
    expect(fmt('Lee Génesis 1:1 hoy', {}, es)).toEqual(['1:1:1|Génesis 1:1']);
    expect(fmt('Juan 3:16', {}, es)).toEqual(['43:3:16|Juan 3:16']);
    expect(fmt('1 Juan 4:8', {}, es)).toEqual(['62:4:8|1 Juan 4:8']);
  });
  it('book alone is never linked', () => {
    expect(fmt('Lee Juan hoy', {}, es)).toEqual([]);
  });
});

describe('detect: speed', () => {
  it('a 1 MB page of prose is scanned quickly', () => {
    const para = 'The committee met on 12 June and agreed 3 items, see page 45 and chapter 7. In 2020 Is 1 a prime? John 3:16 is famous. ';
    const text = para.repeat(Math.ceil(1_000_000 / para.length));
    const det = createDetector(en, chapters);
    const t = performance.now();
    const refs = det.detect(text);
    const ms = performance.now() - t;
    expect(refs.length).toBeGreaterThan(1000);
    expect(ms).toBeLessThan(3000);
  });
});
