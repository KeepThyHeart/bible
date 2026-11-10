/**
 * Offline meaning-search pack: the paths that need no semantic index.
 *
 * A machine without a pack must say so, and a bad sideloaded pack (empty folder, broken
 * manifest, wrong digest, missing file, not an archive) must produce a readable error, leave
 * nothing installed, and leave the app usable. The native file picker is replaced in the main
 * process, so no real pack, download or remote server is involved.
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import { test, expect } from '../fixtures/electron.fixture';

async function openFeaturePacks(window: Page): Promise<void> {
  await window.waitForFunction(
    () => globalThis.__services?.registry.list().some(c => c.id === 'module.openManager'),
    null,
    { timeout: 15000 },
  );
  await window.evaluate(() => globalThis.__services!.registry.execute('module.openManager'));
  await window.locator('[data-testid="module-manager-features-tab"]').click();
  await expect(window.locator('[data-testid="feature-pack-panel"]')).toBeVisible();
}

/** Make the native picker answer with `filePath` from now on, whatever its options. */
async function pickNext(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog;
  }, filePath);
}

const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

const MODEL = Buffer.from('{}');
const MODEL_PATH = 'models/Xenova/nomic-embed-text-v1/config.json';

function manifest(index: Buffer, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 'bible-feature-pack@1',
    pack_id: 'semantic-fake',
    pack_type: 'semantic_search',
    name: 'Fake semantic pack',
    version: '1.0.0',
    description: 'Test pack that must never install.',
    license: 'CC-BY-4.0',
    installed_size_bytes: index.length + MODEL.length,
    artifacts: [
      { kind: 'index', path: 'semantic_index.db', size_bytes: index.length, sha256: sha(index) },
      { kind: 'model', path: MODEL_PATH, size_bytes: MODEL.length, sha256: sha(MODEL) },
    ],
    ...overrides,
  };
}

test.describe('Meaning-search pack without an index', () => {
  let scratch: string;
  test.beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bible-e2e-pack-'));
  });
  test.afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  async function semanticAvailable(window: Page): Promise<boolean> {
    return window.evaluate(async () => {
      const r = await (window as unknown as { electron: { search: { semanticAvailable: () => Promise<unknown> } } })
        .electron.search.semanticAvailable() as { ok?: boolean; value?: unknown };
      return r.ok === true && r.value === true;
    });
  }

  test('reports not installed, offers sideloading, and shows no semantic toggle', async ({ window }) => {
    expect(await semanticAvailable(window)).toBe(false);
    await openFeaturePacks(window);
    await expect(window.locator('[data-testid="feature-pack-installed-badge"]')).toHaveCount(0);
    await expect(window.locator('[data-testid="feature-pack-sideload-file"]')).toBeVisible();
    await expect(window.locator('[data-testid="feature-pack-sideload-folder"]')).toBeVisible();
  });

  const folderCases: Array<{ name: string; build: (dir: string) => void; message: RegExp }> = [
    {
      name: 'a folder that is not a pack',
      build: dir => fs.writeFileSync(path.join(dir, 'readme.txt'), 'hello'),
      message: /feature-pack\.json|not a feature pack|feature pack/i,
    },
    {
      name: 'a manifest that is not JSON',
      build: dir => fs.writeFileSync(path.join(dir, 'feature-pack.json'), '{ nope'),
      message: /not valid JSON/i,
    },
    {
      name: 'a manifest from a future format',
      build: dir => {
        const body = Buffer.from('x');
        fs.writeFileSync(path.join(dir, 'feature-pack.json'), JSON.stringify(manifest(body, { format: 'bible-feature-pack@2' })));
        fs.writeFileSync(path.join(dir, 'semantic_index.db'), body);
        fs.mkdirSync(path.join(dir, path.dirname(MODEL_PATH)), { recursive: true });
        fs.writeFileSync(path.join(dir, MODEL_PATH), MODEL);
      },
      message: /not a valid feature pack|format/i,
    },
    {
      name: 'a file whose digest does not match',
      build: dir => {
        const declared = Buffer.from('declared bytes');
        fs.writeFileSync(path.join(dir, 'feature-pack.json'), JSON.stringify(manifest(declared)));
        fs.writeFileSync(path.join(dir, 'semantic_index.db'), Buffer.from('declared bytez'));
        fs.mkdirSync(path.join(dir, path.dirname(MODEL_PATH)), { recursive: true });
        fs.writeFileSync(path.join(dir, MODEL_PATH), MODEL);
      },
      message: /digest|checksum|sha|match|hash/i,
    },
    {
      name: 'a listed file that is missing',
      build: dir => {
        fs.writeFileSync(path.join(dir, 'feature-pack.json'), JSON.stringify(manifest(Buffer.from('abc'))));
      },
      message: /missing|not contain|no file|not found/i,
    },
  ];

  for (const c of folderCases) {
    test(`sideload of ${c.name} fails readably and installs nothing`, async ({ window, electronApp }) => {
      const dir = path.join(scratch, 'pack');
      fs.mkdirSync(dir);
      c.build(dir);
      await openFeaturePacks(window);
      await pickNext(electronApp, dir);
      await window.locator('[data-testid="feature-pack-sideload-folder"]').click();

      const error = window.locator('[data-testid="feature-pack-sideload-error"]');
      await expect(error).toBeVisible({ timeout: 15000 });
      await expect(error).toHaveText(c.message);
      // Optional demo capture (DEMO_DIR): what the user sees for a bad pack.
      if (process.env.DEMO_DIR && c.name.includes('digest')) {
        await window.screenshot({ path: path.join(process.env.DEMO_DIR, 'meaning-pack-bad-sideload-error.png') });
      }
      // Readable: no stack trace, no raw error-code prefix.
      await expect(error).not.toHaveText(/\bat \S+ \(|node_modules|^[a-z_]+: /);
      await expect(window.locator('[data-testid="feature-pack-installed-badge"]')).toHaveCount(0);
      expect(await semanticAvailable(window)).toBe(false);
      // The sideload controls are usable again after the failure.
      await expect(window.locator('[data-testid="feature-pack-sideload-folder"]')).toBeEnabled();
    });
  }

  for (const [label, bytes] of [
    ['a file of garbage bytes', new Uint8Array(randomBytes(4096))],
    ['an empty file', new Uint8Array(0)],
    ['a text file renamed .biblepack', new TextEncoder().encode('this is not a zip archive')],
  ] as const) {
    test(`sideload of ${label} fails readably and installs nothing`, async ({ window, electronApp }) => {
      const file = path.join(scratch, 'bad.biblepack');
      fs.writeFileSync(file, bytes);
      await openFeaturePacks(window);
      await pickNext(electronApp, file);
      await window.locator('[data-testid="feature-pack-sideload-file"]').click();

      const error = window.locator('[data-testid="feature-pack-sideload-error"]');
      await expect(error).toBeVisible({ timeout: 15000 });
      await expect(error).not.toHaveText(/\bat \S+ \(|node_modules/);
      await expect(window.locator('[data-testid="feature-pack-installed-badge"]')).toHaveCount(0);
      expect(await semanticAvailable(window)).toBe(false);
    });
  }

  test('cancelling the picker is not an error', async ({ window, electronApp }) => {
    await openFeaturePacks(window);
    await electronApp.evaluate(({ dialog }) => {
      dialog.showOpenDialog = (async () => ({ canceled: true, filePaths: [] })) as typeof dialog.showOpenDialog;
    });
    await window.locator('[data-testid="feature-pack-sideload-folder"]').click();
    await window.waitForTimeout(1500); // an async failure would surface within this
    await expect(window.locator('[data-testid="feature-pack-sideload-error"]')).toHaveCount(0);
    await expect(window.locator('[data-testid="feature-pack-error"]')).toHaveCount(0);
  });
});
