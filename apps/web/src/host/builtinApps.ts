/**
 * The built-in apps: Study and the Presenter. Descriptors are data; every
 * chunk loads through a binding only when the app is activated or prefetched.
 */
import type { AppDescriptor } from '@bible/core/browser';
import { appRegistry, addAppBinding, getShellContext } from './appHost';
import type { WebAppBinding } from './appHost';
import { setPresenterBusySink, ensurePresenterRuntime } from './presenterRuntime';

export const studyDescriptor: AppDescriptor = {
  id: 'study',
  title: { key: 'apps.study.title', fallback: 'Study' },
  icon: { kind: 'builtin', name: 'fa-book-open' },
  order: 0,
  lifecycle: { keepAlive: 'always', restore: 'reopen' },
};

export const presentDescriptor: AppDescriptor = {
  id: 'present',
  title: { key: 'apps.present.title', fallback: 'Presenter' },
  icon: { kind: 'builtin', name: 'fa-tv' },
  order: 10,
  platforms: ['web'],
  deepLink: { segment: 'present' },
  lifecycle: { keepAlive: 'while-busy', restore: 'while-busy' },
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

export const presentBinding: WebAppBinding = {
  id: 'present',
  load: () =>
    import('../apps/present/PresenterApp').then((m) => ({
      View: m.PresenterApp,
      activate: () => ensurePresenterRuntime(getShellContext().adoptedSession),
    })),
};

let registered = false;

/** Register descriptors and bindings once; wires the Presenter's busy flag. */
export function registerBuiltinApps(): void {
  if (registered) return;
  registered = true;
  appRegistry.register(studyDescriptor, { kind: 'builtin', moduleId: 'study' });
  appRegistry.register(presentDescriptor, { kind: 'builtin', moduleId: 'present' });
  addAppBinding(studyBinding);
  addAppBinding(presentBinding);
  setPresenterBusySink((busy) => appRegistry.setBusy('present', busy));
}
