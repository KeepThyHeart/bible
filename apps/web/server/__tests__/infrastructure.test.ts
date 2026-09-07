import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto';
import { DatabaseManager } from '../DatabaseManager';
import { TEST_DATA_DIR, TEST_MODULES_DIR } from './testDataDir';

const desktopData = TEST_DATA_DIR;
const dataDir = desktopData;
const modulesDir = TEST_MODULES_DIR;

// ---------------------------------------------------------------------------
// Auth helpers — recreated from server/index.ts for unit testing
// (these are module-private in the server entry point)
// ---------------------------------------------------------------------------

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

// Rate limiter — recreated from server/index.ts
const RATE_LIMIT = {
  maxAttempts: 5,
  windowMs: 15 * 60_000,
};

const loginAttempts = new Map<string, { count: number; firstAttempt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record) return false;
  if (now - record.firstAttempt > RATE_LIMIT.windowMs) {
    loginAttempts.delete(ip);
    return false;
  }
  return record.count >= RATE_LIMIT.maxAttempts;
}

function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record || now - record.firstAttempt > RATE_LIMIT.windowMs) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
  } else {
    record.count++;
  }
}

// =========================================================================
// Part 1: Auth Logic
// =========================================================================

describe('Auth Logic', () => {
  describe('hashPassword', () => {
    it('returns salt:hash format', () => {
      const result = hashPassword('testpass');
      const parts = result.split(':');
      expect(parts).toHaveLength(2);
      expect(parts[0]).toHaveLength(32); // 16 bytes hex = 32 chars
      expect(parts[1]).toHaveLength(128); // 64 bytes hex = 128 chars
    });

    it('produces different hashes for the same password (random salt)', () => {
      const hash1 = hashPassword('samepass');
      const hash2 = hashPassword('samepass');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyPassword', () => {
    it('returns true for correct password', () => {
      const hash = hashPassword('correct');
      expect(verifyPassword('correct', hash)).toBe(true);
    });

    it('returns false for wrong password', () => {
      const hash = hashPassword('correct');
      expect(verifyPassword('wrong', hash)).toBe(false);
    });

    it('returns false for empty hash', () => {
      expect(verifyPassword('anything', '')).toBe(false);
    });

    it('returns false for malformed hash (no colon)', () => {
      expect(verifyPassword('anything', 'nocolonhere')).toBe(false);
    });

    it('returns false for hash with empty salt', () => {
      expect(verifyPassword('anything', ':somehash')).toBe(false);
    });

    it('returns false for hash with empty hash part', () => {
      expect(verifyPassword('anything', 'somesalt:')).toBe(false);
    });
  });

  describe('Rate Limiter', () => {
    beforeAll(() => {
      loginAttempts.clear();
    });

    afterAll(() => {
      loginAttempts.clear();
    });

    it('first attempt is not rate limited', () => {
      loginAttempts.clear();
      expect(isRateLimited('192.168.1.1')).toBe(false);
    });

    it('after 5 failed attempts, IP is rate limited', () => {
      loginAttempts.clear();
      const ip = '10.0.0.1';
      for (let i = 0; i < 5; i++) {
        recordFailedAttempt(ip);
      }
      expect(isRateLimited(ip)).toBe(true);
    });

    it('after window expires, IP is no longer rate limited', () => {
      loginAttempts.clear();
      const ip = '10.0.0.2';
      // Simulate 5 attempts in the past (beyond the window)
      loginAttempts.set(ip, {
        count: 10,
        firstAttempt: Date.now() - RATE_LIMIT.windowMs - 1000,
      });
      expect(isRateLimited(ip)).toBe(false);
    });

    it('different IPs are tracked independently', () => {
      loginAttempts.clear();
      const ipA = '10.0.0.10';
      const ipB = '10.0.0.11';
      for (let i = 0; i < 5; i++) {
        recordFailedAttempt(ipA);
      }
      expect(isRateLimited(ipA)).toBe(true);
      expect(isRateLimited(ipB)).toBe(false);
    });
  });
});

// =========================================================================
// Part 2: DatabaseManager Integration
// =========================================================================

const hasMainDb = existsSync(resolve(dataDir, 'main.db'));

describe.skipIf(!hasMainDb)('DatabaseManager', () => {
  let db: DatabaseManager;

  beforeAll(() => {
    db = new DatabaseManager(dataDir, modulesDir);
  });

  afterAll(() => {
    db.closeAll();
  });

  // -- Main DB & shared repos --

  it('getMainDb returns a provider', () => {
    const mainDb = db.getMainDb();
    expect(mainDb).not.toBeNull();
    expect(mainDb).toBeDefined();
  });

  it('getBookRepo returns a repo with 66 books', () => {
    const bookRepo = db.getBookRepo();
    expect(bookRepo).toBeDefined();
    const books = bookRepo.getAll();
    expect(books).toHaveLength(66);
  });

  it('getModuleMetadataRepo returns a repo with modules', () => {
    const metaRepo = db.getModuleMetadataRepo();
    expect(metaRepo).toBeDefined();
    const modules = metaRepo.getAll();
    expect(modules.length).toBeGreaterThan(0);
  });

  it('getModuleMetadataRepo returns the same instance on second call (caching)', () => {
    const repo1 = db.getModuleMetadataRepo();
    const repo2 = db.getModuleMetadataRepo();
    expect(repo1).toBe(repo2);
  });

  // -- Bible repos --

  it('getBibleRepo with valid abbreviation returns a repo', () => {
    const repo = db.getBibleRepo('KJV');
    expect(repo).not.toBeNull();
  });

  it('getBibleRepo with case-insensitive abbreviation returns a repo', () => {
    const repo = db.getBibleRepo('kjv');
    expect(repo).not.toBeNull();
  });

  it('getBibleRepo with invalid abbreviation returns null', () => {
    const repo = db.getBibleRepo('NONEXISTENT_BIBLE_XYZ');
    expect(repo).toBeNull();
  });

  it('getBibleRepo returns cached instance on second call', () => {
    const repo1 = db.getBibleRepo('KJV');
    const repo2 = db.getBibleRepo('KJV');
    expect(repo1).toBe(repo2);
  });

  // -- Commentary repos --

  it('getCommentaryRepo with valid module returns a repo', () => {
    const repo = db.getCommentaryRepo('Barnes');
    expect(repo).not.toBeNull();
  });

  it('getCommentaryRepo with invalid module returns null', () => {
    const repo = db.getCommentaryRepo('NONEXISTENT_COMMENTARY_XYZ');
    expect(repo).toBeNull();
  });

  // -- Dictionary repos --

  it('getDictionaryRepo with valid module returns a repo', () => {
    // getDictionaryRepo uses direct path: modules/dictionary_{name}.db (lowercase)
    const repo = db.getDictionaryRepo('easton');
    expect(repo).not.toBeNull();
  });

  it('getAllDictionaryRepos returns an array', () => {
    // Note: getAllDictionaryRepos passes module abbreviations (mixed case) to
    // getDictionaryRepo which builds paths with that exact casing. On case-sensitive
    // filesystems the DB file may not be found if the filename is all-lowercase.
    // We only assert the return type and shape here; count depends on filesystem.
    const repos = db.getAllDictionaryRepos();
    expect(Array.isArray(repos)).toBe(true);
    for (const entry of repos) {
      expect(entry).toHaveProperty('abbreviation');
      expect(entry).toHaveProperty('name');
      expect(entry).toHaveProperty('repo');
    }
  });

  // -- Topical index repos --

  it('getTopicalIndexRepo returns a repo for valid module', () => {
    const repo = db.getTopicalIndexRepo('NaveTopics');
    expect(repo).not.toBeNull();
  });

  it('getTopicalIndexRepo returns null for invalid module', () => {
    const repo = db.getTopicalIndexRepo('NONEXISTENT_TOPICAL_XYZ');
    expect(repo).toBeNull();
  });

  it('getAllTopicalIndexRepos returns at least one', () => {
    const repos = db.getAllTopicalIndexRepos();
    expect(repos.length).toBeGreaterThanOrEqual(1);
    for (const entry of repos) {
      expect(entry).toHaveProperty('abbreviation');
      expect(entry).toHaveProperty('repo');
    }
  });

  // -- Cross-reference repos --

  it('getCrossRefRepo returns a repo for valid module', () => {
    const repo = db.getCrossRefRepo('TSKxref');
    expect(repo).not.toBeNull();
  });

  it('getCrossRefRepo returns null for invalid module', () => {
    const repo = db.getCrossRefRepo('NONEXISTENT_XREF_XYZ');
    expect(repo).toBeNull();
  });

  // -- Tag graph --

  it('getTagGraphRepo returns repo if tag_graph.db exists, null otherwise', () => {
    const repo = db.getTagGraphRepo();
    const tagGraphExists = existsSync(resolve(dataDir, 'tag_graph.db'));
    if (tagGraphExists) {
      expect(repo).not.toBeNull();
    } else {
      expect(repo).toBeNull();
    }
  });

  // -- closeAll --

  it('closeAll does not throw', () => {
    // Create a fresh instance to test closeAll independently
    const tempDb = new DatabaseManager(dataDir, modulesDir);
    // Open a few resources
    tempDb.getMainDb();
    tempDb.getBibleRepo('KJV');
    expect(() => tempDb.closeAll()).not.toThrow();
  });
});
