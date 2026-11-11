import { describe, expect, it } from 'vitest';
import { serialSender } from './serialSender.js';

describe('the serial sender', () => {
  it('starts each send only after the one before has finished', async () => {
    const log: string[] = [];
    const release: Array<() => void> = [];
    const send = serialSender(
      (command) =>
        new Promise<void>((resolve) => {
          log.push(`start ${command.cmd}`);
          release.push(() => {
            log.push(`end ${command.cmd}`);
            resolve();
          });
        })
    );

    send({ cmd: 'newGame' });
    send({ cmd: 'start' });
    await Promise.resolve();
    expect(log).toEqual(['start newGame']);

    release[0]?.();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(log).toEqual(['start newGame', 'end newGame', 'start start']);
  });
});
