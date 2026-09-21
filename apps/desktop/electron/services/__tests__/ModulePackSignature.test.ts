/**
 * Unit tests for `ModulePackSignature` - `.biblepack` manifest parsing and
 * detached-signature verification.
 *
 * Threats exercised:
 *  - verified / unsigned / untrusted / invalid outcomes
 *  - domain separation: a catalog-style signature (raw manifest bytes, no
 *    prefix) must NOT verify as a pack signature, and vice versa
 *  - the existing multi-signature rule (one trusted signer among several is
 *    still `verified`)
 */
import { describe, it, expect } from 'vitest';
import { createHash, sign } from 'crypto';

import {
  parsePackManifest,
  packManifestDigest,
  verifyPackManifestSignature,
  PACK_MANIFEST_FORMAT,
  PACK_MANIFEST_SIGNATURE_DOMAIN,
  type PackManifest,
} from '../ModulePackSignature';
import { makeKey, type TestKey } from './catalogSigningTestHelpers';

const MANIFEST: PackManifest = {
  format: PACK_MANIFEST_FORMAT,
  pack_id: 'en-starter',
  name: 'English starter',
  version: '1.0.0',
  languages: ['en'],
  created: '2026-09-18T00:00:00Z',
  modules: [
    { path: 'kjv.db.gz', sha256: 'a'.repeat(64), size_bytes: 12345 },
  ],
};

function manifestBytes(manifest: PackManifest = MANIFEST): Buffer {
  return Buffer.from(JSON.stringify(manifest), 'utf-8');
}

/** A `.sig` document over the domain-separated digest - what `sign-pack` writes. */
function packSignatureDocument(bytes: Buffer, ...keys: TestKey[]): string {
  const digest = packManifestDigest(bytes);
  const [primary, ...rest] = keys.map((key) => ({
    publicKey: key.publicKeyHex,
    signature: sign(null, digest, key.privateKey).toString('hex'),
    algorithm: 'ed25519-sha256',
  }));
  return JSON.stringify(rest.length > 0 ? { ...primary, signatures: rest } : primary);
}

/** A `.sig` document over the RAW manifest bytes with no domain prefix - what a catalog signer would produce. */
function catalogStyleSignatureDocument(bytes: Buffer, key: TestKey): string {
  const digest = createHash('sha256').update(bytes).digest();
  return JSON.stringify({
    publicKey: key.publicKeyHex,
    signature: sign(null, digest, key.privateKey).toString('hex'),
    algorithm: 'ed25519-sha256',
  });
}

describe('parsePackManifest', () => {
  it('accepts a well-formed manifest', () => {
    const result = parsePackManifest(MANIFEST);
    expect(result.ok).toBe(true);
  });

  it('rejects the wrong format string', () => {
    const result = parsePackManifest({ ...MANIFEST, format: 'keepthyheart.biblepack/2' });
    expect(result.ok).toBe(false);
  });

  it('rejects a module path that escapes with ..', () => {
    const result = parsePackManifest({
      ...MANIFEST,
      modules: [{ path: '../../etc/passwd.db', sha256: 'a'.repeat(64), size_bytes: 1 }],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects an empty modules array', () => {
    const result = parsePackManifest({ ...MANIFEST, modules: [] });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-hex/short sha256', () => {
    const result = parsePackManifest({
      ...MANIFEST,
      modules: [{ path: 'a.db', sha256: 'nothex', size_bytes: 1 }],
    });
    expect(result.ok).toBe(false);
  });
});

describe('verifyPackManifestSignature', () => {
  it('is unsigned when neither file is present', () => {
    const result = verifyPackManifestSignature(undefined, undefined, []);
    expect(result.status).toBe('unsigned');
  });

  it('is unsigned when only pack.json is present (no .sig) - the ordinary shape build-module-pack.js writes for an unsigned pack', () => {
    const result = verifyPackManifestSignature(manifestBytes(), undefined, []);
    expect(result.status).toBe('unsigned');
  });

  it('is invalid when only pack.json.sig is present (no manifest)', () => {
    const key = makeKey();
    const result = verifyPackManifestSignature(undefined, Buffer.from(packSignatureDocument(manifestBytes(), key)), []);
    expect(result.status).toBe('invalid');
  });

  it('is invalid when pack.json is malformed', () => {
    const bad = Buffer.from('{"not": "a manifest"}', 'utf-8');
    const key = makeKey();
    const result = verifyPackManifestSignature(bad, Buffer.from(packSignatureDocument(bad, key)), [key.publicKeyHex]);
    expect(result.status).toBe('invalid');
  });

  it('verifies a signature by a trusted key', () => {
    const key = makeKey();
    const bytes = manifestBytes();
    const result = verifyPackManifestSignature(bytes, Buffer.from(packSignatureDocument(bytes, key)), [key.publicKeyHex]);
    expect(result.status).toBe('verified');
    expect(result.publicKey).toBe(key.publicKeyHex);
    expect(result.manifest?.pack_id).toBe('en-starter');
  });

  it('is untrusted when every signature verifies but none is by a trusted key, and reports a fingerprint', () => {
    const key = makeKey();
    const bytes = manifestBytes();
    const result = verifyPackManifestSignature(bytes, Buffer.from(packSignatureDocument(bytes, key)), [makeKey().publicKeyHex]);
    expect(result.status).toBe('untrusted');
    expect(result.publicKey).toBe(key.publicKeyHex);
    expect(result.message).toContain(key.publicKeyHex.slice(0, 8));
  });

  it('is verified when a second, untrusted key signs alongside a trusted one (multi-sig rule)', () => {
    const trusted = makeKey();
    const untrusted = makeKey();
    const bytes = manifestBytes();
    const result = verifyPackManifestSignature(
      bytes,
      Buffer.from(packSignatureDocument(bytes, trusted, untrusted)),
      [trusted.publicKeyHex]
    );
    expect(result.status).toBe('verified');
    expect(result.publicKey).toBe(trusted.publicKeyHex);
  });

  it('is invalid when the manifest bytes were tampered with after signing', () => {
    const key = makeKey();
    const bytes = manifestBytes();
    const sig = packSignatureDocument(bytes, key);
    const tampered = manifestBytes({ ...MANIFEST, name: 'Evil starter' });
    const result = verifyPackManifestSignature(tampered, Buffer.from(sig), [key.publicKeyHex]);
    expect(result.status).toBe('invalid');
  });

  describe('domain separation', () => {
    it('a catalog-style signature (raw bytes, no prefix) does NOT verify as a pack signature', () => {
      const key = makeKey();
      const bytes = manifestBytes();
      const result = verifyPackManifestSignature(
        bytes,
        Buffer.from(catalogStyleSignatureDocument(bytes, key)),
        [key.publicKeyHex]
      );
      // The signature is well-formed but does not match the domain-separated
      // digest, so it is reported as tampering, never as verified/untrusted.
      expect(result.status).toBe('invalid');
    });

    it('the domain prefix used matches what scripts/yubikey-sign.py builds', () => {
      // Pinned so the Python side (`sign-pack`) and this file can never
      // silently drift apart - see that script's `pack_manifest_digest`.
      expect(PACK_MANIFEST_SIGNATURE_DOMAIN).toBe('keepthyheart.biblepack.manifest.v1\n');
    });
  });
});
