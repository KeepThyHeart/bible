/** Download a file into the cache once (temp name + rename), with retries and a curl fallback. */

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, statSync } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { threadId } from 'node:worker_threads';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

async function viaFetch(url: string, tmp: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
}

function viaCurl(url: string, tmp: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn('curl', ['-fsSL', '--retry', '3', '--connect-timeout', '30', '-o', tmp, url], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    c.stderr.on('data', d => { err += String(d); });
    c.on('error', reject);
    c.on('close', code => (code === 0 ? resolve() : reject(new Error(`curl failed (${code}): ${err.trim()}`))));
  });
}

/** Resolves to `dest`. Skips the download when a non-empty file is already there. */
export async function ensureDownloaded(url: string, dest: string, log: (m: string) => void = () => {}): Promise<string> {
  if (existsSync(dest) && statSync(dest).size > 0) return dest;
  await mkdir(dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${process.pid}-${threadId}-${randomBytes(4).toString('hex')}`;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      log(`downloading ${url}`);
      try { await viaFetch(url, tmp); } catch (e) { lastError = e; await viaCurl(url, tmp); }
      await rename(tmp, dest);
      return dest;
    } catch (e) {
      lastError = e;
      await rm(tmp, { force: true });
      await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }
  throw new Error(`Could not download ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
