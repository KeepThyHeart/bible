import { CommandBox, CommandSearchResults } from '../../lib/command';
import type { PresentItem, PresentState } from '../../lib/protocol';
import { presenterSend } from '../presenterSink';

export interface CommandAreaProps {
  /** The wall state: relative commands ("next", bare verses) and the search's translation read it. */
  state: PresentState | null;
  /** Puts an item into the notes; the label is what the search result showed. */
  onAddToNotes?: (item: PresentItem, label?: string) => void;
  onHelp?: () => void;
}

/**
 * The top of the Control pane: the command box, with its search results in
 * the flow right below (they push the rest of Control down, and never cover
 * the preview).
 */
export function CommandArea(props: CommandAreaProps) {
  const sink = presenterSend;
  return (
    <div class="pz-command" data-slot="command-area">
      <CommandBox variant="panel" searchEnabled sink={sink} state={props.state} onHelp={props.onHelp} />
      <div class="pz-command__results">
        <CommandSearchResults variant="panel" sink={sink} state={props.state} onAddToNotes={props.onAddToNotes} />
      </div>
    </div>
  );
}
