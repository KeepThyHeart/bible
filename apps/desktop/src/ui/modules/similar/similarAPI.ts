/**
 * Renderer side of Similar passages (tasks 0070, 0126): the typed client of the main-process
 * Similar module (`electron/modules/similar`, channels `module:similar:*`). Failures arrive as
 * rejections (the `Result` envelope is unwrapped by the client).
 */
import { createModuleClient } from '../../services/moduleClient';
import type { SimilarModuleApi } from '../../../../electron/modules/similar/types';

export const similarAPI = createModuleClient<SimilarModuleApi>('similar');
