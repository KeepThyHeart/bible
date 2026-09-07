import { describe, it, expect } from 'vitest';
import {
  isSafeArtifactPath,
  packagedFileName,
  parseFeaturePack,
  parseFeaturePacks,
  parseLocalFeaturePack,
  FEATURE_PACK_FILE_FORMAT,
  MAX_FEATURE_PACK_ARTIFACT_BYTES,
  MAX_ARTIFACT_PATH_LENGTH,
} from './FeaturePackTypes';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

function validPack(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pack_id: 'semantic-kjv-nomic-v1',
    pack_type: 'semantic_search',
    name: 'Semantic Search (KJV)',
    version: '1.0.0',
    description: 'Meaning-based search over the KJV.',
    license: 'CC-BY-4.0',
    license_url: 'https://example.org/license',
    download_size_bytes: 200_000_000,
    installed_size_bytes: 420_000_000,
    artifacts: [
      {
        kind: 'index',
        path: 'semantic_index.db',
        download_url: 'https://example.org/packs/semantic_index.db.gz',
        download_size_bytes: 111_000_000,
        sha256: DIGEST_A,
        gzipped: true,
      },
      {
        kind: 'model',
        path: 'models/Xenova/nomic-embed-text-v1/config.json',
        download_url: 'https://example.org/packs/config.json',
        download_size_bytes: 1024,
        sha256: DIGEST_B,
      },
    ],
    ...overrides,
  };
}

describe('isSafeArtifactPath', () => {
  it('accepts ordinary nested relative paths', () => {
    expect(isSafeArtifactPath('semantic_index.db')).toBe(true);
    expect(isSafeArtifactPath('models/Xenova/nomic-embed-text-v1/onnx/model.onnx')).toBe(true);
    expect(isSafeArtifactPath('a')).toBe(true);
  });

  // Each of these is a real-world traversal or Windows-path trick. They are the
  // reason the check is an allowlist rather than a scan for '..'.
  it.each([
    ['parent traversal', '../evil.db'],
    ['nested traversal', 'models/../../evil.db'],
    ['bare dotdot', '..'],
    ['single dot segment', './evil.db'],
    ['posix absolute', '/etc/passwd'],
    ['windows drive absolute', 'C:/Windows/System32/evil.dll'],
    ['drive relative', 'C:evil.db'],
    ['backslash separator', 'models\\evil.db'],
    ['backslash traversal', '..\\evil.db'],
    ['UNC path', '//server/share/evil.db'],
    ['double slash', 'models//evil.db'],
    ['trailing slash', 'models/'],
    ['leading slash', '/models/x.db'],
    ['empty', ''],
    ['NTFS alternate data stream', 'index.db:hidden'],
    ['trailing dot', 'models/evil.'],
    ['trailing space', 'models/evil '],
    ['leading dot (hidden file)', '.ssh/authorized_keys'],
    ['windows reserved name', 'models/con.json'],
    ['windows reserved name uppercase', 'models/NUL'],
    ['windows reserved com port', 'com1'],
    ['tilde home', '~/evil.db'],
    ['url encoded traversal', '%2e%2e/evil.db'],
    ['double encoded traversal', '%252e%252e/evil.db'],
  ])('rejects %s', (_label, candidate) => {
    expect(isSafeArtifactPath(candidate)).toBe(false);
  });

  it('rejects control characters, including an embedded NUL', () => {
    expect(isSafeArtifactPath('models/evil\u0000.db')).toBe(false);
    expect(isSafeArtifactPath('models/evil\n.db')).toBe(false);
    expect(isSafeArtifactPath('models/evil\u007f.db')).toBe(false);
  });

  it('rejects paths beyond the length ceiling', () => {
    const long = 'a'.repeat(MAX_ARTIFACT_PATH_LENGTH + 1);
    expect(isSafeArtifactPath(long)).toBe(false);
    expect(isSafeArtifactPath('a'.repeat(MAX_ARTIFACT_PATH_LENGTH))).toBe(true);
  });

  it('rejects non-string input', () => {
    expect(isSafeArtifactPath(undefined as unknown as string)).toBe(false);
    expect(isSafeArtifactPath(42 as unknown as string)).toBe(false);
  });
});

describe('parseFeaturePack', () => {
  it('accepts a well-formed pack and normalises the digest to lowercase', () => {
    const result = parseFeaturePack(
      validPack({
        artifacts: [
          {
            kind: 'index',
            path: 'semantic_index.db',
            download_url: 'https://example.org/i.db',
            download_size_bytes: 10,
            sha256: DIGEST_A.toUpperCase(),
          },
          {
            kind: 'model',
            path: 'models/config.json',
            download_url: 'https://example.org/c.json',
            download_size_bytes: 10,
            sha256: DIGEST_B,
          },
        ],
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pack.pack_id).toBe('semantic-kjv-nomic-v1');
    expect(result.pack.artifacts[0].sha256).toBe(DIGEST_A);
    expect(result.pack.artifacts[0].gzipped).toBeUndefined();
  });

  it('preserves the gzipped flag only when explicitly true', () => {
    const result = parseFeaturePack(validPack());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pack.artifacts[0].gzipped).toBe(true);
    expect(result.pack.artifacts[1].gzipped).toBeUndefined();
  });

  it('rejects a non-object entry', () => {
    expect(parseFeaturePack(null).ok).toBe(false);
    expect(parseFeaturePack('pack').ok).toBe(false);
    expect(parseFeaturePack([]).ok).toBe(false);
  });

  it('rejects an unknown pack_type rather than ignoring it', () => {
    const result = parseFeaturePack(validPack({ pack_type: 'run_arbitrary_code' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('pack_type');
  });

  it('rejects a pack whose artifact path would escape the pack root', () => {
    const result = parseFeaturePack(
      validPack({
        artifacts: [
          {
            kind: 'index',
            path: '../../../AppData/Roaming/evil.db',
            download_url: 'https://example.org/i.db',
            download_size_bytes: 10,
            sha256: DIGEST_A,
          },
          {
            kind: 'model',
            path: 'models/config.json',
            download_url: 'https://example.org/c.json',
            download_size_bytes: 10,
            sha256: DIGEST_B,
          },
        ],
      })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('safe relative path');
  });

  it('rejects a non-http download URL', () => {
    const pack = validPack() as { artifacts: Array<Record<string, unknown>> };
    pack.artifacts[0].download_url = 'file:///C:/Windows/System32/config/SAM';
    const result = parseFeaturePack(pack);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('download_url');
  });

  it('rejects a malformed digest', () => {
    const pack = validPack() as { artifacts: Array<Record<string, unknown>> };
    pack.artifacts[0].sha256 = 'not-a-digest';
    expect(parseFeaturePack(pack).ok).toBe(false);
  });

  it('rejects an artifact larger than the per-artifact ceiling', () => {
    const pack = validPack() as { artifacts: Array<Record<string, unknown>> };
    pack.artifacts[0].download_size_bytes = MAX_FEATURE_PACK_ARTIFACT_BYTES + 1;
    expect(parseFeaturePack(pack).ok).toBe(false);
  });

  it('rejects duplicate artifact paths, including case-only differences', () => {
    const result = parseFeaturePack(
      validPack({
        artifacts: [
          {
            kind: 'index',
            path: 'semantic_index.db',
            download_url: 'https://example.org/a',
            download_size_bytes: 10,
            sha256: DIGEST_A,
          },
          {
            kind: 'model',
            path: 'Semantic_Index.DB',
            download_url: 'https://example.org/b',
            download_size_bytes: 10,
            sha256: DIGEST_B,
          },
        ],
      })
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('duplicates');
  });

  it('requires exactly one index artifact in a semantic_search pack', () => {
    const twoIndexes = parseFeaturePack(
      validPack({
        artifacts: [
          { kind: 'index', path: 'a.db', download_url: 'https://e.org/a', download_size_bytes: 1, sha256: DIGEST_A },
          { kind: 'index', path: 'b.db', download_url: 'https://e.org/b', download_size_bytes: 1, sha256: DIGEST_B },
          { kind: 'model', path: 'm.json', download_url: 'https://e.org/m', download_size_bytes: 1, sha256: DIGEST_A },
        ],
      })
    );
    expect(twoIndexes.ok).toBe(false);

    const noModel = parseFeaturePack(
      validPack({
        artifacts: [
          { kind: 'index', path: 'a.db', download_url: 'https://e.org/a', download_size_bytes: 1, sha256: DIGEST_A },
        ],
      })
    );
    expect(noModel.ok).toBe(false);
  });

  it('rejects an empty or missing artifact list', () => {
    expect(parseFeaturePack(validPack({ artifacts: [] })).ok).toBe(false);
    expect(parseFeaturePack(validPack({ artifacts: undefined })).ok).toBe(false);
    expect(parseFeaturePack(validPack({ artifacts: 'nope' })).ok).toBe(false);
  });

  it('rejects a malformed pack_id', () => {
    expect(parseFeaturePack(validPack({ pack_id: '../escape' })).ok).toBe(false);
    expect(parseFeaturePack(validPack({ pack_id: 'Has Spaces' })).ok).toBe(false);
    expect(parseFeaturePack(validPack({ pack_id: '' })).ok).toBe(false);
  });

  it('rejects non-positive or non-integer sizes', () => {
    expect(parseFeaturePack(validPack({ download_size_bytes: 0 })).ok).toBe(false);
    expect(parseFeaturePack(validPack({ download_size_bytes: -1 })).ok).toBe(false);
    expect(parseFeaturePack(validPack({ installed_size_bytes: 1.5 })).ok).toBe(false);
  });

  it('treats a non-object metadata value as absent rather than failing', () => {
    const result = parseFeaturePack(validPack({ metadata: 'nope' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pack.metadata).toBeNull();
  });
});

describe('parseFeaturePacks', () => {
  it('keeps valid packs and reports the rejected ones', () => {
    const { packs, rejected } = parseFeaturePacks([
      validPack(),
      { pack_id: 'broken' },
      validPack({ pack_id: 'second-pack' }),
    ]);

    expect(packs.map(p => p.pack_id)).toEqual(['semantic-kjv-nomic-v1', 'second-pack']);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].index).toBe(1);
  });

  it('drops a duplicate pack_id within one catalog', () => {
    const { packs, rejected } = parseFeaturePacks([validPack(), validPack()]);
    expect(packs).toHaveLength(1);
    expect(rejected[0].errors.join(' ')).toContain('Duplicate');
  });

  it('returns empty for a non-array section', () => {
    expect(parseFeaturePacks(undefined).packs).toEqual([]);
    expect(parseFeaturePacks({}).packs).toEqual([]);
  });
});

function validLocalPack(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: FEATURE_PACK_FILE_FORMAT,
    pack_id: 'semantic-kjv-nomic-v1',
    pack_type: 'semantic_search',
    name: 'Semantic Search (KJV)',
    version: '1.0.0',
    description: 'Meaning-based search over the KJV.',
    license: 'CC-BY-4.0',
    installed_size_bytes: 420_000_000,
    artifacts: [
      { kind: 'index', path: 'semantic_index.db', size_bytes: 111_000_000, sha256: DIGEST_A, gzipped: true },
      {
        kind: 'model',
        path: 'models/Xenova/nomic-embed-text-v1/config.json',
        size_bytes: 1024,
        sha256: DIGEST_B,
      },
    ],
    ...overrides,
  };
}

describe('parseLocalFeaturePack', () => {
  it('accepts a well-formed package manifest', () => {
    const result = parseLocalFeaturePack(validLocalPack());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pack.pack_id).toBe('semantic-kjv-nomic-v1');
    expect(result.pack.artifacts).toHaveLength(2);
    expect(result.pack.artifacts[0].size_bytes).toBe(111_000_000);
    expect(result.pack.artifacts[0].gzipped).toBe(true);
    // Absent rather than `false`, matching the catalog parser: the flag is
    // written only when it is true, so an install cannot read a stale `false`.
    expect(result.pack.artifacts[1].gzipped).toBeUndefined();
  });

  // The tag is what stops an unrelated `feature-pack.json` - or a package built
  // for a future, incompatible layout - from being installed as if it fitted.
  it('rejects a manifest with a missing or wrong format tag', () => {
    const missing = parseLocalFeaturePack(validLocalPack({ format: undefined }));
    expect(missing.ok).toBe(false);

    const future = parseLocalFeaturePack(validLocalPack({ format: 'bible-feature-pack@2' }));
    expect(future.ok).toBe(false);
    if (future.ok) return;
    expect(future.errors[0]).toMatch(/format/);
  });

  it('does not require download URLs', () => {
    const result = parseLocalFeaturePack(validLocalPack());
    expect(result.ok).toBe(true);
  });

  // A URL in a package manifest would be egress the user did not ask for when
  // they picked a local file, so it is ignored rather than honoured.
  it('ignores a download_url smuggled into a package manifest', () => {
    const result = parseLocalFeaturePack(
      validLocalPack({
        artifacts: [
          {
            kind: 'index',
            path: 'semantic_index.db',
            size_bytes: 10,
            sha256: DIGEST_A,
            download_url: 'https://attacker.example/payload.db',
          },
          { kind: 'model', path: 'models/config.json', size_bytes: 10, sha256: DIGEST_B },
        ],
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.pack)).not.toContain('attacker.example');
  });

  // The whole point of the shared parser: sideloading must not be the softer
  // way in. Each of these is rejected identically to a catalog entry.
  it('applies the same artifact-path, digest and ceiling rules as a catalog entry', () => {
    const traversal = parseLocalFeaturePack(
      validLocalPack({
        artifacts: [
          { kind: 'index', path: '../../evil.db', size_bytes: 10, sha256: DIGEST_A },
          { kind: 'model', path: 'models/config.json', size_bytes: 10, sha256: DIGEST_B },
        ],
      })
    );
    expect(traversal.ok).toBe(false);

    const badDigest = parseLocalFeaturePack(
      validLocalPack({
        artifacts: [
          { kind: 'index', path: 'semantic_index.db', size_bytes: 10, sha256: 'nope' },
          { kind: 'model', path: 'models/config.json', size_bytes: 10, sha256: DIGEST_B },
        ],
      })
    );
    expect(badDigest.ok).toBe(false);

    const tooBig = parseLocalFeaturePack(
      validLocalPack({
        artifacts: [
          {
            kind: 'index',
            path: 'semantic_index.db',
            size_bytes: MAX_FEATURE_PACK_ARTIFACT_BYTES + 1,
            sha256: DIGEST_A,
          },
          { kind: 'model', path: 'models/config.json', size_bytes: 10, sha256: DIGEST_B },
        ],
      })
    );
    expect(tooBig.ok).toBe(false);
  });

  it('requires the semantic_search shape', () => {
    const noModel = parseLocalFeaturePack(
      validLocalPack({
        artifacts: [
          { kind: 'index', path: 'semantic_index.db', size_bytes: 10, sha256: DIGEST_A },
        ],
      })
    );
    expect(noModel.ok).toBe(false);
  });

  it('rejects a manifest that is not an object', () => {
    expect(parseLocalFeaturePack('nope').ok).toBe(false);
    expect(parseLocalFeaturePack(null).ok).toBe(false);
    expect(parseLocalFeaturePack([validLocalPack()]).ok).toBe(false);
  });
});

describe('packagedFileName', () => {
  it('appends .gz only for gzipped artifacts', () => {
    expect(packagedFileName({ path: 'semantic_index.db', gzipped: true })).toBe('semantic_index.db.gz');
    expect(packagedFileName({ path: 'models/config.json' })).toBe('models/config.json');
  });
});
