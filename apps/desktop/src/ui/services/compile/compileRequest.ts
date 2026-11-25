import type { CompileOptions } from './compilePassageNotes';

/** Window event that opens the "Compile passage notes" dialog (see CompilePassageNotesHost). */
export const COMPILE_PASSAGE_NOTES_EVENT = 'command:notes:compilePassageNotes';

export interface CompileRequestDetail {
  /** Prefilled references text, e.g. "Romans 8" or "Romans 1; Romans 5". */
  reference?: string;
  initialOptions?: Partial<CompileOptions>;
}

export function requestCompilePassageNotes(detail: CompileRequestDetail = {}): void {
  window.dispatchEvent(new CustomEvent<CompileRequestDetail>(COMPILE_PASSAGE_NOTES_EVENT, { detail }));
}
