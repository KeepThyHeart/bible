/**
 * Shared @huggingface/transformers environment setup.
 *
 * Both the embedder and the reranker load models through the same global
 * `env`, so pointing them at a self-hosted directory has to happen in one
 * place. When a model directory is configured we also switch off remote
 * downloads: a server that silently reaches huggingface.co on first query
 * turns a network blip into a search outage, and pulls model weights onto a
 * box that was meant to run offline.
 */

/**
 * Memoized per path. The embedder and reranker initialize concurrently
 * (SearchPipeline awaits them in a Promise.all), so a plain boolean guard set
 * after the await lets both callers through. Caching the promise itself means
 * the second caller awaits the first's work instead of repeating it.
 */
const configured = new Map<string, Promise<void>>();

/**
 * Point transformers.js at a self-hosted model directory and disable remote
 * fetches. Safe to call repeatedly and concurrently. Passing `undefined`
 * leaves the library defaults alone.
 */
export function configureTransformersEnv(modelPath: string | undefined): Promise<void> {
  if (!modelPath) return Promise.resolve();

  let pending = configured.get(modelPath);
  if (!pending) {
    pending = (async () => {
      const { env } = await import('@huggingface/transformers');
      env.localModelPath = modelPath;
      env.allowRemoteModels = false;
      console.log(`[transformers] Serving models from ${modelPath} (remote downloads disabled).`);
    })();
    configured.set(modelPath, pending);
  }
  return pending;
}
