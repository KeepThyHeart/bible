import type { GenealogyGraph } from './GenealogyGraph';
import type { GraphLayout } from './types';
export interface LineageLayoutOptions { lineageIds?: string[]; highlightLineToChrist?: boolean; }
/** STUB: implemented by subtask 5. */
export function layoutLineage(_g: GenealogyGraph, _opts?: LineageLayoutOptions): GraphLayout { throw new Error('todo'); }
