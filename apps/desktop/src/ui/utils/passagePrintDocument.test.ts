import { describe, it, expect } from 'vitest';
import { buildPassagePrintDocument, passageFileName, textToPrintBody } from './passagePrintDocument';

describe('buildPassagePrintDocument', () => {
  it('carries a CSP, forces black text and strips scripts from the body', () => {
    const html = buildPassagePrintDocument('John 3:16', '<blockquote>For God<script>alert(1)</script></blockquote>');
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("script-src 'none'");
    expect(html).toContain('color: #000 !important');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('<h1>John 3:16</h1>');
  });

  it('escapes the title and honours the text direction', () => {
    const html = buildPassagePrintDocument('<b>x</b>', '<p>y</p>', 'rtl');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('dir="rtl"');
  });

  it('turns plain text into paragraphs and line breaks', () => {
    expect(textToPrintBody('a\nb\n\nc & d')).toBe('<p>a<br>b</p><p>c &amp; d</p>');
  });
});

describe('passageFileName', () => {
  it('turns a reference into a file name', () => {
    expect(passageFileName('John 3:16', 'KJV')).toBe('John 3-16 KJV');
    expect(passageFileName('John 3:16-18', 'KJV')).toBe('John 3-16-18 KJV');
    expect(passageFileName('1 Cor 13:4–7', 'ESV')).toBe('1 Cor 13-4–7 ESV');
  });

  it('drops characters a file system rejects and never comes back empty', () => {
    expect(passageFileName('A/B?<x>', 'K*J')).toBe('ABx KJ');
    expect(passageFileName('', '')).toBe('Passage');
  });

  it('uses the file name as the document title when given', () => {
    const html = buildPassagePrintDocument('John 3:16 (KJV)', '<p>x</p>', 'ltr', 'John 3-16 KJV');
    expect(html).toContain('<title>John 3-16 KJV</title>');
    expect(html).toContain('<h1>John 3:16 (KJV)</h1>');
  });
});
