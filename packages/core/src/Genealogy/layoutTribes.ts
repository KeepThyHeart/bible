import type { GenealogyGraph } from './GenealogyGraph';
import type { GraphLayout } from './types';
export interface TribesLayoutOptions { list?: 'gen_49' | 'num_26' | 'rev_7'; depth?: number; collapsed?: string[]; highlightLineToChrist?: boolean; }
/** STUB: implemented by subtask 6. */
export function layoutTribes(_g: GenealogyGraph, _opts?: TribesLayoutOptions): GraphLayout { throw new Error('todo'); }
