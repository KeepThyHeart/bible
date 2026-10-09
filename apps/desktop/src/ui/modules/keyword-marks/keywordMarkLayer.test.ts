import { describe, it, expect } from 'vitest';
import { BUILT_IN_KEYWORD_SETS, type KeywordSet } from '@bible/core/browser';
import {
  DEFAULT_TAB_STATE,
  buildChapterInput,
  chapterIdOf,
  computeChapterMarks,
  legendRowsFor,
  resolveActiveSetIds,
} from './keywordMarkLayer';
import { appendLayers, interlinearToSpans, splitLayerByVerse } from '../../extensions/chapterLayers';

const V1 = 43003016;
const V2 = 43003017;
const verses = [
  { verse_id: V1, text_html: 'For God so loved the world' },
  { verse_id: V2, text: 'For God sent not his Son. God loved.' },
];

const userSet: KeywordSet = {
  schema: 1, id: 'set-1', name: 'Mine', scope: { kind: 'everywhere' }, updatedAt: '2026-01-01T00:00:00.000Z',
  marks: [{ id: 'm-god', label: 'God', rule: { kind: 'word', forms: ['god'] }, style: { color: 'mark.1', line: 'solid' }, enabled: true }],
};

describe('buildChapterInput', () => {
  it('tokenises text_html, falling back to text', () => {
    const input = buildChapterInput(7, 'en', verses);
    expect(input.moduleId).toBe(7);
    expect(input.verses[0].words.map((w) => w.text)).toEqual(['For', 'God', 'so', 'loved', 'the', 'world']);
    expect(input.verses[1].words[0].text).toBe('For');
    expect(input.interlinear).toBeUndefined();
  });
});

describe('interlinearToSpans', () => {
  it('flattens a per-verse map', () => {
    const spans = interlinearToSpans({ [String(V1)]: [{ wordPositionStart: 3, wordPositionEnd: 3, strongsNumber: 'G25' }] });
    expect(spans).toEqual([{ verseId: V1, start: 3, end: 3, strongs: 'G25' }]);
    expect(interlinearToSpans(undefined)).toEqual([]);
  });
});

describe('resolveActiveSetIds', () => {
  const all = [...BUILT_IN_KEYWORD_SETS, userSet];
  it('defaults to the language connectives set plus every user set', () => {
    expect(resolveActiveSetIds(all, DEFAULT_TAB_STATE, 'en-US')).toEqual(['builtin:connectives-en', 'set-1']);
    expect(resolveActiveSetIds(all, DEFAULT_TAB_STATE, 'es')).toEqual(['builtin:connectives-es', 'set-1']);
  });
  it('honours an explicit list, dropping ids that no longer exist', () => {
    expect(resolveActiveSetIds(all, { ...DEFAULT_TAB_STATE, activeSetIds: ['set-1', 'gone'] }, 'en')).toEqual(['set-1']);
  });
});

describe('computeChapterMarks / splitLayerByVerse', () => {
  const input = buildChapterInput(7, 'en', verses);
  const opts = { colorSafe: true, hiddenMarkIds: [] as string[] };

  it('produces per-verse layers that only target their own verse', () => {
    const marks = computeChapterMarks(input, [userSet], opts);
    expect(marks.result.counts.get('m-god')?.hits).toBe(3);
    expect([...marks.verseLayers.keys()].sort()).toEqual([V1, V2]);
    for (const [verseId, layers] of marks.verseLayers) {
      for (const d of layers[0].decorations) {
        const targets = Array.isArray(d.target) ? d.target : [d.target];
        expect(targets.every((t) => t.kind === 'tokens' && t.verseId === verseId)).toBe(true);
      }
    }
  });

  it('drops hidden marks from the layers but keeps them in the legend', () => {
    const marks = computeChapterMarks(input, [userSet], { ...opts, hiddenMarkIds: ['m-god'] });
    expect(marks.verseLayers.size).toBe(0);
    expect(legendRowsFor(marks, ['m-god'])).toMatchObject([{ markId: 'm-god', hits: 3, verseCount: 2, hidden: true }]);
  });

  it('flags connectives as wanting interlinear rows', () => {
    const marks = computeChapterMarks(input, [BUILT_IN_KEYWORD_SETS[0]], opts);
    expect(marks.result.wantsInterlinear).toBe(true);
  });

  it('splitLayerByVerse returns an empty map for an empty layer', () => {
    expect(splitLayerByVerse({ layerKey: 'core::keywords', extensionId: 'core', layerSeq: 0, surfaces: ['standard'], decorations: [] }).size).toBe(0);
  });
});

describe('legendRowsFor', () => {
  it('lists enabled marks of language-matching sets, zero hits included', () => {
    const input = buildChapterInput(7, 'en', [{ verse_id: V1, text: 'nothing here' }]);
    const marks = computeChapterMarks(input, [userSet, BUILT_IN_KEYWORD_SETS[1]], { colorSafe: true, hiddenMarkIds: [] });
    const rows = legendRowsFor(marks, []);
    expect(rows.map((r) => r.markId)).toEqual(['m-god']); // the Spanish set is skipped for an English chapter
    expect(rows[0].hits).toBe(0);
  });
});

describe('helpers', () => {
  it('chapterIdOf', () => expect(chapterIdOf(V1)).toBe('43.3'));
  it('appendLayers keeps the base reference when there is nothing to add', () => {
    const base = [] as never[];
    expect(appendLayers(base, undefined)).toBe(base);
    expect(appendLayers(base, [])).toBe(base);
  });
});
