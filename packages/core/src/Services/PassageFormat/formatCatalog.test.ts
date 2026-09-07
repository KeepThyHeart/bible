/**
 * The one numbered format list every passage dialog reads.
 *
 * What matters here is not that the numbers exist but that they are *the
 * same* numbers everywhere and that they do not move: a user learns "3 is
 * inline quote", and a shortcut that renumbers itself when the registry
 * changes is worse than none.
 *
 * The list went from seven entries to five - "Standard" and "Combined" were
 * restatements of "Numbered quote" and "Inline quote" in a weaker engine - but
 * both still *resolve*, because notes on disk carry `standard` in their
 * expansion mark and the export utility renders through the clipboard registry.
 * The tests below pin both halves of that: retired formats never appear in the
 * offered list (including through the "append anything the registry has that
 * the order does not" path, which is exactly how they would sneak back in as
 * #6 and #7), and they still resolve on request.
 */
import { describe, it, expect } from 'vitest';
import {
  PASSAGE_FORMAT_ORDER,
  DEFAULT_PASSAGE_FORMAT_ID,
  LEGACY_PASSAGE_FORMAT_IDS,
  MAX_FORMAT_SHORTCUT,
  isLegacyPassageFormat,
  remapLegacyFormatId,
  getPassageFormatCatalog,
  getPassageFormatEntry,
  getPassageFormatNumber,
  getPassageFormatByNumber,
  resolveFormatShortcut,
} from './formatCatalog';
import { getAllFormats } from './formatRegistry';

describe('the passage format catalog', () => {
  it('offers five formats: the quotation shapes, then the template', () => {
    expect(getPassageFormatCatalog().map(e => e.id)).toEqual([
      'blockquote',
      'blockquote-numbered',
      'inline-quote',
      'heading-per-verse',
      'template',
    ]);
  });

  it('numbers them 1..n in that order', () => {
    expect(getPassageFormatCatalog().map(e => e.number)).toEqual([1, 2, 3, 4, 5]);
  });

  it('opens on the block quote when nothing has been chosen before', () => {
    expect(DEFAULT_PASSAGE_FORMAT_ID).toBe('blockquote');
    expect(PASSAGE_FORMAT_ORDER[0]).toBe(DEFAULT_PASSAGE_FORMAT_ID);
  });

  // The whole point of the catalog: "2" names one shape, whichever dialog the
  // user typed it into.
  it('gives one id exactly one number, whichever way it is looked up', () => {
    for (const entry of getPassageFormatCatalog()) {
      expect(getPassageFormatNumber(entry.id)).toBe(entry.number);
      expect(getPassageFormatByNumber(entry.number)?.id).toBe(entry.id);
    }
  });

  it('tags each entry with the engine that renders it', () => {
    const byId = new Map(getPassageFormatCatalog().map(e => [e.id, e.family]));
    expect(byId.get('blockquote')).toBe('markup');
    expect(byId.get('heading-per-verse')).toBe('markup');
    expect(byId.get('template')).toBe('clipboard');
  });

  // Numbers come from the declared order, not from the position of a resolved
  // entry - so a format that stopped resolving would drop out without shifting
  // the ones after it.
  it('takes each number from the declared order', () => {
    for (const entry of getPassageFormatCatalog()) {
      expect(entry.number).toBe(PASSAGE_FORMAT_ORDER.indexOf(entry.id) + 1);
    }
  });

  it('points every entry at an i18n key for its family', () => {
    for (const entry of getPassageFormatCatalog()) {
      expect(entry.labelKey).toBe(
        entry.family === 'markup'
          ? `ui.passageInsert.format.${entry.id}`
          : `copyOptionsDialog.format.${entry.id}`,
      );
      expect(entry.name).not.toBe('');
      expect(entry.description).not.toBe('');
    }
  });

  it('has no unknown id and no number outside the list', () => {
    expect(getPassageFormatEntry('no-such-format')).toBeUndefined();
    expect(getPassageFormatNumber('no-such-format')).toBeUndefined();
    expect(getPassageFormatByNumber(0)).toBeUndefined();
    expect(getPassageFormatByNumber(99)).toBeUndefined();
  });

  describe('the retired formats', () => {
    it('names Standard and Combined, and they are still registered', () => {
      expect([...LEGACY_PASSAGE_FORMAT_IDS]).toEqual(['standard', 'combined']);
      const registered = getAllFormats().map(f => f.id);
      for (const id of LEGACY_PASSAGE_FORMAT_IDS) {
        expect(registered).toContain(id);
        expect(isLegacyPassageFormat(id)).toBe(true);
      }
    });

    // The regression this exists to stop: the catalog *appends* any registry
    // format the declared order does not mention, so simply dropping the two
    // ids from the order would have brought them back as #6 and #7.
    it('never appears in the offered list', () => {
      const offered = getPassageFormatCatalog().map(e => e.id);
      for (const id of LEGACY_PASSAGE_FORMAT_IDS) {
        expect(offered).not.toContain(id);
      }
      expect(offered).toHaveLength(PASSAGE_FORMAT_ORDER.length);
    });

    it('has no digit shortcut and no number', () => {
      for (const id of LEGACY_PASSAGE_FORMAT_IDS) {
        expect(getPassageFormatNumber(id)).toBeUndefined();
      }
      for (const key of ['1', '2', '3', '4', '5']) {
        expect(LEGACY_PASSAGE_FORMAT_IDS).not.toContain(resolveFormatShortcut(key)?.id);
      }
    });

    // A note written before the list was cut carries `standard`, and
    // re-formatting it has to be able to show what it currently is.
    it('is included on request, last, marked, and unnumbered', () => {
      const entries = getPassageFormatCatalog({ includeIds: ['standard'] });
      expect(entries.map(e => e.id)).toEqual([...PASSAGE_FORMAT_ORDER, 'standard']);
      const legacy = entries[entries.length - 1];
      expect(legacy.legacy).toBe(true);
      expect(legacy.number).toBe(0);
      // Numbering of the offered formats is untouched by the extra entry.
      expect(entries.slice(0, 5).map(e => e.number)).toEqual([1, 2, 3, 4, 5]);
    });

    it('ignores an includeIds entry that is not retired', () => {
      expect(getPassageFormatCatalog({ includeIds: ['blockquote', 'nope'] }).map(e => e.id)).toEqual(
        [...PASSAGE_FORMAT_ORDER],
      );
    });

    // A lookup is not an offer: everything validating a stored or note-borne
    // id needs the retired ones to resolve, or a saved note becomes unopenable.
    it('still resolves by id', () => {
      for (const id of LEGACY_PASSAGE_FORMAT_IDS) {
        expect(getPassageFormatEntry(id)?.id).toBe(id);
      }
    });

    // Closest surviving shape, so a stored preference lands somewhere
    // recognisable rather than on whatever happens to be first.
    it('remaps onto the shape it was a restatement of', () => {
      expect(remapLegacyFormatId('standard')).toBe('blockquote-numbered');
      expect(remapLegacyFormatId('combined')).toBe('inline-quote');
      expect(remapLegacyFormatId('blockquote')).toBe('blockquote');
      expect(remapLegacyFormatId('no-such-format')).toBe('no-such-format');
    });
  });

  describe('the digit shortcut', () => {
    it('resolves 1..n to the format with that number', () => {
      expect(resolveFormatShortcut('1')?.id).toBe('blockquote');
      expect(resolveFormatShortcut('2')?.id).toBe('blockquote-numbered');
      expect(resolveFormatShortcut('3')?.id).toBe('inline-quote');
      expect(resolveFormatShortcut('4')?.id).toBe('heading-per-verse');
      expect(resolveFormatShortcut('5')?.id).toBe('template');
    });

    it('claims nothing beyond the formats that exist', () => {
      expect(resolveFormatShortcut('6')).toBeUndefined();
      expect(resolveFormatShortcut('9')).toBeUndefined();
      expect(MAX_FORMAT_SHORTCUT).toBe(9);
    });

    // Any other key belongs to whoever was going to handle it.
    it('claims nothing that is not a bare digit', () => {
      for (const key of ['0', 'a', 'Enter', 'ArrowDown', '', '12']) {
        expect(resolveFormatShortcut(key)).toBeUndefined();
      }
    });
  });
});
