/** Typed client for the audio module's main-process API (`electron/modules/audio/types.ts`). */
import type { AudioModuleApi } from '../../../../electron/modules/audio/types';
import { createModuleClient } from '../../services/moduleClient';

export const audioClient = createModuleClient<AudioModuleApi>('audio');
