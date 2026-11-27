import { describe, it, expect } from 'vitest';
import { noteHasContent } from './noteHasContent';

describe('noteHasContent', () => {
  it.each([
    '', '<p></p>', '<p><br></p>', '<p></p><p><br class="x"></p>', '<p>&nbsp;</p>', '<p> \n\t </p>',
    '<p>​</p>', '<!-- c --><p></p>', null, undefined,
  ])('is empty for %j', (c) => expect(noteHasContent(c)).toBe(false));

  it.each([
    '<p>x</p>', '<h1>Title</h1>', '<p><img src="a.png"></p>', '<table><tbody><tr><td></td></tr></tbody></table>',
    '<hr>', '<ul><li><p>item</p></li></ul>',
  ])('has content for %j', (c) => expect(noteHasContent(c)).toBe(true));

  it('reads TipTap JSON documents', () => {
    expect(noteHasContent({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe(false);
    expect(noteHasContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '  ' }] }] })).toBe(false);
    expect(noteHasContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] })).toBe(true);
    expect(noteHasContent({ type: 'doc', content: [{ type: 'image', attrs: { src: 'x' } }] })).toBe(true);
  });
});
