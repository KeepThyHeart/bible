/**
 * The host's own built-in app: Study. Other apps (the Presenter) are
 * contributed by feature modules (`modules/<id>/manifest.ts` + `binding.ts`).
 * Descriptors are data; every chunk loads through a binding only when the app
 * is activated or prefetched.
 */
import type { AppDescriptor } from '@bible/core/browser';
import { appRegistry, addAppBinding } from './appHost';
import type { WebAppBinding } from './appHost';

export const studyDescriptor: AppDescriptor = {
  id: 'study',
  title: { key: 'apps.study.title', fallback: 'Study' },
  icon: { kind: 'builtin', name: 'fa-book-open' },
  order: 0,
  lifecycle: { keepAlive: 'always', restore: 'reopen' },
  ownChrome: true,
};

export const studyBinding: WebAppBinding = {
  id: 'study',
  load: () =>
    import('../apps/study/StudyView').then((m) => ({
      View: m.StudyView,
      activate: () => m.activateStudy(),
      deactivate: () => m.deactivateStudy(),
    })),
};

let registered = false;

/** Register Study's descriptor and binding once. */
export function registerBuiltinApps(): void {
  if (registered) return;
  registered = true;
  appRegistry.register(studyDescriptor, { kind: 'builtin', moduleId: 'study' });
  addAppBinding(studyBinding);
}
