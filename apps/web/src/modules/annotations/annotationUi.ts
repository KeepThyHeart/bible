/** What the annotations overlay shows right now: the highlight popover, the note dialog and a transient toast. */
import { Store } from '../../stores/Store';
import type { NoteDto } from '../../userdb/annotationsRepo';

export interface HighlightPopoverState {
  moduleId: number;
  start: number;
  end: number;
  /** Colour of the highlight under the first verse, if any. */
  color: string | null;
  /** The selection holds at least one highlight (shows Remove). */
  hasHighlight: boolean;
}

export interface NoteDialogState {
  start: number;
  end: number;
  /** Localised reference, shown in the title. */
  reference: string;
  note: NoteDto | null;
}

export class AnnotationUi extends Store {
  popover: HighlightPopoverState | null = null;
  note: NoteDialogState | null = null;
  toast: { id: number; text: string } | null = null;
  private toastId = 0;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;

  openHighlight(state: HighlightPopoverState): void {
    this.note = null;
    this.popover = state;
    this.notify();
  }

  openNote(state: NoteDialogState): void {
    this.popover = null;
    this.note = state;
    this.notify();
  }

  closePopover(): void {
    if (!this.popover) return;
    this.popover = null;
    this.notify();
  }

  closeNote(): void {
    if (!this.note) return;
    this.note = null;
    this.notify();
  }

  showToast(text: string, ms = 2600): void {
    clearTimeout(this.toastTimer);
    this.toast = { id: ++this.toastId, text };
    this.notify();
    this.toastTimer = setTimeout(() => this.clearToast(), ms);
  }

  clearToast(): void {
    clearTimeout(this.toastTimer);
    if (!this.toast) return;
    this.toast = null;
    this.notify();
  }

  /** Close everything (module off). */
  reset(): void {
    clearTimeout(this.toastTimer);
    this.popover = null;
    this.note = null;
    this.toast = null;
    this.notify();
  }
}

export const annotationUi = new AnnotationUi();
