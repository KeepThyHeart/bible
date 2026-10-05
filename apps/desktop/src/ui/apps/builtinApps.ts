/**
 * The desktop's built-in apps. Production has exactly one: Study. The Presenter is
 * web-only, Quiz and Reading plans stay panes, and extension apps arrive in M3.
 * Descriptors are data; the binding keeps the lazy `load()` shape over an eager import.
 */
import type { AppDescriptor } from '@bible/core/browser';
import { appRegistry, addAppBinding } from './appHost';
import type { DesktopAppBinding } from './appHost';
import { StudyView } from './StudyView';

export const studyDescriptor: AppDescriptor = {
  id: 'study',
  title: { key: 'apps.study.title', fallback: 'Study' },
  icon: { kind: 'builtin', name: 'book-open' },
  order: 0,
  lifecycle: { keepAlive: 'always', restore: 'reopen' },
};

export const studyBinding: DesktopAppBinding = {
  id: 'study',
  load: async () => ({ View: StudyView }),
};

let registered = false;

/** Register descriptors and bindings once. */
export function registerBuiltinApps(): void {
  if (registered) return;
  registered = true;
  appRegistry.register(studyDescriptor, { kind: 'builtin', moduleId: 'study' });
  addAppBinding(studyBinding);
  maybeRegisterDevFixtureApp();
}

function safeGetLocalStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Dev-only second app for demoing the rail and the reveal path
 * (`localStorage['kth.devFixtureApp'] = '1'`). The `import.meta.env.DEV` guard lets
 * production builds drop the dynamic import.
 */
function maybeRegisterDevFixtureApp(): void {
  if (import.meta.env.DEV && safeGetLocalStorage('kth.devFixtureApp') === '1') {
    void import('./devFixtureApp').then((m) => m.registerDevFixtureApp());
  }
}
