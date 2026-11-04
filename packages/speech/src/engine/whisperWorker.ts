/** Web Worker entry: wires `postMessage` to the Whisper handlers. Imports no @bible/core runtime code. */

import { createWhisperHandlers, serveWhisper } from './whisperHandlers';
import type { WhisperReply, WhisperRequest } from './whisperProtocol';

const scope = self as unknown as {
  onmessage: ((e: { data: WhisperRequest }) => void) | null;
  postMessage(m: WhisperReply): void;
};

const handle = serveWhisper((r) => scope.postMessage(r), createWhisperHandlers());
scope.onmessage = (e) => handle(e.data);
