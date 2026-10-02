import { describe, it, expect } from 'vitest';
import { gatherPassageFacts, stripFactsHtml } from './passageFacts';

const r = { startVerseId: 43003016, endVerseId: 43003016 };

describe('stripFactsHtml', () => {
  it('removes tags, keeps inline joins, decodes entities', () => {
    expect(stripFactsHtml('<p>For the <span class="divine-name">LORD</span>&rsquo;s &amp; his<br>house&nbsp;now</p>'))
      .toBe('For the LORD&rsquo;s & his house now');
  });
});

describe('gatherPassageFacts', () => {
  it('uses sync and async readers, dedupes', async () => {
    const f = await gatherPassageFacts(r, {
      language: 'en',
      text: async () => '<p>For God so <i>loved</i> the world</p>',
      interlinear: () => [
        { strongs: 'G25', lemma: 'agapao', gloss: 'love' },
        { strongs: 'G25' },
        { strongs: null },
        { strongs: ' G2316 ' },
      ],
      topics: async () => [
        { label: 'Love', source: 'naves' },
        { label: 'love', source: 'naves' },
        { label: 'Love', source: 'torrey' },
      ],
    });
    expect(f.text).toBe('For God so loved the world');
    expect(f.strongs).toEqual([{ strongs: 'G25', lemma: 'agapao', gloss: 'love' }, { strongs: 'G2316' }]);
    expect(f.topics).toEqual([{ label: 'Love', source: 'naves' }, { label: 'Love', source: 'torrey' }]);
    expect(f.language).toBe('en');
    expect(f.range).toEqual(r);
  });

  it('works with only text', async () => {
    const f = await gatherPassageFacts(r, { language: 'es', text: () => 'hola' });
    expect(f).toEqual({ range: r, language: 'es', text: 'hola', strongs: [], topics: [] });
  });
});
