/**
 * Reads the display attribution a converter stored in `module_info.metadata`
 * (`metadata.provenance.attribution`, see `docs/features/module-format.md`).
 *
 * Returns `null` for modules that carry none (anything not converted from a
 * SWORD module, or converted before provenance was recorded). No text is
 * invented from other fields.
 */
export function getProvenanceAttribution(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const provenance = (metadata as Record<string, unknown>).provenance;
  if (!provenance || typeof provenance !== 'object') return null;
  const attribution = (provenance as Record<string, unknown>).attribution;
  return typeof attribution === 'string' && attribution.trim() !== '' ? attribution.trim() : null;
}

/** Same as {@link getProvenanceAttribution}, from the raw `module_info.metadata` JSON text. */
export function getProvenanceAttributionFromJson(json: string | null | undefined): string | null {
  if (!json) return null;
  try {
    return getProvenanceAttribution(JSON.parse(json));
  } catch {
    return null;
  }
}
