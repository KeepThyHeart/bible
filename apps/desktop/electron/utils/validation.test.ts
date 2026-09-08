import { describe, it, expect } from 'vitest';
import { HIGHLIGHT_COLOR_HEX, HIGHLIGHT_COLOR_NAMES } from '@bible/core';
import { validateAbbreviation, validateExternalUrl, validateMarkupColor } from './validation';

describe('validateExternalUrl', () => {
  it('accepts https URLs and returns them in canonical form', () => {
    expect(validateExternalUrl('https://example.org/docs')).toBe('https://example.org/docs');
    expect(validateExternalUrl('https://EXAMPLE.org')).toBe('https://example.org/');
  });

  it('accepts mailto targets, including the subject buildIssueReportUrl appends', () => {
    expect(validateExternalUrl('mailto:bugs@example.org')).toBe('mailto:bugs@example.org');
    expect(
      validateExternalUrl('mailto:bugs@example.org?subject=Bible%20Desktop%20App%3A%20Issue%20report')
    ).toBe('mailto:bugs@example.org?subject=Bible%20Desktop%20App%3A%20Issue%20report');
  });

  it('rejects plaintext http', () => {
    expect(() => validateExternalUrl('http://example.org')).toThrow(/scheme "http:" is not allowed/);
  });

  it('rejects schemes shell.openExternal would hand straight to the OS', () => {
    expect(() => validateExternalUrl('file:///C:/Windows/System32/calc.exe')).toThrow(
      /is not allowed/
    );
    expect(() => validateExternalUrl('smb://attacker.example/share')).toThrow(/is not allowed/);
    expect(() => validateExternalUrl('javascript:alert(1)')).toThrow(/is not allowed/);
    expect(() => validateExternalUrl('data:text/html,<script>alert(1)</script>')).toThrow(
      /is not allowed/
    );
    expect(() => validateExternalUrl('ms-msdt:/id')).toThrow(/is not allowed/);
  });

  it('rejects strings that are not well-formed URLs', () => {
    expect(() => validateExternalUrl('example.org')).toThrow(/not a well-formed URL/);
    expect(() => validateExternalUrl('//example.org')).toThrow(/not a well-formed URL/);
  });

  it('is not fooled by leading whitespace or scheme-ish prefixes', () => {
    // `URL` trims control characters, so the parsed scheme is what matters -
    // a prefix check on the raw string would have accepted these.
    expect(() => validateExternalUrl('\thttp://example.org')).toThrow(/is not allowed/);
    expect(() => validateExternalUrl('  file:///etc/passwd')).toThrow(/is not allowed/);
    expect(() => validateExternalUrl('httpsx://example.org')).toThrow(/is not allowed/);
  });

  it('rejects non-strings, empty strings and absurdly long strings', () => {
    expect(() => validateExternalUrl(undefined)).toThrow(/must be a non-empty string/);
    expect(() => validateExternalUrl(null)).toThrow(/must be a non-empty string/);
    expect(() => validateExternalUrl(42)).toThrow(/must be a non-empty string/);
    expect(() => validateExternalUrl('')).toThrow(/must be a non-empty string/);
    expect(() => validateExternalUrl(`https://example.org/${'a'.repeat(3000)}`)).toThrow(
      /must be a non-empty string/
    );
  });

  it('names the offending field', () => {
    expect(() => validateExternalUrl('ftp://example.org', 'issue report URL')).toThrow(
      /Invalid issue report URL/
    );
  });
});

describe('validateMarkupColor', () => {
  it('accepts every palette name and resolves it to canonical hex', () => {
    for (const name of HIGHLIGHT_COLOR_NAMES) {
      expect(validateMarkupColor(name)).toBe(HIGHLIGHT_COLOR_HEX[name].toUpperCase());
    }
  });

  it('accepts canonical hex and upper-cases it', () => {
    expect(validateMarkupColor('#aabbcc')).toBe('#AABBCC');
    expect(validateMarkupColor('#AABBCC')).toBe('#AABBCC');
  });

  it('accepts short hex and expands it', () => {
    expect(validateMarkupColor('#abc')).toBe('#AABBCC');
  });

  it('accepts a custom colour outside the six-swatch palette', () => {
    expect(validateMarkupColor('#123456')).toBe('#123456');
  });

  it('rejects an unrecognised colour string instead of defaulting to yellow', () => {
    expect(() => validateMarkupColor('chartreuse')).toThrow(/Invalid markup color/);
    expect(() => validateMarkupColor('')).toThrow(/Invalid markup color/);
    expect(() => validateMarkupColor('#12345')).toThrow(/Invalid markup color/);
    expect(() => validateMarkupColor('yellow; DROP TABLE user_text_markup')).toThrow(
      /Invalid markup color/
    );
  });

  it('rejects non-string input', () => {
    expect(() => validateMarkupColor(undefined)).toThrow(/Invalid markup color/);
    expect(() => validateMarkupColor(null)).toThrow(/Invalid markup color/);
    expect(() => validateMarkupColor(42)).toThrow(/Invalid markup color/);
    expect(() => validateMarkupColor({ color: 'yellow' })).toThrow(/Invalid markup color/);
  });

  it('names the offending field and lists the accepted palette', () => {
    expect(() => validateMarkupColor('nope', 'underline color')).toThrow(
      /Invalid underline color: expected "#RRGGBB" hex or one of yellow, green, blue, red, purple, orange/
    );
  });
});

// ---------------------------------------------------------------------------
// An abbreviation is module data, not an identifier this app mints - it is
// whatever the publisher wrote into the module's `module_info` row. The old
// `^[A-Za-z0-9_-]{1,30}$` rule assumed otherwise and made every shipped module
// whose abbreviation held a space (`Webster 1828`) unusable.
// ---------------------------------------------------------------------------
describe('validateAbbreviation', () => {
  it('accepts the plain identifiers most modules use', () => {
    expect(validateAbbreviation('kjv')).toBe('kjv');
    expect(validateAbbreviation('StrongsGreek')).toBe('StrongsGreek');
    expect(validateAbbreviation('BDBGlosses_Strongs')).toBe('BDBGlosses_Strongs');
    expect(validateAbbreviation('webster-1913')).toBe('webster-1913');
  });

  it('accepts the punctuation real publishers actually use', () => {
    // The shipped dictionary set contains this one verbatim; rejecting it was
    // the reported bug.
    expect(validateAbbreviation('Webster 1828')).toBe('Webster 1828');
    expect(validateAbbreviation('R.A. Torrey')).toBe('R.A. Torrey');
    expect(validateAbbreviation("Easton's")).toBe("Easton's");
    expect(validateAbbreviation('Nave (Topical)')).toBe('Nave (Topical)');
    expect(validateAbbreviation('Синодальный')).toBe('Синодальный');
  });

  it('rejects anything path-shaped', () => {
    expect(() => validateAbbreviation('../../etc/passwd')).toThrow(/not a valid module name/);
    expect(() => validateAbbreviation('modules\bible_kjv')).toThrow(/not a valid module name/);
    expect(() => validateAbbreviation('a/b')).toThrow(/not a valid module name/);
    expect(() => validateAbbreviation('C:kjv')).toThrow(/not a valid module name/);
  });

  it('rejects control characters, empty and whitespace-only values, and non-strings', () => {
    expect(() => validateAbbreviation('kjv\x00')).toThrow(/not a valid module name/);
    expect(() => validateAbbreviation('')).toThrow(/not a valid module name/);
    expect(() => validateAbbreviation('   ')).toThrow(/not a valid module name/);
    expect(() => validateAbbreviation(42)).toThrow(/not a valid module name/);
    expect(() => validateAbbreviation(undefined)).toThrow(/not a valid module name/);
  });

  it('rejects a value longer than any real abbreviation', () => {
    expect(() => validateAbbreviation('a'.repeat(65))).toThrow(/not a valid module name/);
    expect(validateAbbreviation('a'.repeat(64))).toHaveLength(64);
  });

  it('classifies the failure so it is logged as a warning, not a crash', () => {
    // The renderer branches on `error.code`; a bare Error would arrive as
    // `internal` with a stack trace in the log.
    expect(() => validateAbbreviation('a/b')).toThrow(
      expect.objectContaining({ name: 'IpcKnownError', code: 'invalid_input' }) as Error
    );
  });
});
