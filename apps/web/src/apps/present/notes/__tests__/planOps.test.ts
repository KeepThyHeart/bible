import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../../i18n', async () => {
  const books = (await import('../../../../locales/en/books.json')).default as Record<string, string>;
  return { default: { t: (key: string, opts?: { defaultValue?: string }) => books[key] ?? opts?.defaultValue ?? key } };
});

import { LIMITS } from '../../../../present/reducer';
import { docToBlocks } from '../editor/docToBlocks';
import { withBlockIds } from '../editor/blockIds';
import { docFromJSON, notesSchema as s, type ProseMirrorJSON } from '../editor/schema';
import { createNotesDetector } from '../detect';
import { addBoldLine, appendTextParagraph, derivePlanItems, deriveServerPlan, moveSection, planSegments, removeHighlightInDoc, samePlan, unlinkItemInDoc } from '../planOps';

const p = (text: string) => s.node('paragraph', { blockId: null }, text ? s.text(text) : undefined);

function build(...texts: string[]): ProseMirrorJSON {
  return withBlockIds(s.node('doc', null, texts.map(p)).toJSON());
}
function detect(json: ProseMirrorJSON) {
  return createNotesDetector().detect(docToBlocks({ doc: docFromJSON(json) }), { module: 'ESV', modules: ['ESV'] });
}
const texts = (json: ProseMirrorJSON) => docFromJSON(json).content.content.map((n) => n.textContent);

const DOC = () => build('Welcome', 'John 3:16', 'God so loved the world', 'Psalm 23', 'The Lord is my shepherd', 'Romans 8:28', 'Closing words');

describe('sections', () => {
  it('a section is an item block plus the prose after it; the leading prose stays put', () => {
    const doc = docFromJSON(DOC());
    const { leading, segments } = planSegments(doc, detect(DOC()).items);
    expect(leading).toBe(1);
    expect(segments.map((x) => [x.start, x.end])).toEqual([[1, 3], [3, 5], [5, 7]]);
  });

  it('moveSection moves the whole section down and up', () => {
    const json = DOC();
    const { items } = detect(json);
    expect(items).toHaveLength(3);
    const down = moveSection(json, items, items[0].id, 2)!;
    expect(texts(down)).toEqual(['Welcome', 'Psalm 23', 'The Lord is my shepherd', 'Romans 8:28', 'Closing words', 'John 3:16', 'God so loved the world']);
    const up = moveSection(json, items, items[2].id, 0)!;
    expect(texts(up)).toEqual(['Welcome', 'Romans 8:28', 'Closing words', 'John 3:16', 'God so loved the world', 'Psalm 23', 'The Lord is my shepherd']);
    // Item ids follow their blocks, so the plan order changes accordingly.
    expect(detect(up).items.map((i) => i.label)).toEqual(['Romans 8:28', 'John 3:16', 'Psalm 23']);
    expect(detect(up).items[0].id).toBe(items[2].id);
  });

  it('moveSection to the same place, or an unknown id, changes nothing', () => {
    const json = DOC();
    const { items } = detect(json);
    expect(moveSection(json, items, items[1].id, 1)).toBeNull();
    expect(moveSection(json, items, 'nope', 0)).toBeNull();
  });
});

describe('remove / undo', () => {
  it('unlinking keeps the text but the item stops being detected; the snapshot restores it', () => {
    const json = DOC();
    const { items } = detect(json);
    const after = unlinkItemInDoc(json, items[1]);
    expect(texts(after)).toEqual(texts(json));
    expect(detect(after).items.map((i) => i.label)).toEqual(['John 3:16', 'Romans 8:28']);
    // undo = restore the pre-remove snapshot
    expect(detect(json).items).toHaveLength(3);
  });
});

describe('plan derivation', () => {
  it('derives plan items in order and a server plan tagged with notesItemId', () => {
    const { items, highlights } = detect(DOC());
    const plan = derivePlanItems({ items, highlights, sections: [], needsChapters: [] });
    expect(plan.map((x) => x.label)).toEqual(['John 3:16', 'Psalm 23', 'Romans 8:28']);
    const server = deriveServerPlan(plan, []);
    expect(server.map((e) => e.notesItemId)).toEqual(plan.map((x) => x.id));
    expect(server.every((e) => e.id === '' && e.item)).toBe(true);
  });

  it('keeps server ids and notes for entries it already knows, skips unshowable items', () => {
    const { items } = detect(DOC());
    const plan = derivePlanItems({ items, highlights: [], sections: [], needsChapters: [] });
    const current = [{ id: 'srv1', item: plan[1].item!, note: 'sing', notesItemId: plan[1].id }];
    const server = deriveServerPlan([...plan, { ...plan[0], id: 'x', item: null }], current);
    expect(server).toHaveLength(3);
    expect(server[1]).toMatchObject({ id: 'srv1', note: 'sing' });
    expect(samePlan(server, server)).toBe(true);
    expect(samePlan(server, server.slice(1))).toBe(false);
  });
});

describe('plan limits', () => {
  const base = { label: 'x', status: 'ok' as const, highlights: [] };

  it('clips over-long text fields to the protocol limits', () => {
    const long = 'q'.repeat(LIMITS.quoteText + 500);
    const server = deriveServerPlan([
      { ...base, id: 'a', item: { kind: 'quote', text: long, attribution: 'z'.repeat(999) } },
      { ...base, id: 'b', item: { kind: 'text', body: long, title: 't'.repeat(999) } },
    ], []);
    const q = server[0].item as { text: string; attribution: string };
    expect(q.text).toHaveLength(LIMITS.quoteText);
    expect(q.attribution).toHaveLength(LIMITS.quoteAttribution);
    const t = server[1].item as { body: string; title: string };
    expect(t.body).toHaveLength(LIMITS.quoteText + 500 > LIMITS.textBody ? LIMITS.textBody : long.length);
    expect(t.title).toHaveLength(LIMITS.textTitle);
  });

  it('caps the entry count and drops items with no text left', () => {
    const many = Array.from({ length: LIMITS.planEntries + 20 }, (_, i) => ({
      ...base, id: `i${i}`, item: { kind: 'hymn' as const, hymnId: 'amazing-grace' },
    }));
    expect(deriveServerPlan(many, [])).toHaveLength(LIMITS.planEntries);
    expect(deriveServerPlan([{ ...base, id: 'e', item: { kind: 'quote', text: '   ' } }], [])).toEqual([]);
  });
});

describe('other doc edits', () => {
  it('adds a bold line after the item block, and appends a paragraph', () => {
    const json = DOC();
    const { items } = detect(json);
    const out = addBoldLine(json, items, items[0].id, 'so loved')!;
    expect(texts(out).slice(0, 4)).toEqual(['Welcome', 'John 3:16', 'so loved', 'God so loved the world']);
    expect(texts(appendTextParagraph(json, 'Quote: ')).at(-1)).toBe('Quote: ');
  });

  it('removes a bold phrase line, or just the phrase inside a longer paragraph', () => {
    const bold = (text: string) => s.text(text, [s.marks.bold.create()]);
    const json = withBlockIds(s.node('doc', null, [
      p('John 3:16'),
      s.node('paragraph', { blockId: null }, bold('so loved')),
      s.node('paragraph', { blockId: null }, [s.text('God '), bold('gave'), s.text(' his Son')]),
    ]).toJSON());
    const blocks = docToBlocks({ doc: docFromJSON(json) });
    const line = removeHighlightInDoc(json, { blockPos: blocks[1].pos, from: 0, to: 8 });
    expect(texts(line)).toEqual(['John 3:16', 'God gave his Son']);
    const inner = removeHighlightInDoc(json, { blockPos: blocks[2].pos, from: 4, to: 8 });
    expect(texts(inner)).toEqual(['John 3:16', 'so loved', 'God  his Son']);
  });
});
