import { describe, it, expect, vi, afterEach } from 'vitest';
import { registerSearchCommands } from './searchCommands';
import type { ICommandRegistry } from '../services/ICommandRegistry';

function handlerFor(id: string): () => void {
  const handlers: Record<string, () => void> = {};
  const registry = {
    register: (c: { id: string; handler: () => void }) => {
      handlers[c.id] = c.handler;
      return { dispose: vi.fn() };
    },
  } as unknown as ICommandRegistry;
  registerSearchCommands(registry);
  return handlers[id];
}

describe('search.openFindBar routing', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function run(): string[] {
    const events: string[] = [];
    const record = (e: Event): void => { events.push(e.type); };
    window.addEventListener('command:notes:find', record);
    window.addEventListener('command:search:openFindBar', record);
    handlerFor('search.openFindBar')();
    window.removeEventListener('command:notes:find', record);
    window.removeEventListener('command:search:openFindBar', record);
    return events;
  }

  it('dispatches command:notes:find when focus is inside a note editor', () => {
    document.body.innerHTML = '<div class="note-editor"><div id="ed" tabindex="0"></div></div>';
    document.getElementById('ed')!.focus();
    expect(run()).toEqual(['command:notes:find']);
  });

  it('dispatches command:search:openFindBar otherwise', () => {
    document.body.innerHTML = '<div id="x" tabindex="0"></div>';
    document.getElementById('x')!.focus();
    expect(run()).toEqual(['command:search:openFindBar']);
  });
});
