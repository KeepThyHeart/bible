// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d: string) => d, i18n: { language: 'en' } }),
}));
vi.mock('../../i18n', () => ({ uiDirectionFor: () => 'ltr' }));
vi.mock('../../utils/bootGuard', () => ({ reloadForUpdateOnce: () => false }));

import { appHost, appRegistry, addAppBinding, activateWithRecovery } from '../appHost';
import { webSettings } from '../../stores/settingsRegistry';
import { AppShell } from '../AppShell';

const desc = (id: string, order: number) => ({
  id, title: { key: id, fallback: id }, icon: { kind: 'builtin' as const, name: 'fa-x' }, order,
  lifecycle: { keepAlive: 'always' as const, restore: 'default' as const },
});

describe('AppShell rail', () => {
  it('shows and hides the rail without remounting Study; selecting opens the app', async () => {
    window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never;
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    let mounts = 0;
    function StudyStub() {
      mounts++;
      return <p id="study-view">study</p>;
    }
    appRegistry.register(desc('study', 0), { kind: 'builtin', moduleId: 'study' });
    appRegistry.register(desc('present', 10), { kind: 'builtin', moduleId: 'present' });
    addAppBinding({ id: 'study', load: async () => ({ View: StudyStub }) });
    addAppBinding({ id: 'present', load: async () => ({ View: () => <p id="present-view">present</p> }) });

    const root = document.createElement('div');
    document.body.appendChild(root);
    await act(async () => { render(<AppShell ctx={{} as never} />, root); });
    await act(async () => { await activateWithRecovery('study'); });

    const studyEl = root.querySelector('#study-view');
    expect(studyEl).toBeTruthy();
    expect(root.querySelector('.kth-app-rail')).toBeTruthy(); // auto + 2 apps

    await act(async () => { webSettings.set('appSwitcher', 'none'); });
    expect(root.querySelector('.kth-app-rail')).toBeNull();
    expect(root.querySelector('#study-view')).toBe(studyEl); // same DOM node
    await act(async () => { webSettings.set('appSwitcher', 'rail'); });
    expect(root.querySelector('.kth-app-rail')).toBeTruthy();
    expect(root.querySelector('#study-view')).toBe(studyEl);
    expect(mounts).toBe(1);

    const btn = root.querySelector('.kth-app-rail [data-app-id="present"]') as HTMLButtonElement;
    expect(btn.title).toBe('present (Ctrl+Shift+2)');
    await act(async () => { btn.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(appHost.getSnapshot().activeId).toBe('present');
    expect(root.querySelector('#study-view')).toBe(studyEl);
    webSettings.reset(['appSwitcher']);
  });
});
