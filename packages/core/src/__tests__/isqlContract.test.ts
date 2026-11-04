import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isqlContract } from './contracts/isqlContract';
import { TestSqliteProvider } from './helpers/TestSqliteProvider';

isqlContract({ describe, it, expect, beforeEach, afterEach } as never, 'TestSqliteProvider (better-sqlite3)', () => new TestSqliteProvider(':memory:'));
