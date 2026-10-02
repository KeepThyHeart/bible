import type { PresentState } from '../../../present/protocol';

/**
 * The pre-live preview's wire format: the Presenter posts the local session's
 * state into the preview frame, which renders it with the real viewer. (Once
 * live, the frame reads the real session's stream instead.) Kept free of
 * imports beyond a type so the viewer bundle can load it cheaply.
 */
export const LOCAL_PREVIEW_SOURCE = 'kth-present-local-preview';

export interface LocalPreviewStateMessage {
  source: typeof LOCAL_PREVIEW_SOURCE;
  kind: 'state';
  state: PresentState;
}

export interface LocalPreviewHelloMessage {
  source: typeof LOCAL_PREVIEW_SOURCE;
  kind: 'hello';
}

export function localPreviewStateMessage(state: PresentState): LocalPreviewStateMessage {
  return { source: LOCAL_PREVIEW_SOURCE, kind: 'state', state };
}

/** The state inside a received message, or null for anything else. */
export function parseLocalPreviewState(data: unknown): PresentState | null {
  if (typeof data !== 'object' || data === null) return null;
  const m = data as Partial<LocalPreviewStateMessage>;
  if (m.source !== LOCAL_PREVIEW_SOURCE || m.kind !== 'state') return null;
  const s = m.state as PresentState | undefined;
  if (!s || typeof s !== 'object' || !s.display || !s.position) return null;
  return s;
}

export function isLocalPreviewHello(data: unknown): boolean {
  return typeof data === 'object' && data !== null
    && (data as Partial<LocalPreviewHelloMessage>).source === LOCAL_PREVIEW_SOURCE
    && (data as Partial<LocalPreviewHelloMessage>).kind === 'hello';
}

/** The query flag that puts the viewer page into this mode (`/present/v/local?...&local=1`). */
export function isLocalPreviewSearch(search: string): boolean {
  return new URLSearchParams(search).get('local') === '1';
}
