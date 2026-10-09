import { create } from 'zustand';

/**
 * A pending "show this person's family" request for one Genealogy pane.
 *
 * `nonce` makes two requests for the same person distinct, so asking again
 * after the reader has wandered off re-centres the pane.
 */
export interface GenealogyFocusRequest {
  personId: string;
  nonce: number;
}

interface GenealogyFocusState {
  /** Latest request per panel id. */
  requests: Record<string, GenealogyFocusRequest>;
  requestFocus: (panelId: string, personId: string) => void;
}

let nextNonce = 1;

/**
 * How other panes (the Topics pane's "Show family tree" button) ask a Genealogy
 * pane to centre on a person. Kept out of dockview params so a request reaches
 * a pane that is already mounted as well as one that is just being created.
 */
export const useGenealogyFocusStore = create<GenealogyFocusState>((set) => ({
  requests: {},
  requestFocus: (panelId, personId) =>
    set((s) => ({ requests: { ...s.requests, [panelId]: { personId, nonce: nextNonce++ } } })),
}));
