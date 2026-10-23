/** Renderer client for the Presenter in the main process (module IPC namespace `present`). */
import { createModuleClient } from '../../services/moduleClient';
import type { PresentApi, PresentEvents } from '../../../../electron/modules/present/types';

export const presentClient = createModuleClient<PresentApi, PresentEvents>('present');
