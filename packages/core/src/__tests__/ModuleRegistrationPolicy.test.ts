/**
 * TSK used to be registered twice - as `commentary_tsk.db` (module_id 100,
 * abbrev `TSK`) and as `xref_tsk.db` (module_id 233, abbrev `TSKxref`) -
 * because module type is inferred from the filename prefix and both files sit
 * in the modules directory. Three separate render paths keyed off
 * `module_type` then showed the same body of references three times under one
 * verse, one of them inside "Commentaries:", where clicking it opened the raw
 * SWORD import the cross-reference module is generated from.
 */
import { describe, it, expect } from 'vitest';
import {
  moduleFileSlug,
  crossReferenceSlugs,
  isCrossReferenceSourceCommentary,
  isCrossReferenceSourceCommentaryPath,
} from '../Services/ModuleRegistrationPolicy';

describe('moduleFileSlug', () => {
  it('takes what lies between the type prefix and the extension', () => {
    expect(moduleFileSlug('xref_tsk.db', 'xref_')).toBe('tsk');
    expect(moduleFileSlug('commentary_mhc.db', 'commentary_')).toBe('mhc');
  });

  it('is case-insensitive, as filesystems on Windows and macOS are', () => {
    expect(moduleFileSlug('XREF_TSK.DB', 'xref_')).toBe('tsk');
  });

  it('rejects a filename that is only the prefix, or the wrong type', () => {
    expect(moduleFileSlug('xref_.db', 'xref_')).toBeNull();
    expect(moduleFileSlug('commentary_tsk.db', 'xref_')).toBeNull();
    expect(moduleFileSlug('xref_tsk.sqlite', 'xref_')).toBeNull();
  });
});

describe('the cross-reference source rule', () => {
  const FILES = [
    'bible_kjv.db',
    'commentary_mhc.db',
    'commentary_tsk.db',
    'xref_tsk.db',
    'topical_nave.db',
  ];
  const slugs = crossReferenceSlugs(FILES);

  it('finds the installed cross-reference slugs', () => {
    expect([...slugs]).toEqual(['tsk']);
  });

  it('shadows the commentary that is a cross-reference module\u2019s source', () => {
    expect(isCrossReferenceSourceCommentary('commentary_tsk.db', slugs)).toBe(true);
  });

  it('leaves every real commentary alone', () => {
    expect(isCrossReferenceSourceCommentary('commentary_mhc.db', slugs)).toBe(false);
    // The rule is about pairs, not about the word "tsk": with no xref_tsk.db
    // installed, commentary_tsk.db is just a commentary again.
    expect(isCrossReferenceSourceCommentary('commentary_tsk.db', crossReferenceSlugs([]))).toBe(false);
  });

  it('never shadows a non-commentary file', () => {
    expect(isCrossReferenceSourceCommentary('xref_tsk.db', slugs)).toBe(false);
    expect(isCrossReferenceSourceCommentary('bible_kjv.db', slugs)).toBe(false);
  });

  it('recognises an already-registered row by its registry path', () => {
    // Registry paths are POSIX-relative, but a row written by an older build on
    // Windows may carry backslashes.
    expect(isCrossReferenceSourceCommentaryPath('modules/commentary_tsk.db', slugs)).toBe(true);
    expect(isCrossReferenceSourceCommentaryPath('modules\\commentary_tsk.db', slugs)).toBe(true);
    expect(isCrossReferenceSourceCommentaryPath('modules/commentary_mhc.db', slugs)).toBe(false);
  });
});
