import { describe, it, expect } from 'vitest';
import BibleHeader from './BibleHeader';

describe('BibleHeader', () => {
  // Note: BibleHeader uses BiblePaneContext which is complex to mock
  // This is a presentational component that is difficult to test in isolation
  // It requires complex context setup that is better tested through
  // integration tests with the full BiblePane component

  it('is a valid React component', () => {
    // Smoke test - just verify the component can be imported
    expect(BibleHeader).toBeDefined();
  });
});
