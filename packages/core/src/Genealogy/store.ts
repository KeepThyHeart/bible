import { createStore } from '../Ui/ReadableStore';
import type { WritableStore } from '../Ui/ReadableStore';
import type { GenealogyViewKind } from './types';

export interface GenealogyState {
  view: GenealogyViewKind;
  /** Person the Family view is centred on. */
  focusId: string | null;
  /** Person whose card is open. */
  selectedId: string | null;
  /** Lineage ids shown in the Line view (default: matthew_1 + luke_3 + the spine). */
  lineageIds: string[];
  /** Tribes view list: 'gen_49' | 'num_26' | 'rev_7'. */
  tribeList: 'gen_49' | 'num_26' | 'rev_7';
  highlightLineToChrist: boolean;
  showMothers: boolean;
  showDisputed: boolean;
  /** Chosen reading per reading_group. */
  readings: Record<string, string>;
  up: number;
  down: number;
  /** Collapsed node ids (Family/Tribes). */
  collapsed: string[];
}

export const DEFAULT_GENEALOGY_STATE: GenealogyState = {
  view: 'line',
  focusId: null,
  selectedId: null,
  lineageIds: [],
  tribeList: 'gen_49',
  highlightLineToChrist: true,
  showMothers: true,
  showDisputed: false,
  readings: {},
  up: 3,
  down: 2,
  collapsed: [],
};

export type GenealogyStore = WritableStore<GenealogyState>;

export function createGenealogyStore(init: Partial<GenealogyState> = {}): GenealogyStore {
  return createStore<GenealogyState>({ ...DEFAULT_GENEALOGY_STATE, ...init });
}

/** Re-centre the Family view on a person (and open their card). */
export function focusPerson(store: GenealogyStore, id: string): void {
  store.setState(s => ({ ...s, view: 'family', focusId: id, selectedId: id }));
}
