/** Where the engine gets its model files from (web: asset manager; desktop: assets IPC). */

import type { LoadProgress } from '@bible/core/speech';

export interface IModelFileSource {
  isInstalled(assetId: string): Promise<boolean>;
  install(assetId: string, onProgress: (p: LoadProgress) => void, signal: AbortSignal): Promise<void>;
  /** `path` is relative to the repo root, e.g. `onnx/encoder_model_quantized.onnx`. */
  read(assetId: string, path: string): Promise<Uint8Array>;
  remove(assetId: string): Promise<void>;
}
