import { describe, it, expect } from 'vitest';
import { createHash, sign } from 'crypto';

import {
  findVouchedKey,
  vouchMessage,
  MAX_VOUCHES,
  VOUCH_FORMAT,
  VOUCH_MAGIC,
  VOUCH_VERSION,
} from '../CatalogKeyVouches';
import { makeKey, makeVouch, vouchDocument } from './catalogSigningTestHelpers';

const SCOPE = 'https://modules.example.org/';

describe('vouchMessage', () => {
  it('matches the bytes scripts/yubikey-sign.py signs', () => {
    // Pinned test vector - the Python helper builds the same text. If this
    // changes, every vouch already issued stops verifying.
    const message = vouchMessage({
      scope: SCOPE,
      vouchingKey: '11'.repeat(32),
      newKey: 'AB'.repeat(32),
      issued: '2027-03-01T12:00:00Z',
    });

    expect(message.toString('utf-8')).toBe(
      'KTH-BIBLE-KEY-VOUCH-V1\n' +
        'scope: https://modules.example.org/\n' +
        `vouching-key: ${'11'.repeat(32)}\n` +
        `new-key: ${'ab'.repeat(32)}\n` +
        'issued: 2027-03-01T12:00:00Z\n',
    );
  });

  it('can never be the 32-byte digest a catalog signature covers', () => {
    const message = vouchMessage({
      scope: 'https://a/',
      vouchingKey: '00'.repeat(32),
      newKey: '00'.repeat(32),
      issued: '2027-01-01T00:00:00Z',
    });

    expect(message.length).toBeGreaterThan(32);
    expect(message.subarray(0, VOUCH_MAGIC.length).toString('utf-8')).toBe(VOUCH_MAGIC);
  });
});

describe('findVouchedKey', () => {
  it('finds a signer vouched for by a trusted key', () => {
    const trusted = makeKey();
    const next = makeKey();

    const found = findVouchedKey(vouchDocument(makeVouch(trusted, next.publicKeyHex, SCOPE)), {
      trustedKeys: [trusted.publicKeyHex],
      signers: [next.publicKeyHex],
      scope: SCOPE,
    });

    expect(found?.newKey).toBe(next.publicKeyHex);
    expect(found?.chain.map((vouch) => vouch.vouchingKey)).toEqual([trusted.publicKeyHex]);
  });

  it('follows a chain of vouches across several rotations', () => {
    const first = makeKey();
    const second = makeKey();
    const third = makeKey();
    const doc = vouchDocument(
      makeVouch(second, third.publicKeyHex, SCOPE),
      makeVouch(first, second.publicKeyHex, SCOPE),
    );

    const found = findVouchedKey(doc, {
      trustedKeys: [first.publicKeyHex],
      signers: [third.publicKeyHex],
      scope: SCOPE,
    });

    expect(found?.newKey).toBe(third.publicKeyHex);
    expect(found?.chain.map((vouch) => vouch.vouchingKey)).toEqual([
      first.publicKeyHex,
      second.publicKeyHex,
    ]);
  });

  it('ignores a vouch from a key that is not trusted', () => {
    const trusted = makeKey();
    const rogue = makeKey();
    const rogueNext = makeKey();

    const found = findVouchedKey(vouchDocument(makeVouch(rogue, rogueNext.publicKeyHex, SCOPE)), {
      trustedKeys: [trusted.publicKeyHex],
      signers: [rogueNext.publicKeyHex],
      scope: SCOPE,
    });

    expect(found).toBeUndefined();
  });

  it('ignores a vouch issued for another scope', () => {
    const trusted = makeKey();
    const next = makeKey();

    const found = findVouchedKey(
      vouchDocument(makeVouch(trusted, next.publicKeyHex, 'https://elsewhere.example/')),
      { trustedKeys: [trusted.publicKeyHex], signers: [next.publicKeyHex], scope: SCOPE },
    );

    expect(found).toBeUndefined();
  });

  it('ignores a vouch whose contents were altered after signing', () => {
    const trusted = makeKey();
    const next = makeKey();
    const rogue = makeKey();
    const forged = { ...makeVouch(trusted, next.publicKeyHex, SCOPE), newKey: rogue.publicKeyHex };

    const found = findVouchedKey(vouchDocument(forged), {
      trustedKeys: [trusted.publicKeyHex],
      signers: [rogue.publicKeyHex],
      scope: SCOPE,
    });

    expect(found).toBeUndefined();
  });

  it('refuses a catalog signature passed off as a vouch', () => {
    // The file-swap attack: trick the trusted key into signing "a catalog"
    // whose bytes are the vouch text, then reuse that signature as a vouch. A
    // catalog signature covers a 32-byte digest, so it cannot verify over the
    // vouch text itself.
    const trusted = makeKey();
    const rogue = makeKey();
    const unsigned = {
      vouchingKey: trusted.publicKeyHex,
      newKey: rogue.publicKeyHex,
      scope: SCOPE,
      issued: '2027-03-01T12:00:00Z',
    };
    const digest = createHash('sha256').update(vouchMessage(unsigned)).digest();
    const catalogStyleSignature = sign(null, digest, trusted.privateKey).toString('hex');

    const found = findVouchedKey(vouchDocument({ ...unsigned, signature: catalogStyleSignature }), {
      trustedKeys: [trusted.publicKeyHex],
      signers: [rogue.publicKeyHex],
      scope: SCOPE,
    });

    expect(found).toBeUndefined();
  });

  it('does not report a signer that is already trusted', () => {
    const trusted = makeKey();
    const next = makeKey();

    const found = findVouchedKey(vouchDocument(makeVouch(trusted, next.publicKeyHex, SCOPE)), {
      trustedKeys: [trusted.publicKeyHex],
      signers: [trusted.publicKeyHex],
      scope: SCOPE,
    });

    expect(found).toBeUndefined();
  });

  it('ignores documents that are not key-vouch documents', () => {
    const trusted = makeKey();
    const next = makeKey();
    const vouch = makeVouch(trusted, next.publicKeyHex, SCOPE);
    const options = { trustedKeys: [trusted.publicKeyHex], signers: [next.publicKeyHex], scope: SCOPE };

    expect(findVouchedKey('{not json', options)).toBeUndefined();
    expect(
      findVouchedKey(JSON.stringify({ format: 'other', version: VOUCH_VERSION, vouches: [vouch] }), options),
    ).toBeUndefined();
    expect(
      findVouchedKey(JSON.stringify({ format: VOUCH_FORMAT, version: 2, vouches: [vouch] }), options),
    ).toBeUndefined();
    expect(
      findVouchedKey(vouchDocument(...Array.from({ length: MAX_VOUCHES + 1 }, () => vouch)), options),
    ).toBeUndefined();
  });

  it('skips malformed entries without discarding the valid ones', () => {
    const trusted = makeKey();
    const next = makeKey();
    const malformed = { ...makeVouch(trusted, next.publicKeyHex, SCOPE), issued: 'last Tuesday' };

    const found = findVouchedKey(
      JSON.stringify({
        format: VOUCH_FORMAT,
        version: VOUCH_VERSION,
        vouches: [malformed, { newKey: 'zz' }, makeVouch(trusted, next.publicKeyHex, SCOPE)],
      }),
      { trustedKeys: [trusted.publicKeyHex], signers: [next.publicKeyHex], scope: SCOPE },
    );

    expect(found?.newKey).toBe(next.publicKeyHex);
  });
});
