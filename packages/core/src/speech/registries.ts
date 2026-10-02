/**
 * Registries for speech engines. Host-only: extensions cannot register engines.
 */

import { Registry } from '../audio/registry';
import type { IListener, ListenerRegistry, SttEngineFactory, SttEngineRegistry } from './types';

export function createSttEngineRegistry(): SttEngineRegistry {
  return new Registry<SttEngineFactory>();
}

export function createListenerRegistry(): ListenerRegistry {
  return new Registry<IListener>();
}
