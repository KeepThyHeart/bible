/**
 * SQL admission control for extension-owned SQLite databases.
 *
 * An extension holding `storage:database` gets a real SQLite file and may run
 * arbitrary SQL against it. Left unguarded, "arbitrary" includes statements
 * that reach *outside* that file:
 *
 *   ATTACH DATABASE '.../main.db' AS leak;   -- read the app's reference data
 *   ATTACH DATABASE '.../db/other.db' AS x;  -- read another extension's data
 *   PRAGMA journal_mode = ...;               -- reconfigure the connection
 *   VACUUM INTO '.../anywhere.db';           -- write a copy outside the sandbox
 *
 * It also refuses raw transaction control (`BEGIN`, `COMMIT`, `SAVEPOINT`,
 * ...). That is a smaller concern - it corrupts the extension's own data
 * rather than anyone else's - but the reason is the same shape: a statement
 * that moves state the host is separately tracking. See
 * `FORBIDDEN_TRANSACTION_STATEMENTS`.
 *
 * ## What this is NOT
 *
 * It is not an SQL-injection filter, and it cannot become one. By the time a
 * statement reaches this function it is a finished string; whether the
 * extension built it with bound parameters or by concatenating a user's input
 * is no longer recoverable from it, and both produce SQL that is
 * syntactically indistinguishable. Injection inside an extension's own
 * database is the extension author's bug to avoid (bind parameters - the
 * `params` argument on `query` / `queryOne` / `run` exists for exactly this),
 * and its blast radius is that extension's own file, which is why the
 * sandbox boundary above is where the host spends its enforcement.
 *
 * ## Why a parser and not `sqlite3_set_authorizer`
 *
 * The kernel-level fix is an authorizer callback denying `SQLITE_ATTACH`,
 * `SQLITE_DETACH`, and `SQLITE_PRAGMA`. The driver this app uses
 * (`better-sqlite3-multiple-ciphers`) exposes neither `sqlite3_set_authorizer`
 * nor `sqlite3_limit`, so `SQLITE_LIMIT_ATTACHED = 0` is out too. Enforcement
 * therefore happens before the string reaches SQLite.
 *
 * That is weaker than an authorizer in general, but the gap is narrower than
 * it looks, because of a structural property worth stating explicitly:
 * `ExtensionDatabaseRegistry` routes every extension-supplied statement
 * through `ISql.execute` / `queryAll` / `queryOne`, all of which use
 * `db.prepare()`, and `prepare()` rejects multi-statement SQL outright. So the
 * usual way a text filter gets beaten - smuggling a second statement past the
 * check - is already closed by the driver. What remains is a single statement,
 * and the four dangerous forms above can only ever appear as that statement's
 * *leading* keyword. Checking the leading keyword is therefore exact for this
 * grammar, not a heuristic.
 *
 * The tokenizer still strips comments and quoted text first, so
 * `/*x*\/ ATTACH ...` and `SELECT 'attach'` are both classified correctly.
 */

import type { ISql } from '@bible/core';
import { Extensions } from '@bible/core';

import { SqliteProvider } from '../providers/SqliteProvider';

const { RpcProtocolError } = Extensions;

/**
 * Open an extension-owned database with the connection-level hardening that
 * complements the statement guard below.
 *
 * This is the factory `main.ts` hands to `ExtensionDatabaseRegistry`; tests
 * inject a fake `ISql` instead and never reach it.
 */
export function openHardenedExtensionDatabase(
  filePath: string,
  opts: { readonly: boolean },
): ISql {
  const provider = new SqliteProvider(filePath, { readonly: opts.readonly });

  // SQLite runs schema-embedded expressions (view bodies, index expressions,
  // CHECK constraints, generated columns) with elevated trust unless this is
  // off. It defaults ON purely for backwards compatibility. For a file whose
  // schema an untrusted extension fully controls, that default is wrong.
  provider.exec('PRAGMA trusted_schema = OFF');

  if (opts.readonly) {
    // The read-only open already makes SQLite refuse writes; query_only says
    // the same thing at the connection level so the two can't drift apart.
    provider.exec('PRAGMA query_only = ON');
  }

  return provider;
}

/**
 * Statements an extension may never run against its own database. Each of
 * these is only valid in leading position, which is what makes the check exact.
 */
const FORBIDDEN_STATEMENTS: ReadonlySet<string> = new Set([
  'attach',
  'detach',
  'pragma',
  'vacuum',
]);

/**
 * Functions banned wherever they appear, not just in leading position.
 *
 * `load_extension` is an arbitrary-code-execution primitive. SQLite disables
 * the SQL-callable form unless the host calls
 * `sqlite3_enable_load_extension`, which this app never does - so today this
 * is belt over an already-fastened brace. It is listed anyway so a future
 * driver swap or build-flag change cannot silently re-open it.
 */
const FORBIDDEN_FUNCTIONS: ReadonlySet<string> = new Set(['load_extension']);

/**
 * Transaction control, banned for a different reason than the four above.
 *
 * These do not reach outside the file; they desynchronize the host from it.
 * `ExtensionDatabaseRegistry` keeps an `inTransaction` flag per handle so
 * `db.transaction()` can refuse to nest and `closeEntry` can roll back what a
 * crashed extension left open. That flag is host-side bookkeeping, and a raw
 * `BEGIN` through `db.exec` moves SQLite without moving it: the registry then
 * believes no transaction is open, skips the `ROLLBACK` on close, and the
 * extension's writes vanish at close time with no error anywhere. The mirror
 * case - a raw `COMMIT` inside a `db.transaction()` - leaves the registry
 * believing a transaction is still open and turns the next real commit into
 * an "no transaction is active" failure the extension author cannot explain.
 *
 * `SAVEPOINT` belongs here because outside a transaction it starts one, and
 * `RELEASE` of the outermost savepoint commits it.
 *
 * So `db.transaction()` is made the only route - which is also the only route
 * `IExtensionDatabase` documents.
 */
const FORBIDDEN_TRANSACTION_STATEMENTS: ReadonlySet<string> = new Set([
  'begin',
  'commit',
  'rollback',
  'savepoint',
  'release',
]);

/**
 * Throw unless `sql` is admissible on an extension-owned database.
 *
 * @param sql   The extension-supplied statement.
 * @param label Call-site label used in the error message (e.g. `storage.db.query`).
 */
export function assertExtensionSqlAllowed(sql: string, label: string): void {
  const stripped = stripCommentsAndLiterals(sql);

  // Counts only statements that carry tokens, so `; END` and `/*x*/ END` are
  // both recognized as leading rather than trailing.
  let statementIndex = -1;

  for (const statement of stripped.split(';')) {
    const tokens = statement.match(/[A-Za-z_][A-Za-z0-9_]*/g);
    if (!tokens || tokens.length === 0) continue;
    statementIndex++;

    const keyword = leadingKeyword(tokens);
    if (keyword && FORBIDDEN_STATEMENTS.has(keyword)) {
      throw new RpcProtocolError(
        `${label}: ${keyword.toUpperCase()} is not permitted on an extension database`,
      );
    }
    // `END` is COMMIT's alias, but it is also what closes a `CREATE TRIGGER`
    // body - and the `;` separators inside that body make the closing `END`
    // look like a later statement's leading keyword to the split above.
    // Triggers are ordinary things for an extension to create (an FTS5
    // external-content index is built out of three of them), so banning `end`
    // everywhere would false-positive on real code. It is banned only where
    // it can actually mean COMMIT: leading the *first* statement. An `END`
    // reached later can only be closing a body, because `prepare()` refuses
    // multi-statement SQL and would reject anything else before it ran.
    if (keyword && (FORBIDDEN_TRANSACTION_STATEMENTS.has(keyword) ||
        (keyword === 'end' && statementIndex === 0))) {
      throw new RpcProtocolError(
        `${label}: ${keyword.toUpperCase()} is not permitted on an extension database - ` +
          'use db.transaction() so the host can track the transaction',
      );
    }

    for (const token of tokens) {
      if (FORBIDDEN_FUNCTIONS.has(token.toLowerCase())) {
        throw new RpcProtocolError(
          `${label}: ${token} is not permitted on an extension database`,
        );
      }
    }
  }
}

/**
 * The keyword that decides what a statement *does*, skipping an `EXPLAIN` or
 * `EXPLAIN QUERY PLAN` prefix. Neither prefix actually executes the statement
 * it wraps, but resolving through them keeps the classification honest and
 * costs three comparisons.
 */
function leadingKeyword(tokens: string[]): string | undefined {
  let index = 0;
  if (tokens[0]?.toLowerCase() === 'explain') {
    index = 1;
    if (tokens[1]?.toLowerCase() === 'query' && tokens[2]?.toLowerCase() === 'plan') {
      index = 3;
    }
  }
  return tokens[index]?.toLowerCase();
}

/**
 * Blank out comments and quoted runs so keyword detection sees only code.
 *
 * Handles `--` line comments, `/* *\/` block comments, and all four SQLite
 * quoting styles (`'...'`, `"..."`, `` `...` ``, `[...]`). SQLite escapes a
 * quote by doubling it; that needs no special case here, because the doubled
 * quote simply closes one run and opens the next, and both are discarded.
 */
function stripCommentsAndLiterals(sql: string): string {
  let out = '';
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1];

    if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      // A block comment can sit between tokens, so it must not fuse them.
      out += ' ';
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      i++;
      while (i < sql.length && sql[i] !== ch) i++;
      i++;
      out += ' ';
      continue;
    }

    if (ch === '[') {
      i++;
      while (i < sql.length && sql[i] !== ']') i++;
      i++;
      out += ' ';
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}
