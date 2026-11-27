import { describe, it, expect } from 'vitest';
import { getProvenanceAttribution, getProvenanceAttributionFromJson } from './ModuleProvenance';

describe('getProvenanceAttribution', () => {
  const text = 'Converted from the SWORD module "KJV" (version 3.1), distributed by the CrossWire Bible Society (crosswire.org).';

  it('returns the attribution string', () => {
    expect(getProvenanceAttribution({ provenance: { attribution: text } })).toBe(text);
  });

  it('returns null when absent or malformed', () => {
    expect(getProvenanceAttribution(undefined)).toBeNull();
    expect(getProvenanceAttribution({})).toBeNull();
    expect(getProvenanceAttribution({ provenance: 'x' })).toBeNull();
    expect(getProvenanceAttribution({ provenance: { attribution: '  ' } })).toBeNull();
    expect(getProvenanceAttribution({ provenance: { attribution: 5 } })).toBeNull();
  });

  it('reads from JSON text and tolerates bad JSON', () => {
    expect(getProvenanceAttributionFromJson(JSON.stringify({ provenance: { attribution: text } }))).toBe(text);
    expect(getProvenanceAttributionFromJson('{nope')).toBeNull();
    expect(getProvenanceAttributionFromJson(null)).toBeNull();
  });
});
