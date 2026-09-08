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
 * Throw unless `sql` is admissible on an extension-owned database.
 *
 * @param sql   The extension-supplied statement.
 * @param label Call-site label used in the error message (e.g. `storage.db.query`).
 */
export function assertExtensionSqlAllowed(sql: string, label: string): void {
  const stripped = stripCommentsAndLiterals(sql);

  for (const statement of stripped.split(';')) {
    const tokens = statement.match(/[A-Za-z_][A-Za-z0-9_]*/g);
    if (!tokens || tokens.length === 0) continue;

    const keyword = leadingKeyword(tokens);
    if (keyword && FORBIDDEN_STATEMENTS.has(keyword)) {
      throw new RpcProtocolError(
        `${label}: ${keyword.toUpperCase()} is not permitted on an extension database`,
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
