import { describe, expect, it } from 'vitest';
import { EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { buildInputRules } from './plugins';
import { docToBlocks } from './docToBlocks';
import { docFromJSON, emptyDocJSON, notesSchema as s, parseHtml } from './schema';

const stateOf = (html: string) => EditorState.create({ doc: parseHtml(html) });

describe('paste sanitizing', () => {
  it('keeps supported structure and marks', () => {
    const doc = parseHtml('<h1>Title</h1><p>a <strong>b</strong> <em>c</em></p><ul><li>x</li></ul><blockquote><p>q</p></blockquote>');
    expect(doc.child(0).type.name).toBe('heading');
    expect(doc.child(1).child(1).marks[0].type.name).toBe('bold');
    expect(doc.child(2).type.name).toBe('bullet_list');
    expect(doc.child(3).type.name).toBe('blockquote');
  });

  it('clamps deep headings to level 2', () => {
    expect(parseHtml('<h4>x</h4>').child(0).attrs.level).toBe(2);
  });

  it('treats the Google Docs <b font-weight:normal> wrapper as not bold', () => {
    const doc = parseHtml('<b style="font-weight:normal" id="docs-internal-guid-1"><p>plain</p></b>');
    expect(doc.textContent).toBe('plain');
    expect(doc.rangeHasMark(0, doc.content.size, s.marks.bold)).toBe(false);
  });

  it('reads Word-style bold spans and drops styling/scripts', () => {
    const doc = parseHtml('<p><span style="font-weight:700;color:red">hot</span><script>alert(1)</script></p>');
    expect(doc.rangeHasMark(0, doc.content.size, s.marks.bold)).toBe(true);
    expect(doc.textContent).not.toContain('alert');
  });

  it('rejects javascript: links', () => {
    const doc = parseHtml('<p><a href="javascript:alert(1)">x</a> <a href="https://a.b">y</a></p>');
    let hrefs: string[] = [];
    doc.descendants((n) => {
      n.marks.forEach((m) => m.type.name === 'link' && hrefs.push(m.attrs.href));
    });
    expect(hrefs).toEqual(['https://a.b']);
  });

  it('flattens tables to text paragraphs', () => {
    expect(parseHtml('<table><tr><td>cell</td></tr></table>').textContent).toBe('cell');
  });
});

describe('doc JSON', () => {
  it('round-trips and falls back to empty on garbage', () => {
    const json = parseHtml('<p>hi</p>').toJSON();
    expect(docFromJSON(json).textContent).toBe('hi');
    expect(docFromJSON({ type: 'nope' }).childCount).toBe(1);
    expect(docFromJSON(null).textContent).toBe('');
    expect(docFromJSON(emptyDocJSON()).childCount).toBe(1);
  });

  it('round-trips pin attrs', () => {
    const pinned = s.text('Amazing Grace', [s.marks.pin.create({ choice: { hymn: 12 } })]);
    const doc = s.node('doc', null, s.node('paragraph', null, pinned));
    const back = docFromJSON(doc.toJSON());
    expect(back.firstChild!.firstChild!.marks[0].attrs.choice).toEqual({ hymn: 12 });
  });
});

describe('docToBlocks', () => {
  it('reports kind, position and text per textblock', () => {
    const blocks = docToBlocks(stateOf('<h2>Head</h2><p>para</p><ul><li>item</li></ul><blockquote><p>quote</p></blockquote>'));
    expect(blocks.map((b) => [b.kind, b.text])).toEqual([
      ['heading', 'Head'],
      ['paragraph', 'para'],
      ['listItem', 'item'],
      ['blockquote', 'quote'],
    ]);
    expect(blocks[0].pos).toBe(0);
    expect(blocks[1].pos).toBe(6);
  });

  it('gives mark offsets within the block, merging adjacent text nodes', () => {
    const [b] = docToBlocks(stateOf('<p>John 3:16 says <strong>believeth</strong> and <strong>life</strong><em>!</em></p>'));
    expect(b.text).toBe('John 3:16 says believeth and life!');
    expect(b.marks).toEqual([
      { from: 15, to: 24, type: 'bold' },
      { from: 29, to: 33, type: 'bold' },
    ]);
  });

  it('counts a hard break as one character and carries pin attrs', () => {
    const doc = s.node('doc', null, s.node('paragraph', null, [
      s.text('a'),
      s.node('hard_break'),
      s.text('b', [s.marks.pin.create({ choice: 'x' }), s.marks.unlink.create()]),
    ]));
    const [b] = docToBlocks({ doc });
    expect(b.text).toBe('a\nb');
    expect(b.marks).toEqual([
      { from: 2, to: 3, type: 'pin', attrs: 'x' },
      { from: 2, to: 3, type: 'unlink' },
    ]);
  });
});

describe('markdown mark input rules', () => {
  // Types `text` one character at a time through the input-rules plugin, as the view would.
  function type(text: string): EditorState {
    const plugin = buildInputRules();
    let state = EditorState.create({ doc: parseHtml('<p></p>'), plugins: [plugin] });
    for (const ch of text) {
      const { from, to } = state.selection;
      const view = { state, dispatch: (tr: Transaction) => { state = state.apply(tr); } } as unknown as EditorView;
      const handled = (plugin.props.handleTextInput as (v: EditorView, f: number, t: number, s: string) => boolean)(view, from, to, ch);
      if (!handled) state = state.apply(state.tr.insertText(ch, from, to));
    }
    return state;
  }

  it('turns **word** into bold and drops the asterisks', () => {
    const state = type('say **key** now');
    expect(state.doc.textContent).toBe('say key now');
    let boldText = '';
    state.doc.descendants((n) => { if (n.marks.some((m) => m.type.name === 'bold')) boldText += n.text; });
    expect(boldText).toBe('key');
  });

  it('turns *word* into italic', () => {
    const state = type('a *b* c');
    expect(state.doc.textContent).toBe('a b c');
    expect(state.doc.rangeHasMark(3, 4, s.marks.italic)).toBe(true);
  });
});
