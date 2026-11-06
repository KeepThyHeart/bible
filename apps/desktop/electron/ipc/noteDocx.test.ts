import { describe, it, expect } from 'vitest';
import { buildNoteDocx, decodeEntities } from './noteDocx';
import { createRequire } from 'node:module';

// jszip is docx's own dependency; resolve it through docx rather than adding a package.
const requireFromDocx = createRequire(createRequire(import.meta.url).resolve('docx'));
const JSZip = requireFromDocx('jszip');

async function docXml(html: string): Promise<string> {
  const buf = await buildNoteDocx(html, 'My Note');
  const zip = await JSZip.loadAsync(buf);
  return zip.file('word/document.xml')!.async('string');
}
const textOf = (xml: string) => [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]).join('|').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const SAMPLE =
  '<h1>Heading</h1><p>Plain <strong>bold</strong> <em>ital</em> <u>under</u> <s>strike</s> ' +
  '<span data-verse-ref="John 3:16" class="verse-ref">John 3:16</span> &amp; &lt;tag&gt; ' +
  '<a href="https://example.com/x">a link</a></p>' +
  '<ul><li><p>one</p><ul><li><p>nested</p></li></ul></li></ul>' +
  '<ol><li><p>first</p></li></ol><blockquote><p>quoted</p></blockquote><hr><p>    indented</p>';

describe('buildNoteDocx', () => {
  it('emits real Word formatting and no HTML in text runs', async () => {
    const xml = await docXml(SAMPLE);
    const text = textOf(xml);
    expect(text.replace('<tag>', '')).not.toMatch(/<\/?[a-z]/i);
    expect(text).not.toContain('data-verse-ref');
    expect(text).toContain('John 3:16');
    expect(text).toContain('& <tag>');
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:i/>');
    expect(xml).toContain('<w:u ');
    expect(xml).toContain('<w:strike/>');
    expect(xml).toContain('<w:hyperlink');
    expect(xml).toContain('w:val="Heading1"');
    expect(xml).toMatch(/<w:ilvl w:val="1"\/>/);
    expect(xml).toContain('<w:numId');
    expect(xml).toMatch(/<w:ind w:left="720"/);
    expect(text).toContain('indented');
    expect(text).not.toContain('    indented');
  });

  it('decodes entities', () => {
    expect(decodeEntities('a&nbsp;b &#65;&#x42; &mdash;')).toBe('a b AB —');
  });
});
