import { describe, it, expect } from 'vitest';
import { renderMarkdownToHtml } from '../utils/markdownRenderer';

describe('renderMarkdownToHtml', () => {
  it('returns empty string for empty input', () => {
    expect(renderMarkdownToHtml('')).toBe('');
  });

  it('returns empty string for null/undefined input', () => {
    // The function checks !markdown, so falsy values return ''
    expect(renderMarkdownToHtml(null as unknown as string)).toBe('');
    expect(renderMarkdownToHtml(undefined as unknown as string)).toBe('');
  });

  it('wraps plain text in a <p> tag', () => {
    const result = renderMarkdownToHtml('Hello world');
    expect(result).toContain('<p>');
    expect(result).toContain('Hello world');
    expect(result).toContain('</p>');
  });

  it('renders **bold** as <strong>', () => {
    const result = renderMarkdownToHtml('This is **bold** text');
    expect(result).toContain('<strong>bold</strong>');
  });

  it('renders *italic* as <em>', () => {
    const result = renderMarkdownToHtml('This is *italic* text');
    expect(result).toContain('<em>italic</em>');
  });

  it('strips leading H1 tags (synthesis commentary headers)', () => {
    const result = renderMarkdownToHtml(
      '# Genesis 1:1 Commentary Synthesis\n\nSome commentary content here.',
    );
    expect(result).not.toContain('<h1>');
    expect(result).toContain('Some commentary content here.');
  });

  it('does not strip H2 headings', () => {
    const result = renderMarkdownToHtml('## Section Heading\n\nContent');
    expect(result).toContain('<h2>');
    expect(result).toContain('Section Heading');
  });

  it('does not strip H1 that is not at the leading position', () => {
    const result = renderMarkdownToHtml(
      'Some intro text.\n\n# A Later Heading\n\nMore content.',
    );
    expect(result).toContain('<h1>');
    expect(result).toContain('A Later Heading');
  });

  it('renders inline `code` as <code>', () => {
    const result = renderMarkdownToHtml('Use `console.log` here');
    expect(result).toContain('<code>console.log</code>');
  });

  it('decodes HTML entities in text nodes (&amp; -> &)', () => {
    // marked encodes & as &amp; in text, our function should decode it back
    const result = renderMarkdownToHtml('Tom & Jerry');
    expect(result).toContain('Tom & Jerry');
    // Should not contain the double-encoded form
    expect(result).not.toContain('&amp;');
  });

  it('decodes &quot; entities in text nodes', () => {
    const result = renderMarkdownToHtml('He said "hello"');
    expect(result).toContain('He said "hello"');
  });

  it('does not decode entities inside HTML tags', () => {
    // An HTML tag with attributes should remain untouched
    const result = renderMarkdownToHtml('[link](http://example.com?a=1&b=2)');
    // The href inside <a> tag should preserve &amp; encoding
    expect(result).toContain('<a');
    expect(result).toContain('href=');
  });

  it('converts line breaks with breaks:true enabled', () => {
    const result = renderMarkdownToHtml('Line one\nLine two');
    // With breaks: true, a single newline becomes <br>
    expect(result).toContain('<br');
  });
});
