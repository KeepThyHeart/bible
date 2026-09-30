import { describe, it, expect, beforeEach } from 'vitest';
import { selectionToHighlight } from '../selection';

/**
 * The same shape `PassageView`/`VerseText` render: a verse paragraph carrying
 * its id and number, a verse-number span, then one span per word whose text is
 * the word and (as a separate text node, as Preact renders it) its trailing
 * space.
 */
function renderPassage(verses: Array<{ id: number; num: number; words: string[] }>): HTMLElement {
  const root = document.createElement('div');
  for (const verse of verses) {
    const p = document.createElement('p');
    p.setAttribute('data-verse-id', String(verse.id));
    p.setAttribute('data-verse', String(verse.num));
    const num = document.createElement('span');
    num.className = 'pv-versenum';
    num.textContent = String(verse.num);
    p.appendChild(num);
    const text = document.createElement('span');
    verse.words.forEach((word, i) => {
      const w = document.createElement('span');
      w.setAttribute('data-word-index', String(i));
      w.appendChild(document.createTextNode(word));
      if (i < verse.words.length - 1) w.appendChild(document.createTextNode(' '));
      text.appendChild(w);
    });
    p.appendChild(text);
    root.appendChild(p);
  }
  document.body.appendChild(root);
  return root;
}

const JOHN = [
  { id: 43003016, num: 16, words: ['For', 'God', 'so', 'loved', 'the', 'world,'] },
  { id: 43003017, num: 17, words: ['For', 'God', 'sent', 'not', 'his', 'Son'] },
];

function word(root: HTMLElement, verseId: number, index: number): HTMLElement {
  return root.querySelector(`[data-verse-id="${verseId}"] [data-word-index="${index}"]`) as HTMLElement;
}

/** First text node of a word (the word itself), and its trailing-space node. */
function wordText(root: HTMLElement, verseId: number, index: number): Text {
  return word(root, verseId, index).firstChild as Text;
}
function spaceText(root: HTMLElement, verseId: number, index: number): Text {
  return word(root, verseId, index).lastChild as Text;
}

function range(startNode: Node, startOffset: number, endNode: Node, endOffset: number): Range {
  const r = document.createRange();
  r.setStart(startNode, startOffset);
  r.setEnd(endNode, endOffset);
  return r;
}

describe('selection to highlight range', () => {
  let root: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '';
    root = renderPassage(JOHN);
  });

  it('a collapsed selection is nothing', () => {
    const t = wordText(root, 43003016, 1);
    expect(selectionToHighlight(range(t, 1, t, 1), root)).toBeNull();
  });

  it('a selection inside one word is that word', () => {
    const t = wordText(root, 43003016, 3);
    expect(selectionToHighlight(range(t, 1, t, 3), root))
      .toEqual({ verseIdStart: 43003016, textStart: 3, textEnd: 3 });
  });

  it('snaps partial words at both ends out to whole words', () => {
    const r = range(wordText(root, 43003016, 1), 2, wordText(root, 43003016, 3), 1);
    expect(selectionToHighlight(r, root)).toEqual({ verseIdStart: 43003016, textStart: 1, textEnd: 3 });
  });

  it('a start in the trailing space after a word does not include that word', () => {
    const r = range(spaceText(root, 43003016, 1), 0, wordText(root, 43003016, 3), 5);
    expect(selectionToHighlight(r, root)).toEqual({ verseIdStart: 43003016, textStart: 2, textEnd: 3 });
  });

  it('an end exactly at the start of a word does not include that word', () => {
    const r = range(wordText(root, 43003016, 0), 0, wordText(root, 43003016, 2), 0);
    expect(selectionToHighlight(r, root)).toEqual({ verseIdStart: 43003016, textStart: 0, textEnd: 1 });
  });

  it('includes a word whose trailing space the selection ends in (browser double-click selection)', () => {
    const r = range(wordText(root, 43003016, 3), 0, spaceText(root, 43003016, 3), 1);
    expect(selectionToHighlight(r, root)).toEqual({ verseIdStart: 43003016, textStart: 3, textEnd: 3 });
  });

  it('spans verses, ignoring the verse number in between', () => {
    const r = range(wordText(root, 43003016, 4), 0, wordText(root, 43003017, 2), 2);
    expect(selectionToHighlight(r, root)).toEqual({
      verseIdStart: 43003016, textStart: 4, verseIdEnd: 43003017, textEnd: 2,
    });
  });

  it('element-boundary endpoints (a whole paragraph selected) map to its first and last words', () => {
    const p = root.querySelector('[data-verse-id="43003017"]')!;
    const r = range(p, 0, p, p.childNodes.length);
    expect(selectionToHighlight(r, root)).toEqual({ verseIdStart: 43003017, textStart: 0, textEnd: 5 });
  });

  it('a selection of only a verse number is nothing', () => {
    const num = root.querySelector('[data-verse-id="43003017"] .pv-versenum')!.firstChild!;
    expect(selectionToHighlight(range(num, 0, num, 2), root)).toBeNull();
  });

  it('a selection outside the passage is nothing', () => {
    const outside = document.createElement('p');
    outside.textContent = 'elsewhere';
    document.body.appendChild(outside);
    const t = outside.firstChild!;
    expect(selectionToHighlight(range(t, 0, t, 4), root)).toBeNull();
  });
});
