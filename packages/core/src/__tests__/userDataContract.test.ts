import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { userDataContract } from './contracts/userDataContract';
import { UserDataRepository } from '../Data/Repositories/UserDataRepository';
import { VerseLinkRepository } from '../Data/Repositories/VerseLinkRepository';
import { MemoryUserDb } from '../UserData';
import { UserTestHelper } from './helpers/UserTestHelper';

const harness = { describe, it, expect, beforeEach, afterEach };

// Desktop: the SQLite repositories over the real user schema.
userDataContract(harness, 'SQLite (desktop)', () => {
  UserTestHelper.initialize();
  const sql = UserTestHelper.getProvider();
  return { items: new UserDataRepository(sql), links: new VerseLinkRepository(sql), dispose: () => UserTestHelper.cleanup() };
});

// Web core: the same interfaces over memory.
userDataContract(harness, 'MemoryUserDb (web)', () => {
  const db = new MemoryUserDb();
  return { items: db.items, links: db.links };
});
