import { test, expect } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const hasPhp = spawnSync('php', ['-v']).status === 0;
let srv: ChildProcess;

test.beforeAll(async () => {
  if (!hasPhp) return;
  const dir = mkdtempSync(join(tmpdir(), 'vh-'));
  const conf = join(dir, 'c.php');
  writeFileSync(conf, `<?php return ['translations' => ['KJV' => ${JSON.stringify(resolve('test/fixtures/mini.db'))}]];`);
  srv = spawn('php', ['-S', '127.0.0.1:4174', '-t', 'php'], { env: { ...process.env, VH_CONFIG: conf }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
});
test.afterAll(() => srv?.kill());

test('PHP endpoint source: hover shows the verse (cross-origin, CORS *)', async ({ page }) => {
  test.skip(!hasPhp, 'php not installed');
  const cfg = { source: { type: 'php', url: 'http://127.0.0.1:4174/verse-hover.php' }, translation: 'KJV', context: 1 };
  await page.goto(`/demo/article.html?cfg=${encodeURIComponent(JSON.stringify(cfg))}`);
  await page.waitForFunction(() => !!(window as any).__vhUi);
  await page.locator('.vh-ref', { hasText: 'John 3:16' }).first().hover();
  const pop = page.locator('.vh-pop.vh-pop--open');
  await expect(pop).toContainText('For God so loved the world');
  await expect(pop.locator('.vh-v--ctx')).toHaveCount(2);
});
