import { describe, it, expect } from 'vitest';
import {
  DIGEST_MODULE_ABBR,
  MODULE_PROVENANCE_TEXT,
  getModuleProvenanceKind,
  isAiGeneratedMetadata,
  isAiGeneratedModule,
  isDigestModule,
} from './moduleDescriptions';
import { DEFAULT_COMMENTARY_PREFERENCE } from './constants';
import { enString } from './testing/enCatalog';

describe('moduleDescriptions', () => {
  describe('isDigestModule', () => {
    it('matches the digest abbreviation', () => {
      expect(isDigestModule('SYNTHESIS')).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(isDigestModule('synthesis')).toBe(true);
      expect(isDigestModule('Synthesis')).toBe(true);
    });

    it('does not match ordinary commentaries', () => {
      expect(isDigestModule('MHC')).toBe(false);
      expect(isDigestModule('Barnes')).toBe(false);
      expect(isDigestModule('Clarke')).toBe(false);
    });

    it('tolerates null and undefined', () => {
      expect(isDigestModule(null)).toBe(false);
      expect(isDigestModule(undefined)).toBe(false);
      expect(isDigestModule('')).toBe(false);
    });

    it('is never among the commentaries the app opens by default', () => {
      // Generated text is something a reader opts into, not a first-run default.
      for (const abbreviation of DEFAULT_COMMENTARY_PREFERENCE) {
        expect(isDigestModule(abbreviation)).toBe(false);
      }
      expect(DEFAULT_COMMENTARY_PREFERENCE).not.toContain(DIGEST_MODULE_ABBR);
    });
  });

  describe('isAiGeneratedMetadata', () => {
    it('detects the shipped SYNTHESIS author string', () => {
      expect(
        isAiGeneratedMetadata({
          author: 'AI-synthesized from 19+ public domain commentaries',
        })
      ).toBe(true);
    });

    it.each([
      'AI-generated commentary',
      'AI generated notes',
      'Generated with artificial intelligence',
      'machine-generated summary',
      'Auto-generated from public domain sources',
      'automatically generated digest',
      'computer-generated notes',
      'Produced by a large language model',
      'Drafted by an LLM',
      'AI-assisted compilation',
    ])('flags %j', (value) => {
      expect(isAiGeneratedMetadata({ author: value })).toBe(true);
    });

    it('scans copyright, description and full_name too', () => {
      expect(isAiGeneratedMetadata({ copyright: 'AI-generated, public domain' })).toBe(true);
      expect(isAiGeneratedMetadata({ description: 'An auto-generated digest' })).toBe(true);
      expect(isAiGeneratedMetadata({ full_name: 'Machine-generated Notes' })).toBe(true);
    });

    it.each([
      'Matthew Henry',
      'Albert Barnes',
      'Adam Clarke',
      'John Gill',
      'Public domain',
      'Claude Fleury',
      'Jean-Claude Martin',
      'Gemini Publishing House',
      'Cairo, Egypt',
    ])('does not flag human byline %j', (value) => {
      expect(isAiGeneratedMetadata({ author: value })).toBe(false);
    });

    it('returns false for empty metadata', () => {
      expect(isAiGeneratedMetadata(undefined)).toBe(false);
      expect(isAiGeneratedMetadata(null)).toBe(false);
      expect(isAiGeneratedMetadata({})).toBe(false);
      expect(isAiGeneratedMetadata({ author: null, copyright: undefined })).toBe(false);
    });
  });

  describe('getModuleProvenanceKind', () => {
    it('returns "digest" for SYNTHESIS with no metadata loaded yet', () => {
      expect(getModuleProvenanceKind('SYNTHESIS')).toBe('digest');
    });

    it('keeps "digest" for SYNTHESIS once its metadata arrives', () => {
      expect(
        getModuleProvenanceKind('SYNTHESIS', {
          author: 'AI-synthesized from 19+ public domain commentaries',
        })
      ).toBe('digest');
    });

    it('returns "generated" for a different module that declares itself generated', () => {
      expect(
        getModuleProvenanceKind('FUTUREAI', { author: 'AI-generated' })
      ).toBe('generated');
    });

    it('returns null for a human-authored module', () => {
      expect(getModuleProvenanceKind('MHC', { author: 'Matthew Henry' })).toBeNull();
      expect(getModuleProvenanceKind('MHC')).toBeNull();
    });
  });

  describe('isAiGeneratedModule', () => {
    it('is true for the digest and for metadata-flagged modules', () => {
      expect(isAiGeneratedModule('SYNTHESIS')).toBe(true);
      expect(isAiGeneratedModule('OTHER', { description: 'AI-generated' })).toBe(true);
    });

    it('is false for Matthew Henry', () => {
      expect(isAiGeneratedModule('MHC', { author: 'Matthew Henry' })).toBe(false);
    });
  });

  describe('MODULE_PROVENANCE_TEXT', () => {
    // The table holds keys only; the English is in `locales/en`, so these read
    // the catalog rather than a second copy of the wording in source.
    it('matches the web app wording for the digest', () => {
      expect(enString(MODULE_PROVENANCE_TEXT.digest.provenanceKey)).toBe(
        'This is an auto-generated summary of a range of public-domain commentaries.'
      );
      expect(enString(MODULE_PROVENANCE_TEXT.digest.cautionKey)).toBe(
        'Computers sometimes make mistakes in summarizing, and commentaries sometimes have false doctrines.'
      );
    });

    it('keeps every sentence whole — no fragment concatenation', () => {
      for (const entry of Object.values(MODULE_PROVENANCE_TEXT)) {
        expect(enString(entry.provenanceKey).trim().endsWith('.')).toBe(true);
        expect(enString(entry.cautionKey).trim().endsWith('.')).toBe(true);
      }
    });

    it('namespaces every key under moduleDisclaimer', () => {
      for (const entry of Object.values(MODULE_PROVENANCE_TEXT)) {
        expect(entry.provenanceKey.startsWith('moduleDisclaimer.')).toBe(true);
        expect(entry.cautionKey.startsWith('moduleDisclaimer.')).toBe(true);
        expect(entry.collapsedKey.startsWith('moduleDisclaimer.')).toBe(true);
      }
    });
  });
});
