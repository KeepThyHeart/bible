// Hand-written fixtures for the genealogy component tests (no layout function is called).
import { GenealogyGraph } from '@bible/core/browser';
import type { GenealogyDatasetDto, GraphLayout, LayoutNode } from '@bible/core/browser';

export const dataset: GenealogyDatasetDto = {
  module: 'test',
  sources: [],
  lineages: [
    { id: 'matthew_1', name: 'Matthew 1', kind: 'genealogy', direction: 'descending', range: { start: 40001001, end: 40001017 },
      steps: [{ personId: 'abraham', verseId: 40001002 }, { personId: 'isaac', verseId: 40001002 }, { personId: 'jacob', verseId: 40001002 }, { personId: 'joseph_h', verseId: 40001016, gapBefore: ['x1', 'x2'] }] },
    { id: 'luke_3', name: 'Luke 3', kind: 'genealogy', direction: 'ascending', range: { start: 42003023, end: 42003038 },
      steps: [{ personId: 'joseph_h', verseId: 42003023 }, { personId: 'heli', verseId: 42003023 }, { personId: 'abraham', verseId: 42003034 }] },
  ],
  persons: [
    { id: 'abraham', name: 'Abraham', sex: 'male', kind: 'individual', tribe: 'Terah', firstRef: 1011026, roles: ['patriarch'] },
    { id: 'isaac', name: 'Isaac', sex: 'male', kind: 'individual', firstRef: 1021003 },
    { id: 'jacob', name: 'Jacob', sex: 'male', kind: 'individual', firstRef: 1025026 },
    { id: 'jacob_nt', name: 'Jacob', sex: 'male', kind: 'individual', firstRef: 40001015 },
    { id: 'joseph_h', name: 'Joseph', sex: 'male', kind: 'individual', firstRef: 40001016 },
    { id: 'heli', name: 'Heli', sex: 'male', kind: 'individual', firstRef: 42003023 },
    { id: 'x1', name: 'Ahaziah', sex: 'male', kind: 'individual' },
    { id: 'x2', name: 'Joash', sex: 'male', kind: 'individual' },
  ],
  edges: [
    { id: 'e1', from: 'abraham', to: 'isaac', type: 'father_of', confidence: 'certain', verses: [{ start: 1021003, end: 1021003 }] },
    { id: 'e2', from: 'isaac', to: 'jacob', type: 'father_of', confidence: 'certain', verses: [{ start: 1025026, end: 1025026 }] },
    { id: 'e3', from: 'jacob_nt', to: 'joseph_h', type: 'father_of', confidence: 'probable', readingGroup: 'g1', reading: 'default', verses: [{ start: 40001016, end: 40001016 }] },
    { id: 'e4', from: 'heli', to: 'joseph_h', type: 'father_of', confidence: 'disputed', qualifier: 'legal', readingGroup: 'g1', reading: 'Heli', verses: [{ start: 42003023, end: 42003023 }] },
  ],
  cases: [{
    id: 'heli', title: 'Who was the father of Joseph?', verses: [{ start: 42003023, end: 42003023 }], personIds: ['heli', 'joseph_h'],
    text: 'Joseph, which was the son of Heli', readings: [{ label: 'Mary\'s line', summary: 'Luke gives Mary\'s ancestry', heldBy: 'Luther' }],
  }],
};

export const graph = GenealogyGraph.from(dataset);

const node = (id: string, x: number, y: number, importance: 0 | 1 | 2, extra: Partial<LayoutNode> = {}): LayoutNode => ({
  id, personId: id, label: (id[0].toUpperCase() + id.slice(1)).replace('_h', ''), x, y, w: 80, h: 30, importance, sex: 'male', flags: {}, ...extra,
});

/** Bounds 0..400 x 0..300; fitted into the 800x600 jsdom fallback size this gives k = 1.5. */
export const layout: GraphLayout = {
  bounds: { x: 0, y: 0, w: 400, h: 300 },
  nodes: [
    node('abraham', 50, 30, 0, { colorKey: 'leah', flags: { onLineToChrist: true } }),
    node('isaac', 50, 130, 1, { flags: { onLineToChrist: true, gapNote: '3 kings not named' } }),
    node('jacob', 50, 230, 2, { flags: { oneTextOnly: true } }),
    node('heli', 250, 130, 2, { sex: 'female', flags: { disputed: true, collapsed: 3 } }),
    node('joseph_h', 350, 230, 1, { flags: { focus: true } }),
  ],
  edges: [
    { id: 'l1', from: 'abraham', to: 'isaac', points: [{ x: 50, y: 45 }, { x: 50, y: 115 }], style: 'solid', kind: 'parent', onLineToChrist: true },
    { id: 'l2', from: 'isaac', to: 'jacob', points: [{ x: 50, y: 145 }, { x: 50, y: 215 }], style: 'double', kind: 'spouse' },
    { id: 'l3', from: 'heli', to: 'joseph_h', points: [{ x: 250, y: 145 }, { x: 350, y: 215 }], style: 'dashed', kind: 'cross' },
  ],
};
