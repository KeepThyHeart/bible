import { describe, it, expect } from 'vitest';
import { entriesDescribeFeaturePack } from '../featurePackArchive';

describe('entriesDescribeFeaturePack', () => {
  it('recognises the semantic-search pack layout (feature-pack.json at the root)', () => {
    expect(
      entriesDescribeFeaturePack([
        'feature-pack.json',
        'semantic_index.db.gz',
        'models/nomic-ai/nomic-embed-text-v1.5/config.json',
      ])
    ).toBe(true);
  });

  it('accepts one wrapping folder, as SemanticPackService does', () => {
    expect(entriesDescribeFeaturePack(['pack/feature-pack.json', 'pack/semantic_index.db.gz'])).toBe(true);
  });

  it('is false for a module pack, signed or not', () => {
    expect(entriesDescribeFeaturePack(['bible_kjv.db', 'commentary_mhc.db.gz'])).toBe(false);
    expect(entriesDescribeFeaturePack(['pack.json', 'pack.json.sig', 'bible_kjv.db'])).toBe(false);
  });

  it('is false when a module-pack manifest sits beside a feature-pack manifest', () => {
    expect(entriesDescribeFeaturePack(['pack.json', 'feature-pack.json', 'bible_kjv.db'])).toBe(false);
  });

  it('ignores a feature-pack.json buried deeper than one folder', () => {
    expect(entriesDescribeFeaturePack(['a/b/feature-pack.json'])).toBe(false);
  });
});
