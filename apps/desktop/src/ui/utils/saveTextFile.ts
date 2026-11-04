/**
 * Save a text file the UI built (reading-plan .ics, keyword-set JSON).
 *
 * The desktop app asks main for a native save dialog; a hidden `<a download>`
 * click is silently dropped there (B-078). Without Electron (tests, a browser
 * host) it falls back to the anchor download.
 *
 * @returns `true` when a file was written or the download was handed to the
 * browser, `false` when the user cancelled.
 */
export async function saveTextFile(filename: string, text: string, mimeType: string): Promise<boolean> {
  const ipc = typeof window !== 'undefined' ? window.electron?.ipcRenderer : undefined;
  if (ipc?.invoke) {
    const result = await ipc.invoke<{ success: boolean; canceled?: boolean; error?: string }>('app:save-text-file', filename, text);
    if (result.canceled) return false;
    if (!result.success) throw new Error(result.error ?? 'Could not save the file');
    return true;
  }
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
