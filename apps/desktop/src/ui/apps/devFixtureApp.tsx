/**
 * Dev-only fixture app (id `dev.fixture`): a plain placeholder, registered only when
 * `localStorage['kth.devFixtureApp'] === '1'` in a dev build. Exercises the rail,
 * the stage reveal path and View > Apps without a real second app.
 */
import React from 'react';
import { appRegistry, addAppBinding } from './appHost';

export const DevFixtureView: React.FC = () => (
  <section className="h-full p-lg bg-background text-text-primary">
    <h1 tabIndex={-1} className="text-lg font-semibold">Dev fixture app</h1>
    <p className="text-sm text-text-secondary">A placeholder app for development.</p>
  </section>
);

export function registerDevFixtureApp(): void {
  if (appRegistry.has('dev.fixture')) return;
  appRegistry.register(
    {
      id: 'dev.fixture',
      title: { key: 'apps.devFixture.title', fallback: 'Dev fixture' },
      icon: { kind: 'builtin', name: 'app' },
      order: 20,
      lifecycle: { keepAlive: 'always', restore: 'reopen' },
    },
    { kind: 'builtin', moduleId: 'dev.fixture' },
  );
  addAppBinding({ id: 'dev.fixture', load: async () => ({ View: DevFixtureView }) });
}
