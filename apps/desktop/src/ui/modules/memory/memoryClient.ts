/** Renderer client for the memory core running in the main process (module IPC namespace `memory`). */
import type { MemoryApi, MemoryEvents } from '@bible/memory/api';
import { createModuleClient } from '../../services/moduleClient';

export const memoryClient = createModuleClient<MemoryApi, MemoryEvents>('memory');
