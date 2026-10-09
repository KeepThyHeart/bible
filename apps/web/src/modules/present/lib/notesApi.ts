import { API_BASE } from '../../../utils/apiUrl';

/**
 * The presenter's private notes document, kept on the session so a handoff to
 * another device carries it. Controller-only (control token); viewers never
 * receive it. The doc is opaque to the server (an object, at most 256 KB).
 */

/** Send the notes document. Resolves true on success. */
export async function putNotes(
  sessionId: string,
  token: string,
  doc: Record<string, unknown>,
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/present/s/${sessionId}/notes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Present-Token': token },
      body: JSON.stringify({ doc }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Fetch the notes document held by the session. Resolves null when none was
 * sent yet, or on any failure (notes are a convenience; never block a service).
 */
export async function getNotes(
  sessionId: string,
  token: string,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${API_BASE}/api/present/s/${sessionId}/notes`, {
      headers: { 'X-Present-Token': token },
    });
    if (!res.ok) return null;
    const body = await res.json() as { doc?: Record<string, unknown> | null };
    return body.doc ?? null;
  } catch {
    return null;
  }
}
