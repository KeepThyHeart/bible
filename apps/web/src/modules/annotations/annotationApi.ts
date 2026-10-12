/** The worker's `annotations` repo as the store's API, and the `changed` subscription (lazy chunk; the only userdb import). */
import { getUserDbClient, isUserDbSupported } from '../../userdb/client';
import type { AnnotationsApi } from './annotationStore';

export { isUserDbSupported };

/** Every method of `AnnotationsRepo` is a worker call; the proxy turns them into requests. */
export async function getAnnotationsApi(): Promise<AnnotationsApi> {
  const client = await getUserDbClient();
  return client.repo('annotations') as unknown as AnnotationsApi;
}

export function subscribeChanged(cb: (tables: readonly string[]) => void): () => void {
  let off: (() => void) | null = null;
  let cancelled = false;
  void getUserDbClient().then(
    (client) => {
      if (cancelled) return;
      off = client.onEvent((e) => {
        if (e.event === 'changed') cb(e.tables);
      });
    },
    () => undefined,
  );
  return () => {
    cancelled = true;
    off?.();
  };
}
