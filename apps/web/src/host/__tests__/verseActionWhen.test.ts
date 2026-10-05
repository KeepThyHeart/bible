import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../utils/bootGuard', () => ({ reloadForUpdateOnce: () => false }));

import { appRegistry } from '../appHost';
import { evalAppWhen, evalVerseWhen } from '../verseActionWhen';

appRegistry.register(
  { id: 'present', title: { key: 'p', fallback: 'P' }, icon: { kind: 'builtin', name: 'x' }, lifecycle: { keepAlive: 'while-busy', restore: 'default' } },
  { kind: 'builtin', moduleId: 'present' },
);

describe('when evaluators', () => {
  afterEach(() => appRegistry.setBusy('present', false));

  it('present.live follows the Presenter busy flag; ! negates', () => {
    expect(evalVerseWhen('present.live')).toBe(false);
    expect(evalVerseWhen('!present.live')).toBe(true);
    appRegistry.setBusy('present', true);
    expect(evalVerseWhen('present.live')).toBe(true);
    expect(evalVerseWhen('!present.live')).toBe(false);
  });

  it('verse actions: an unknown key is false (also negated)', () => {
    expect(evalVerseWhen('mystery.key')).toBe(false);
    expect(evalVerseWhen('!mystery.key')).toBe(false);
  });

  it('apps: only keys it knows can be false; unknown keys never hide an app', () => {
    expect(evalAppWhen('server.present')).toBe(true);
    expect(evalAppWhen('!server.present')).toBe(true);
    expect(evalAppWhen('present.live')).toBe(false);
    appRegistry.setBusy('present', true);
    expect(evalAppWhen('present.live')).toBe(true);
  });
});
