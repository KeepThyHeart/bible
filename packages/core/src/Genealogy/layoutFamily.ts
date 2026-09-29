import type { GenealogyGraph } from './GenealogyGraph';
import type { GraphLayout } from './types';
export interface FamilyLayoutOptions { up?: number; down?: number; showMothers?: boolean; collapsed?: string[]; highlightLineToChrist?: boolean; }
/** STUB: implemented by subtask 6. */
export function layoutFamily(_g: GenealogyGraph, _focusId: string, _opts?: FamilyLayoutOptions): GraphLayout { throw new Error('todo'); }
