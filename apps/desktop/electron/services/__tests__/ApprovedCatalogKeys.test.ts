import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { FileApprovedCatalogKeyStore, type ApprovedCatalogKey } from '../ApprovedCatalogKeys';

const SCOPE = 'https://modules.example.org/';

function approval(publicKey: string, scope = SCOPE): ApprovedCatalogKey {
  return {
    publicKey,
    scope,
    vouchedBy: '11'.repeat(32),
    issued: '2027-03-01T12:00:00Z',
    approvedAt: '2027-03-02T09:00:00Z',
  };
}

describe('FileApprovedCatalogKeyStore', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'approved-keys-'));
    file = path.join(dir, 'catalog-trust', 'approved-keys.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('starts empty when the file does not exist', () => {
    expect(new FileApprovedCatalogKeyStore(file).list(SCOPE)).toEqual([]);
  });

  it('persists approvals across instances, per scope', () => {
    new FileApprovedCatalogKeyStore(file).add(approval('aa'.repeat(32)));
    new FileApprovedCatalogKeyStore(file).add(approval('bb'.repeat(32), 'https://other.example/'));

    const store = new FileApprovedCatalogKeyStore(file);
    expect(store.list(SCOPE)).toEqual(['aa'.repeat(32)]);
    expect(store.list('HTTPS://OTHER.EXAMPLE/')).toEqual(['bb'.repeat(32)]);
  });

  it('trusts nothing from a corrupt file', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{oops');

    expect(new FileApprovedCatalogKeyStore(file).list(SCOPE)).toEqual([]);
  });

  it('drops malformed entries', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify([approval('aa'.repeat(32)), { ...approval('not-a-key') }, 'junk']),
    );

    expect(new FileApprovedCatalogKeyStore(file).list(SCOPE)).toEqual(['aa'.repeat(32)]);
  });
});
