import { kokoroDefinition } from './kokoro';
import { piperDefinition } from './piper';
import type { EngineDefinition } from './types';

const engines = new Map<string, EngineDefinition>();

/** Add an engine: a third one is a definition in its own file plus one line here. */
export function registerEngine(def: EngineDefinition): void { engines.set(def.id, def); }

export function getEngine(id: string): EngineDefinition {
  const e = engines.get(id);
  if (!e) throw new Error(`Unknown engine "${id}". Available: ${[...engines.keys()].join(', ')}.`);
  return e;
}

export const listEngines = (): EngineDefinition[] => [...engines.values()];

registerEngine(kokoroDefinition);
registerEngine(piperDefinition);
