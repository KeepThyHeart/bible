/** New Tab page (task 0200): pane tiles first, the Apps group below them. */
import { test, expect } from '../fixtures/electron.fixture';
import path from 'path';

test('New Tab page lists the pane tiles above the Apps group', async ({ window }) => {
  await expect(window.locator('[data-testid="app-loaded"]')).toBeVisible({ timeout: 20000 });
  await window.locator('[data-tour-anchor="add-pane"]').first().click({ force: true });
  const tile = window.getByRole('button', { name: 'Commentary', exact: true }).first();
  await expect(tile).toBeVisible({ timeout: 10000 });
  const apps = window.getByRole('list', { name: 'Apps' });
  if (await apps.count()) {
    const t = (await tile.boundingBox())!;
    const a = (await apps.first().boundingBox())!;
    expect(a.y).toBeGreaterThan(t.y);
  }
  if (process.env.DEMO_SHOT_DIR) {
    await window.screenshot({ path: path.join(process.env.DEMO_SHOT_DIR, '4-new-tab-order.png') });
  }
});
