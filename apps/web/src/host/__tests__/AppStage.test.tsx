import { describe, it, expect, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_k: string, d: string) => d }) }));
vi.mock('../../utils/bootGuard', () => ({ reloadForUpdateOnce: () => false }));

import { appHost, appRegistry, addAppBinding, activateWithRecovery } from '../appHost';
import { AppStage } from '../AppStage';

const desc = (id: string, keepAlive: 'always' | 'never') => ({
  id, title: { key: id, fallback: id }, icon: { kind: 'builtin' as const, name: 'x' }, order: 0,
  lifecycle: { keepAlive, restore: 'default' as const },
});

describe('AppStage', () => {
  it('keeps mounted apps, hides and inerts the inactive one, shows error with Retry', async () => {
    appRegistry.register(desc('study', 'always'), { kind: 'builtin', moduleId: 'study' });
    appRegistry.register(desc('present', 'always'), { kind: 'builtin', moduleId: 'present' });
    let failOnce = true;
    addAppBinding({ id: 'study', load: async () => ({ View: () => <p id="s">study</p> }) });
    addAppBinding({
      id: 'present',
      load: async () => {
        if (failOnce) { failOnce = false; throw new Error('chunk 404'); }
        return { View: () => <p id="p">present</p> };
      },
    });
    const root = document.createElement('div');
    document.body.appendChild(root);
    await act(async () => { render(<AppStage />, root); });
    await act(async () => { await activateWithRecovery('study'); });
    expect(root.querySelector('#s')).toBeTruthy();

    await act(async () => { await activateWithRecovery('present'); });
    expect(root.querySelector('[data-testid="app-stage-error"]')).toBeTruthy();
    const retry = root.querySelector('[data-testid="app-stage-error"] button') as HTMLButtonElement;
    await act(async () => { retry.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(root.querySelector('[data-testid="app-stage-error"]')).toBeFalsy();
    expect(appHost.getSnapshot().activeId).toBe('present');
    const study = root.querySelector('[data-app="study"]') as HTMLElement;
    expect(study.hidden).toBe(true);
    expect(study.hasAttribute('inert')).toBe(true);
    expect(study.className).toContain('app-host__study');
    expect(root.querySelector('#s')).toBeTruthy(); // kept alive
    expect((root.querySelector('[data-app="present"]') as HTMLElement).hasAttribute('inert')).toBe(false);
  });

  it('restores focus into the app being switched to', async () => {
    appRegistry.register(desc('a1', 'always'), { kind: 'builtin', moduleId: 'a1' });
    appRegistry.register(desc('a2', 'always'), { kind: 'builtin', moduleId: 'a2' });
    addAppBinding({ id: 'a1', load: async () => ({ View: () => <button id="b1">one</button> }) });
    addAppBinding({ id: 'a2', load: async () => ({ View: () => <button id="b2">two</button> }) });
    const root = document.createElement('div');
    document.body.appendChild(root);
    await act(async () => { render(<AppStage />, root); });
    await act(async () => { await activateWithRecovery('a1'); });
    await act(async () => { await activateWithRecovery('a2'); });
    (root.querySelector('#b2') as HTMLElement).focus();
    await act(async () => { await activateWithRecovery('a1'); });
    (root.querySelector('#b1') as HTMLElement).focus();
    await act(async () => { await activateWithRecovery('a2'); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(document.activeElement?.id).toBe('b2');
  });
});
