import { describe, it, expect } from 'vitest';
import { htmlToText, textToHtml } from './noteText';

describe('note text <-> html', () => {
  it('escapes and wraps one paragraph per line', () => {
    expect(textToHtml('a < b & "c"\n\nsecond')).toBe('<p>a &lt; b &amp; &quot;c&quot;</p><p></p><p>second</p>');
  });
  it('drops trailing blank lines', () => {
    expect(textToHtml('x\n\n')).toBe('<p>x</p>');
  });
  it('round-trips its own output', () => {
    const text = 'Line one & <two>\n\nThree';
    expect(htmlToText(textToHtml(text))).toBe(text);
  });
  it('flattens desktop html', () => {
    expect(htmlToText('<h2>Head</h2><p>One<br>two&nbsp;&amp; <b>bold</b></p>')).toBe('Head\nOne\ntwo & bold');
  });
});
