import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runValidateCommand } from '../validateCommand';
import type { SmokeCommandContext } from '../smokeCommand';

interface CapturedCtx extends SmokeCommandContext {
  out: string[];
  err: string[];
}

function makeCtx(cwd: string): CapturedCtx {
  const out: string[] = [];
  const err: string[] = [];
  return {
    cwd,
    out,
    err,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    writeFile: () => undefined,
  };
}

interface ManifestOverrides {
  main?: string;
  uiEntry?: string;
  icon?: string;
}

function writeManifest(root: string, overrides: ManifestOverrides = {}): void {
  const manifest = {
    id: 'ext.test.validate',
    name: { key: 'ext.test.validate' },
    version: '1.2.3',
    publisher: 'test',
    engines: { bibleApp: '^1.0.0' },
    main: overrides.main ?? 'dist/main.js',
    ...(overrides.icon ? { icon: overrides.icon } : {}),
    contributes: {
      panelTypes: [
        {
          id: 'panel',
          title: { key: 'panel' },
          uiEntry: overrides.uiEntry ?? 'ui/index.html',
        },
      ],
    },
  };
  writeFileSync(join(root, 'extension.json'), JSON.stringify(manifest), 'utf8');
}

/** Creates the files a default manifest points at. */
function writeReferencedFiles(root: string): void {
  mkdirSync(join(root, 'dist'), { recursive: true });
  mkdirSync(join(root, 'ui'), { recursive: true });
  writeFileSync(join(root, 'dist', 'main.js'), 'exports.activate = function(){};', 'utf8');
  writeFileSync(join(root, 'ui', 'index.html'), '<!DOCTYPE html>', 'utf8');
}

describe('runValidateCommand', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'validate-cli-'));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('returns 0 and reports id@version for a valid extension', () => {
    writeManifest(workDir);
    writeReferencedFiles(workDir);
    const ctx = makeCtx(workDir);

    expect(runValidateCommand([workDir], ctx)).toBe(0);
    expect(ctx.out.join('')).toContain('ext.test.validate@1.2.3');
  });

  it('defaults to the working directory when no path is given', () => {
    writeManifest(workDir);
    writeReferencedFiles(workDir);
    const ctx = makeCtx(workDir);

    expect(runValidateCommand([], ctx)).toBe(0);
  });

  it('fails when the manifest is missing', () => {
    const ctx = makeCtx(workDir);

    expect(runValidateCommand([workDir], ctx)).toBe(1);
    expect(ctx.err.join('')).toContain('manifest.unreadable');
  });

  it('fails with a parse diagnosis rather than an empty error list on malformed JSON', () => {
    writeFileSync(join(workDir, 'extension.json'), '{ "id": ', 'utf8');
    const ctx = makeCtx(workDir);

    expect(runValidateCommand([workDir], ctx)).toBe(1);
    // The read/parse failure carries no per-field errors; the message itself
    // is the whole diagnosis and must survive into the report.
    expect(ctx.err.join('')).toContain('Invalid JSON');
  });

  it('reports schema errors with their field paths', () => {
    writeFileSync(
      join(workDir, 'extension.json'),
      JSON.stringify({ id: 'not-a-valid-id', version: 'not-semver' }),
      'utf8',
    );
    const ctx = makeCtx(workDir);

    expect(runValidateCommand([workDir], ctx)).toBe(1);
    expect(ctx.err.join('')).toContain('/id');
  });

  it('fails when main points at a file that was never built', () => {
    writeManifest(workDir);
    mkdirSync(join(workDir, 'ui'), { recursive: true });
    writeFileSync(join(workDir, 'ui', 'index.html'), '<!DOCTYPE html>', 'utf8');
    const ctx = makeCtx(workDir);

    expect(runValidateCommand([workDir], ctx)).toBe(1);
    const err = ctx.err.join('');
    expect(err).toContain('asset.missing');
    expect(err).toContain('/main');
  });

  it('fails when a panel uiEntry does not exist', () => {
    writeManifest(workDir, { uiEntry: 'ui/panel.html' });
    writeReferencedFiles(workDir);
    const ctx = makeCtx(workDir);

    expect(runValidateCommand([workDir], ctx)).toBe(1);
    expect(ctx.err.join('')).toContain('/contributes/panelTypes/0/uiEntry');
  });

  it('rejects a manifest path that climbs out of the extension root', () => {
    writeManifest(workDir, { main: '../outside.js' });
    writeReferencedFiles(workDir);
    const ctx = makeCtx(workDir);

    expect(runValidateCommand([workDir], ctx)).toBe(1);
    // Path shape is the validator's job, not the asset check's — this pins
    // that the escape is caught, not which layer catches it a second time.
    expect(ctx.err.join('')).toContain('path.escape');
  });

  it('checks contributed theme, icon, style and font files too', () => {
    const manifest = {
      id: 'ext.test.validate',
      name: { key: 'ext.test.validate' },
      version: '1.2.3',
      publisher: 'test',
      engines: { bibleApp: '^1.0.0' },
      main: 'dist/main.js',
      contributes: {
        styles: [{ path: 'styles/missing.css', scope: 'panel' }],
      },
    };
    writeFileSync(join(workDir, 'extension.json'), JSON.stringify(manifest), 'utf8');
    writeReferencedFiles(workDir);
    const ctx = makeCtx(workDir);

    expect(runValidateCommand([workDir], ctx)).toBe(1);
    expect(ctx.err.join('')).toContain('/contributes/styles/0/path');
  });

  it('passes the manifest but skips file checks under --skip-assets', () => {
    writeManifest(workDir);
    const ctx = makeCtx(workDir);

    expect(runValidateCommand([workDir, '--skip-assets'], ctx)).toBe(0);
  });

  it('emits a JSON report under --json', () => {
    writeManifest(workDir);
    writeReferencedFiles(workDir);
    const ctx = makeCtx(workDir);

    expect(runValidateCommand([workDir, '--json'], ctx)).toBe(0);
    const parsed = JSON.parse(ctx.out.join('')) as { ok: boolean; id: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.id).toBe('ext.test.validate');
  });

  it('prints help and returns 0 for --help', () => {
    const ctx = makeCtx(workDir);

    expect(runValidateCommand(['--help'], ctx)).toBe(0);
    expect(ctx.out.join('')).toContain('bible-ext validate');
  });
});
