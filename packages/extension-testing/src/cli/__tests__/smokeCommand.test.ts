import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runSmokeCommand, type SmokeCommandContext } from '../smokeCommand';

interface CapturedCtx extends SmokeCommandContext {
  out: string[];
  err: string[];
  writes: Map<string, string>;
}

function makeCtx(cwd: string): CapturedCtx {
  const out: string[] = [];
  const err: string[] = [];
  const writes = new Map<string, string>();
  return {
    cwd,
    out,
    err,
    writes,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    writeFile: (path, contents) => {
      writes.set(path, contents);
      writeFileSync(path, contents, 'utf8');
    },
  };
}

function makeExtension(root: string, body: string): void {
  const manifest = {
    id: 'ext.test.cli',
    name: { key: 'ext.test.cli' },
    version: '0.1.0',
    publisher: 'test',
    engines: { bibleApp: '^1.0.0' },
    main: 'index.js',
    contributes: {
      commands: [
        {
          id: 'ext.test.cli.hello',
          title: { key: 'hello' },
          handlerEndpoint: 'sayHello',
        },
      ],
    },
  };
  writeFileSync(join(root, 'extension.json'), JSON.stringify(manifest), 'utf8');
  writeFileSync(join(root, 'index.js'), body, 'utf8');
}

describe('runSmokeCommand', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'smoke-cli-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('returns 0 for a clean extension with only enumerable static contributions', async () => {
    makeExtension(
      workDir,
      `exports.activate = function(api){};`,
    );
    const ctx = makeCtx(workDir);
    const code = await runSmokeCommand([workDir], ctx);
    expect(code).toBe(0);
    const output = ctx.out.join('');
    expect(output).toContain('ext.test.cli');
    expect(output).toContain('0 failed');
  });

  it('returns 1 when an extension hook throws during activation', async () => {
    makeExtension(
      workDir,
      `exports.activate = function(api){ throw new Error('boom during activate'); };`,
    );
    const ctx = makeCtx(workDir);
    const code = await runSmokeCommand([workDir], ctx);
    expect(code).toBe(1);
    expect(ctx.err.join('')).toContain('boom during activate');
  });

  it('returns 1 when a registered event subscriber throws on invocation', async () => {
    const body = `exports.activate = async function(api){
      await api.bible.onDidChangeActiveVerse.subscribe(function(){
        throw new Error('subscriber exploded');
      });
    };`;
    makeExtension(workDir, body);
    const ctx = makeCtx(workDir);
    const code = await runSmokeCommand([workDir], ctx);
    expect(code).toBe(1);
    const output = ctx.out.join('');
    expect(output).toContain('failed');
  });

  it('--json emits a versioned envelope to stdout', async () => {
    makeExtension(workDir, `exports.activate = function(api){};`);
    const ctx = makeCtx(workDir);
    const code = await runSmokeCommand([workDir, '--json'], ctx);
    expect(code).toBe(0);
    const envelope = JSON.parse(ctx.out.join('')) as {
      schemaVersion: number;
      extensionId: string;
      totals: { failed: number };
    };
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.extensionId).toBe('ext.test.cli');
    expect(envelope.totals.failed).toBe(0);
  });

  it('--output writes the report to a file and nothing to stdout', async () => {
    makeExtension(workDir, `exports.activate = function(api){};`);
    const outFile = join(workDir, 'report.json');
    const ctx = makeCtx(workDir);
    const code = await runSmokeCommand([workDir, '--json', `--output=${outFile}`], ctx);
    expect(code).toBe(0);
    expect(ctx.out.join('')).toBe('');
    expect(existsSync(outFile)).toBe(true);
    const contents = readFileSync(outFile, 'utf8');
    const parsed = JSON.parse(contents) as { schemaVersion: number };
    expect(parsed.schemaVersion).toBe(1);
  });

  it('surfaces a clean error (not a stack trace) when --corpus points to a missing file', async () => {
    makeExtension(workDir, `exports.activate = function(api){};`);
    const ctx = makeCtx(workDir);
    const code = await runSmokeCommand(
      [workDir, '--corpus=/nonexistent/path/smoke.corpus.json'],
      ctx,
    );
    expect(code).toBe(1);
    const errText = ctx.err.join('');
    expect(errText).toContain('corpus file not found');
    expect(errText).not.toContain('    at ');
  });

  it('surfaces a clean error when --corpus file is malformed', async () => {
    makeExtension(workDir, `exports.activate = function(api){};`);
    const badCorpus = join(workDir, 'bad.corpus.json');
    writeFileSync(badCorpus, JSON.stringify({ verseIds: ['not-an-int'] }), 'utf8');
    const ctx = makeCtx(workDir);
    const code = await runSmokeCommand([workDir, `--corpus=${badCorpus}`], ctx);
    expect(code).toBe(1);
    const errText = ctx.err.join('');
    expect(errText).toContain('invalid corpus');
    expect(errText).not.toContain('    at ');
  });

  it('--help prints help and returns 0', async () => {
    const ctx = makeCtx(workDir);
    const code = await runSmokeCommand(['--help'], ctx);
    expect(code).toBe(0);
    const help = ctx.out.join('');
    expect(help).toContain('Usage: bible-ext smoke');
    expect(help).toContain('--json');
    expect(help).toContain('--output');
  });

  it('--ascii does not emit unicode glyphs', async () => {
    makeExtension(workDir, `exports.activate = function(api){};`);
    const ctx = makeCtx(workDir);
    const code = await runSmokeCommand([workDir, '--ascii'], ctx);
    expect(code).toBe(0);
    const output = ctx.out.join('');
    expect(output).not.toMatch(/[✓✗○]/);
  });

  it('rejects unknown flags with a clean error', async () => {
    const ctx = makeCtx(workDir);
    const code = await runSmokeCommand(['--bogus'], ctx);
    expect(code).toBe(1);
    expect(ctx.err.join('')).toContain('Unknown flag --bogus');
  });
});
