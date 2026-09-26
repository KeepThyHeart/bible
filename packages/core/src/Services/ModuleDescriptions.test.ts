import { describe, it, expect } from 'vitest';
import {
  COMMENTARY_PRIORITY,
  DEFAULT_COMMENTARY_PRIORITY,
  DIGEST_MODULE_ABBR,
  RECOMMENDED_BIBLES,
  getCommentaryPriority,
  getModuleProvenanceKind,
  isAiGeneratedMetadata,
  isAiGeneratedModule,
  isDigestModule,
} from './ModuleDescriptions';

describe('isDigestModule', () => {
  it('matches the digest abbreviation case-insensitively and tolerates null', () => {
    expect(isDigestModule('SYNTHESIS')).toBe(true);
    expect(isDigestModule('synthesis')).toBe(true);
    expect(isDigestModule('Barnes')).toBe(false);
    expect(isDigestModule(null)).toBe(false);
    expect(isDigestModule(undefined)).toBe(false);
    expect(isDigestModule('')).toBe(false);
  });
});

describe('provenance detection', () => {
  it('flags metadata that declares machine authorship', () => {
    expect(isAiGeneratedMetadata({ author: 'AI-synthesized from 19+ public domain commentaries' })).toBe(true);
    expect(isAiGeneratedMetadata({ full_name: 'Machine-generated Notes' })).toBe(true);
  });

  it('does not flag human authors, including names that merely resemble models', () => {
    expect(isAiGeneratedMetadata({ author: 'Matthew Henry' })).toBe(false);
    expect(isAiGeneratedMetadata({ author: 'Claude Gemini' })).toBe(false);
    expect(isAiGeneratedMetadata(null)).toBe(false);
  });

  it('classifies the digest before consulting metadata', () => {
    expect(getModuleProvenanceKind(DIGEST_MODULE_ABBR)).toBe('digest');
    expect(getModuleProvenanceKind('Other', { description: 'auto-generated digest' })).toBe('generated');
    expect(getModuleProvenanceKind('Barnes', { author: 'Albert Barnes' })).toBeNull();
    expect(isAiGeneratedModule('Barnes')).toBe(false);
    expect(isAiGeneratedModule('SYNTHESIS')).toBe(true);
  });
});

describe('editorial ordering data', () => {
  it('sorts the digest first and unlisted commentaries last together', () => {
    expect(getCommentaryPriority('SYNTHESIS')).toBe(0);
    expect(getCommentaryPriority('Barnes')).toBe(COMMENTARY_PRIORITY.Barnes);
    expect(getCommentaryPriority('NOT_LISTED')).toBe(DEFAULT_COMMENTARY_PRIORITY);
    expect(DEFAULT_COMMENTARY_PRIORITY).toBeGreaterThan(Math.max(...Object.values(COMMENTARY_PRIORITY)));
  });

  it('recommends KJV first', () => {
    expect(RECOMMENDED_BIBLES[0]).toBe('KJV');
  });
});
