import { describe, expect, it } from 'vitest';
import { registerViewCommands } from './viewCommands';

describe('view commands (B-045)', () => {
  it('zoom in is bound to the unshifted Ctrl+= (Cmd+= on macOS)', () => {
    const commands: Array<{ id: string; shortcut?: unknown }> = [];
    registerViewCommands({
      register: (c: { id: string; shortcut?: unknown }) => {
        commands.push(c);
        return { dispose() {} };
      },
    } as never);
    const zoomIn = commands.find((c) => c.id === 'view.zoomIn');
    expect(zoomIn?.shortcut).toEqual({ key: 'Ctrl+=', mac: 'Cmd+=' });
  });
});
