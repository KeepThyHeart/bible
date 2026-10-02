/** Wrap `fn` so it runs at most once (later calls are no-ops). Used for IPC handler registration. */
export function runOnce(fn: () => void): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    fn();
  };
}
