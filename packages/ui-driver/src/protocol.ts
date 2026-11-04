/**
 * Wire helpers shared by the client and the daemon: where the session lives,
 * how a command line is split into argv, and newline-delimited JSON framing.
 * Node built-ins only, so the client stays fast to start.
 */

import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Directory holding the socket, pid file, log and profiles of one session. */
export function sessionDir(session?: string): string {
  if (process.env.DRIVE_DIR) return process.env.DRIVE_DIR;
  return join(tmpdir(), 'bible-ui-driver', session ?? process.env.DRIVE_SESSION ?? 'default');
}

/** Unix socket paths are limited (~108 bytes), so long dirs fall back to a short hashed name in tmp. */
export function socketPath(dir: string): string {
  const p = join(dir, 'drive.sock');
  if (p.length <= 100) return p;
  const h = createHash('sha1').update(dir).digest('hex').slice(0, 8);
  return join(tmpdir(), `bud-${h}.sock`);
}

/** Shell-like split: whitespace, '..' literal, ".." with \" and \\ escapes, backslash escape outside quotes. */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inTok = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end < 0) throw new Error('unterminated quote');
      cur += line.slice(i + 1, end);
      i = end;
      inTok = true;
    } else if (c === '"') {
      i++;
      for (;;) {
        if (i >= line.length) throw new Error('unterminated quote');
        const d = line[i];
        if (d === '"') break;
        if (d === '\\' && (line[i + 1] === '"' || line[i + 1] === '\\')) {
          cur += line[i + 1];
          i += 2;
        } else {
          cur += d;
          i++;
        }
      }
      inTok = true;
    } else if (c === '\\') {
      if (i + 1 < line.length) cur += line[++i];
      inTok = true;
    } else if (/\s/.test(c)) {
      if (inTok) {
        out.push(cur);
        cur = '';
        inTok = false;
      }
    } else {
      cur += c;
      inTok = true;
    }
  }
  if (inTok) out.push(cur);
  return out;
}

/** One input line to argv: a JSON array, a JSON {argv}, or a shell-like line. */
export function parseLine(line: string): string[] {
  const t = line.trim();
  if (!t) return [];
  if (t[0] === '[') return checkArgv(JSON.parse(t));
  if (t[0] === '{') return checkArgv((JSON.parse(t) as { argv?: unknown }).argv);
  return tokenize(t);
}

function checkArgv(v: unknown): string[] {
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) throw new Error('argv must be an array of strings');
  return v as string[];
}

/** One JSON message plus the newline that ends it. */
export function encode(obj: unknown): string {
  return JSON.stringify(obj) + '\n';
}

/** Buffers chunks and calls onLine for each complete line (without the newline). */
export function lineReader(onLine: (line: string) => void): (chunk: string | Buffer) => void {
  let buf = '';
  return (chunk) => {
    buf += chunk.toString();
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      onLine(line);
    }
  };
}
