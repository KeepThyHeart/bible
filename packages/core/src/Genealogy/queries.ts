import type { GenealogyGraph } from './GenealogyGraph';

/** STUB: implemented by subtask 4. */
export interface LineToChristPath {
  lineageId: string;
  /** Person ids from Adam to Jesus in order (each consecutive pair is a stated link or a lineage step). */
  path: string[];
}
export function ancestors(_g: GenealogyGraph, _id: string, _depth?: number): string[] { throw new Error('todo'); }
export function descendants(_g: GenealogyGraph, _id: string, _depth?: number): string[] { throw new Error('todo'); }
export function pathBetween(_g: GenealogyGraph, _from: string, _to: string): string[] | null { throw new Error('todo'); }
export function lineToChrist(_g: GenealogyGraph, _id?: string): LineToChristPath[] { throw new Error('todo'); }
export function kinshipLabel(_g: GenealogyGraph, _a: string, _b: string): string { throw new Error('todo'); }
