/**
 * Catalog + blocklist validation tests (Phase 4).
 *
 * Both documents are fetched over HTTP from a party the user chose to trust
 * to *some* degree, so every test here is really asking the same question:
 * when the document is wrong, does the app fail in the direction that keeps
 * the user safe?
 *
 * The two documents answer that differently on purpose, and the tests pin the
 * difference:
 *   - a broken catalog entry is dropped (the rest of the catalog still works)
 *   - a broken blocklist entry is dropped but the document still applies
 *     (refusing to parse would leave known-bad extensions running)
 */

import { describe, it, expect } from 'vitest';

import {
  EXTENSION_CATALOG_FORMAT,
  EXTENSION_BLOCKLIST_FORMAT,
  validateExtensionCatalog,
  validateCatalogEntry,
  validateExtensionBlocklist,
} from './ExtensionCatalog';

const GOOD_SHA = 'a'.repeat(64);

function entry(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ext.example.hello',
    version: '1.0.0',
    name: 'Hello',
    downloadUrl: 'https://example.com/hello-1.0.0.zip',
    sha256: GOOD_SHA,
    ...over,
  };
}

function catalog(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: EXTENSION_CATALOG_FORMAT,
    name: 'Example Catalog',
    extensions: [entry()],
    ...over,
  };
}

describe('validateExtensionCatalog', () => {
  it('accepts a well-formed catalog', () => {
    const res = validateExtensionCatalog(catalog({ homepage: 'https://example.com' }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.name).toBe('Example Catalog');
    expect(res.value.homepage).toBe('https://example.com');
    expect(res.value.extensions).toHaveLength(1);
    expect(res.value.extensions[0]?.id).toBe('ext.example.hello');
  });

  it('accepts an empty catalog', () => {
    // Distinct from a parse failure, and the caller must be able to tell them
    // apart - "this catalog offers nothing yet" is a normal state for a new
    // marketplace.
    const res = validateExtensionCatalog(catalog({ extensions: [] }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.extensions).toEqual([]);
  });

  it('rejects a document that is not an object', () => {
    for (const bad of [null, 'catalog', 42, ['a']]) {
      expect(validateExtensionCatalog(bad).ok).toBe(false);
    }
  });

  it('rejects an unknown format marker instead of guessing', () => {
    const res = validateExtensionCatalog(catalog({ format: 2 }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors[0]).toContain('catalog.format');
  });

  it('drops a malformed entry but keeps the rest of the catalog', () => {
    // One bad listing must not make the other listings un-installable.
    const res = validateExtensionCatalog(
      catalog({ extensions: [entry(), { id: 'broken' }, entry({ id: 'ext.example.two' })] }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.extensions.map((e) => e.id)).toEqual([
      'ext.example.hello',
      'ext.example.two',
    ]);
  });

  it('fails the document when `extensions` is not an array', () => {
    const res = validateExtensionCatalog(catalog({ extensions: { id: 'x' } }));
    expect(res.ok).toBe(false);
  });
});

describe('validateCatalogEntry', () => {
  it('requires the install-critical fields', () => {
    for (const field of ['id', 'version', 'name', 'downloadUrl', 'sha256']) {
      const res = validateCatalogEntry(entry({ [field]: undefined }), 'e');
      expect(res.ok, `${field} should be required`).toBe(false);
    }
  });

  it('refuses a non-https download URL', () => {
    // The gateway would refuse the downgrade anyway; catching it here means
    // the user sees the problem while looking at the catalog rather than
    // halfway through an install.
    for (const url of ['http://example.com/a.zip', 'file:///tmp/a.zip', 'ftp://x/a.zip']) {
      const res = validateCatalogEntry(entry({ downloadUrl: url }), 'e');
      expect(res.ok, url).toBe(false);
      if (res.ok) continue;
      expect(res.errors.join()).toContain('https');
    }
  });

  it('refuses a hash that is not 64 hex characters', () => {
    for (const sha of ['', 'abc', 'z'.repeat(64), GOOD_SHA.slice(0, 63)]) {
      expect(validateCatalogEntry(entry({ sha256: sha }), 'e').ok, sha).toBe(false);
    }
  });

  it('normalizes the hash to lowercase', () => {
    // So the comparison against the computed digest stays a plain equality.
    const res = validateCatalogEntry(entry({ sha256: 'A'.repeat(64) }), 'e');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.sha256).toBe('a'.repeat(64));
  });

  it('keeps optional listing metadata when present and omits it when absent', () => {
    const withMeta = validateCatalogEntry(
      entry({
        description: 'Says hello',
        publisher: 'Example Co',
        sizeBytes: 2048,
        permissions: ['bible:read', 42],
        engines: '^1.0.0',
        publisherKey: 'ff'.repeat(32),
      }),
      'e',
    );
    expect(withMeta.ok).toBe(true);
    if (!withMeta.ok) return;
    expect(withMeta.value.description).toBe('Says hello');
    expect(withMeta.value.sizeBytes).toBe(2048);
    // Non-string permission entries are filtered rather than failing the entry.
    expect(withMeta.value.permissions).toEqual(['bible:read']);

    const bare = validateCatalogEntry(entry(), 'e');
    expect(bare.ok).toBe(true);
    if (!bare.ok) return;
    expect(bare.value.description).toBeUndefined();
    expect(bare.value.sizeBytes).toBeUndefined();
  });
});

describe('validateExtensionBlocklist', () => {
  it('accepts a well-formed blocklist', () => {
    const res = validateExtensionBlocklist({
      format: EXTENSION_BLOCKLIST_FORMAT,
      entries: [
        { id: 'ext.bad.one', versions: '>=1.4.0 <1.4.3', reason: 'Leaks notes', url: 'https://x' },
        { id: 'ext.bad.two', reason: 'Malicious' },
      ],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.entries).toHaveLength(2);
    expect(res.value.entries[0]?.versions).toBe('>=1.4.0 <1.4.3');
    // No `versions` means every version - the right default for "malicious".
    expect(res.value.entries[1]?.versions).toBeUndefined();
  });

  it('requires a reason on every entry', () => {
    // An extension that refuses to run without saying why is a support ticket.
    const res = validateExtensionBlocklist({
      format: EXTENSION_BLOCKLIST_FORMAT,
      entries: [{ id: 'ext.bad.one' }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.entries).toEqual([]);
  });

  it('keeps the readable rules when one entry is malformed', () => {
    // Inverse of the catalog's bias: dropping the whole document would leave
    // known-bad extensions running.
    const res = validateExtensionBlocklist({
      format: EXTENSION_BLOCKLIST_FORMAT,
      entries: [{ id: 'ext.ok', reason: 'bad' }, 'not-an-object', { reason: 'no id' }],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.entries.map((e) => e.id)).toEqual(['ext.ok']);
  });

  it('rejects a wrong format marker rather than applying rules it may misread', () => {
    const res = validateExtensionBlocklist({ format: 99, entries: [] });
    expect(res.ok).toBe(false);
  });

  it('accepts an empty blocklist as "nothing is blocked"', () => {
    const res = validateExtensionBlocklist({ format: EXTENSION_BLOCKLIST_FORMAT, entries: [] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.entries).toEqual([]);
  });
});
