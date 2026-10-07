/**
 * The built-in apps: Study and the Presenter. Descriptors are data; every
 * chunk loads through a binding only when the app is activated or prefetched.
 */
import type { AppDescriptor, VerseActionContribution } from '@bible/core/browser';
import i18n from 'i18next';
import { appRegistry, addAppBinding, getShellContext, verseActions } from './appHost';
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
  // The PresentBar strip inside Study: its chunk loads only while a session is live.
  companion: {
    when: 'busy',
    load: () => import('../components/Present/PresentBar').then((m) => ({ View: m.PresentBar })),
  },
};

/** "Present" in the verse context menu: shown while a session is live; the handler loads on first use. */
export const presentVerseAction: VerseActionContribution = {
  id: 'present.showVerse',
  title: { key: 'contextMenu.present', fallback: 'Present' },
  icon: { kind: 'builtin', name: 'fa-tv' },
  appId: 'present',
  when: 'present.live',
  order: 10,
  group: 'app',
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
  verseActions.register(presentVerseAction, { kind: 'builtin', moduleId: 'present' });
  verseActions.bindHandler({
    id: presentVerseAction.id,
    load: () => import('../apps/present/presentVerseAction').then((m) => m.presentVerseHandler),
  });
  setPresenterBusySink((busy) => {
    appRegistry.setBusy('present', busy);
    // A live dot on the rail / switcher (it replaces the header's old "presenting" highlight).
    appRegistry.setBadge('present', busy ? { kind: 'dot', tone: 'live', label: i18n.t('present.app.live') } : undefined);
  });
}
