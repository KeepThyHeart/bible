import { describe, it, expect } from 'vitest';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'crypto';

import {
  verifyCatalogSignature,
  isCatalogUsable,
  MAX_CATALOG_SIGNATURES,
} from '../CatalogSignatureVerifier';

/** DER prefix for a raw 32-byte Ed25519 private key wrapped as PKCS#8. */
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

interface TestKey {
  publicKeyHex: string;
  privateKeyHex: string;
}

function makeKey(): TestKey {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubDer = publicKey.export({ format: 'der', type: 'spki' });
  const privDer = privateKey.export({ format: 'der', type: 'pkcs8' });
  return {
    publicKeyHex: pubDer.subarray(pubDer.length - 32).toString('hex'),
    privateKeyHex: privDer.subarray(privDer.length - 32).toString('hex'),
  };
}

/** Produce the `.sig` document a publisher would upload beside the catalog. */
function signCatalog(catalogBytes: Buffer, key: TestKey): string {
  const keyObject = createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, Buffer.from(key.privateKeyHex, 'hex')]),
    format: 'der',
    type: 'pkcs8',
  });
  const digest = createHash('sha256').update(catalogBytes).digest();
  return JSON.stringify({
    publicKey: key.publicKeyHex,
    signature: sign(null, digest, keyObject).toString('hex'),
    algorithm: 'ed25519-sha256',
  });
}

const CATALOG = Buffer.from(
  JSON.stringify({
    repository: { name: 'Test', url: 'https://example.org/', version: '1.0' },
    modules: [
      {
        module_id: 'bible_kjv',
        module_type: 'bible',
        name: 'KJV',
        download_url: 'bible_kjv.db',
        checksum: 'sha256:abc',
      },
    ],
  }),
  'utf-8',
);

describe('verifyCatalogSignature', () => {
  describe('valid signatures', () => {
    it('verifies a correctly signed catalog and reports the signing key', () => {
      const key = makeKey();
      const result = verifyCatalogSignature(CATALOG, signCatalog(CATALOG, key));

      expect(result.status).toBe('verified');
      expect(result.publicKey).toBe(key.publicKeyHex);
      expect(isCatalogUsable(result)).toBe(true);
    });

    it('verifies when the signature matches the pinned key', () => {
      const key = makeKey();
      const result = verifyCatalogSignature(CATALOG, signCatalog(CATALOG, key), {
        expectedPublicKey: key.publicKeyHex,
      });

      expect(result.status).toBe('verified');
    });

    it('matches the pinned key case-insensitively', () => {
      const key = makeKey();
      const result = verifyCatalogSignature(CATALOG, signCatalog(CATALOG, key), {
        expectedPublicKey: key.publicKeyHex.toUpperCase(),
      });

      expect(result.status).toBe('verified');
    });

    it('accepts a signature from any key in a pinned set', () => {
      // Rotation: old and new keys are pinned together and the catalog may be
      // signed by either - including one that is not first in the list.
      const oldKey = makeKey();
      const newKey = makeKey();
      const result = verifyCatalogSignature(CATALOG, signCatalog(CATALOG, newKey), {
        expectedPublicKey: [oldKey.publicKeyHex, newKey.publicKeyHex],
      });

      expect(result.status).toBe('verified');
      expect(result.publicKey).toBe(newKey.publicKeyHex);
    });
  });

  describe('tampering', () => {
    it('rejects a catalog whose bytes changed after signing', () => {
      const key = makeKey();
      const signature = signCatalog(CATALOG, key);

      // Attacker swaps the download URL for one they control.
      const tampered = Buffer.from(
        CATALOG.toString('utf-8').replace('bible_kjv.db', 'https://evil.test/payload.db'),
        'utf-8',
      );

      const result = verifyCatalogSignature(tampered, signature);
      expect(result.status).toBe('invalid');
      expect(isCatalogUsable(result)).toBe(false);
    });

    it('rejects a signature produced by a different key', () => {
      const realKey = makeKey();
      const attackerKey = makeKey();

      // Attacker re-signs their own catalog with their own key - the signature
      // is internally valid, so only the key check catches this.
      const result = verifyCatalogSignature(CATALOG, signCatalog(CATALOG, attackerKey), {
        expectedPublicKey: realKey.publicKeyHex,
      });

      expect(result.status).toBe('untrusted_key');
      expect(result.publicKey).toBe(attackerKey.publicKeyHex);
      expect(isCatalogUsable(result)).toBe(false);
    });

    it('rejects a signature from a key outside the pinned set', () => {
      const pinned = [makeKey().publicKeyHex, makeKey().publicKeyHex];
      const attackerKey = makeKey();

      const result = verifyCatalogSignature(CATALOG, signCatalog(CATALOG, attackerKey), {
        expectedPublicKey: pinned,
      });

      expect(result.status).toBe('untrusted_key');
      expect(isCatalogUsable(result)).toBe(false);
    });

    it('rejects a garbage signature value', () => {
      const key = makeKey();
      const sig = JSON.parse(signCatalog(CATALOG, key));
      sig.signature = 'f'.repeat(128);

      const result = verifyCatalogSignature(CATALOG, JSON.stringify(sig));
      expect(result.status).toBe('invalid');
    });
  });

  describe('unsigned catalogs', () => {
    it('reports unsigned when no .sig was served', () => {
      const result = verifyCatalogSignature(CATALOG, undefined);
      expect(result.status).toBe('unsigned');
      // Unsigned remains usable - cross-origin downloads are what get blocked.
      expect(isCatalogUsable(result)).toBe(true);
    });

    it('treats an empty .sig body as unsigned', () => {
      const result = verifyCatalogSignature(CATALOG, '   ');
      expect(result.status).toBe('unsigned');
    });

    it('rejects a dropped signature when the source previously signed', () => {
      // Downgrade attack: strip the .sig so the client falls back to unsigned.
      const result = verifyCatalogSignature(CATALOG, undefined, { requireSignature: true });
      expect(result.status).toBe('invalid');
      expect(isCatalogUsable(result)).toBe(false);
    });
  });

  describe('malformed signature documents', () => {
    it('errors on unparseable JSON', () => {
      const result = verifyCatalogSignature(CATALOG, '{not json');
      expect(result.status).toBe('error');
    });

    it('errors when required fields are missing', () => {
      const result = verifyCatalogSignature(CATALOG, JSON.stringify({ publicKey: 'ab' }));
      expect(result.status).toBe('error');
    });

    it('errors on an unexpected algorithm', () => {
      const key = makeKey();
      const sig = JSON.parse(signCatalog(CATALOG, key));
      sig.algorithm = 'rsa-sha1';

      const result = verifyCatalogSignature(CATALOG, JSON.stringify(sig));
      expect(result.status).toBe('error');
    });

    it('errors on a wrong-length public key', () => {
      const key = makeKey();
      const sig = JSON.parse(signCatalog(CATALOG, key));
      sig.publicKey = 'abcd';

      const result = verifyCatalogSignature(CATALOG, JSON.stringify(sig));
      expect(result.status).toBe('error');
    });

    it('errors on a non-hex signature', () => {
      const key = makeKey();
      const sig = JSON.parse(signCatalog(CATALOG, key));
      sig.signature = 'z'.repeat(128);

      const result = verifyCatalogSignature(CATALOG, JSON.stringify(sig));
      expect(result.status).toBe('error');
    });
  });

  describe('multiple signatures', () => {
    /** First key is the primary signature; the rest go in `signatures`. */
    function multiSigned(...keys: TestKey[]): string {
      const [primary, ...rest] = keys.map((key) => JSON.parse(signCatalog(CATALOG, key)));
      return JSON.stringify(rest.length > 0 ? { ...primary, signatures: rest } : primary);
    }

    it('accepts the catalog when a later signature is by the pinned key', () => {
      const outgoing = makeKey();
      const incoming = makeKey();
      const result = verifyCatalogSignature(CATALOG, multiSigned(outgoing, incoming), {
        expectedPublicKey: incoming.publicKeyHex,
      });

      expect(result.status).toBe('verified');
      expect(result.publicKey).toBe(incoming.publicKeyHex);
      expect(result.signers).toEqual([outgoing.publicKeyHex, incoming.publicKeyHex]);
    });

    it('keeps the primary readable by apps that predate multiple signatures', () => {
      // Older apps read only the top-level fields; they must verify on their own.
      const outgoing = makeKey();
      const doc = JSON.parse(multiSigned(outgoing, makeKey()));
      delete doc.signatures;

      const result = verifyCatalogSignature(CATALOG, JSON.stringify(doc), {
        expectedPublicKey: outgoing.publicKeyHex,
      });
      expect(result.status).toBe('verified');
    });

    it('lists every signer when none of them is trusted', () => {
      const a = makeKey();
      const b = makeKey();
      const result = verifyCatalogSignature(CATALOG, multiSigned(a, b), {
        expectedPublicKey: makeKey().publicKeyHex,
      });

      expect(result.status).toBe('untrusted_key');
      expect(result.signers).toEqual([a.publicKeyHex, b.publicKeyHex]);
    });

    it('rejects the catalog if any one signature does not verify', () => {
      const pinned = makeKey();
      const doc = JSON.parse(multiSigned(pinned, makeKey()));
      doc.signatures[0].signature = 'f'.repeat(128);

      const result = verifyCatalogSignature(CATALOG, JSON.stringify(doc), {
        expectedPublicKey: pinned.publicKeyHex,
      });
      expect(result.status).toBe('invalid');
    });

    it('errors on a malformed extra signature', () => {
      const doc = JSON.parse(signCatalog(CATALOG, makeKey()));
      doc.signatures = [{ publicKey: 'ab' }];

      expect(verifyCatalogSignature(CATALOG, JSON.stringify(doc)).status).toBe('error');
    });

    it('errors when "signatures" is not an array', () => {
      const doc = JSON.parse(signCatalog(CATALOG, makeKey()));
      doc.signatures = 'nope';

      expect(verifyCatalogSignature(CATALOG, JSON.stringify(doc)).status).toBe('error');
    });

    it(`errors on more than ${MAX_CATALOG_SIGNATURES} signatures`, () => {
      const keys = Array.from({ length: MAX_CATALOG_SIGNATURES + 1 }, () => makeKey());

      expect(verifyCatalogSignature(CATALOG, multiSigned(...keys)).status).toBe('error');
    });
  });

  it('interoperates with an externally produced signature', () => {
    // Mirrors exactly what the CLI writes, including the extra fields, to keep
    // the tool and the verifier from drifting apart.
    const key = makeKey();
    const keyObject = createPrivateKey({
      key: Buffer.concat([PKCS8_PREFIX, Buffer.from(key.privateKeyHex, 'hex')]),
      format: 'der',
      type: 'pkcs8',
    });
    const pubDer = createPublicKey(keyObject).export({ format: 'der', type: 'spki' });

    const cliOutput = JSON.stringify(
      {
        publicKey: pubDer.subarray(pubDer.length - 32).toString('hex'),
        signature: sign(null, createHash('sha256').update(CATALOG).digest(), keyObject).toString('hex'),
        algorithm: 'ed25519-sha256',
        signedAt: '2026-01-01T00:00:00.000Z',
        keyId: 'v1',
      },
      null,
      2,
    );

    expect(verifyCatalogSignature(CATALOG, cliOutput).status).toBe('verified');
  });
});
