import { civilToInstant } from '@bible/core/browser';
import type { TimelineDataset } from '@bible/core/browser';

const y = (year: number) => civilToInstant(year, 1, 1);

/** Small dataset for the timeline tests. Years are astronomical (1 - N for N BC). */
export const FIXTURE: TimelineDataset = {
  info: { name: 'Test timeline' },
  chronologies: [
    { id: 'ussher', name: 'Ussher', description: 'Literal reading.', isDefault: true, sortOrder: 1 },
    { id: 'alt', name: 'Alternative', description: 'Shorter.', fallbackId: 'ussher', isDefault: false, sortOrder: 2 },
  ],
  lanes: [
    { id: 'kings', name: 'Kings', colorKey: 'blue', sortOrder: 1 },
    { id: 'events', name: 'Events', sortOrder: 2 },
  ],
  items: [
    {
      id: 1, slug: 'solomon', kind: 'reign', laneId: 'kings', title: 'Solomon', summary: 'Built the temple.', reviewed: true,
      passages: [{ start: 11_001_001, end: 11_011_043, primary: true }, { start: 14_001_001, end: 14_009_031, primary: false }],
      dates: { ussher: { start: y(-1014), end: y(-974), precision: 'year', circa: false, basis: 'Ussher Annals', startMin: y(-1016), startMax: y(-1012) } },
    },
    {
      id: 2, slug: 'temple', kind: 'event', laneId: 'events', title: 'Temple dedicated', reviewed: false,
      passages: [{ start: 11_008_001, end: 11_008_066, primary: true }],
      dates: {
        ussher: { start: y(-1004), precision: 'year', circa: false },
        alt: { start: y(-960), precision: 'year', circa: true },
      },
    },
  ],
};
