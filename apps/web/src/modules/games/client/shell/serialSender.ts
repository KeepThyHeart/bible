/**
 * Sends host commands one after another. Two commands issued back to back (a
 * restart followed by a start) would otherwise race as separate requests and
 * could arrive out of order.
 */

import type { HostCommand } from '../../shared/protocol.js';

export function serialSender(send: (command: HostCommand) => Promise<unknown>): (command: HostCommand) => void {
  let tail: Promise<unknown> = Promise.resolve();
  return (command) => {
    tail = tail.then(() => send(command));
  };
}
