/**
 * W-035: a 400 INVALID_PARAM carries a message meant for the user ("Unmatched
 * quote in search query"). Expose it as `validationMessage` so a store can show
 * it instead of reporting the failed request as "no results". The error's own
 * message is unchanged; only the standard `{error:{code,message}}` body counts.
 */
export function withValidationMessage(error: Error, status: number, body: string): Error {
  if (status !== 400) return error;
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown; message?: unknown } };
    const message = parsed?.error?.message;
    if (parsed?.error?.code === 'INVALID_PARAM' && typeof message === 'string' && message.length <= 300) {
      return Object.assign(error, { validationMessage: message });
    }
  } catch {
    // Not JSON: nothing to show.
  }
  return error;
}
