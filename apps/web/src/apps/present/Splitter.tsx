import { useRef } from 'preact/hooks';

/**
 * A draggable divider between two panes of the Presenter grid.
 *
 * `vertical` is a vertical bar (it separates columns and drags sideways);
 * `horizontal` separates rows. It reports raw pointer positions and leaves the
 * arithmetic (and the remembering) to its parent. The arrow keys nudge it, and
 * because they `preventDefault` the presenter shortcuts stand down while it has
 * focus, so resizing never also steps the screen.
 */
export function Splitter(props: {
  orientation: 'vertical' | 'horizontal';
  label: string;
  onDrag: (clientX: number, clientY: number) => void;
  onDragEnd: () => void;
  /** -1 toward the start (left/up), +1 toward the end (right/down). */
  onNudge: (direction: -1 | 1) => void;
}) {
  const dragging = useRef(false);
  const vertical = props.orientation === 'vertical';

  return (
    <div
      class={`pz-splitter pz-splitter--${props.orientation}`}
      role="separator"
      aria-orientation={props.orientation}
      aria-label={props.label}
      tabIndex={0}
      onPointerDown={event => {
        dragging.current = true;
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={event => {
        if (dragging.current) props.onDrag(event.clientX, event.clientY);
      }}
      onPointerUp={event => {
        if (!dragging.current) return;
        dragging.current = false;
        try { (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId); } catch { /* already released */ }
        props.onDragEnd();
      }}
      onPointerCancel={() => { dragging.current = false; props.onDragEnd(); }}
      onKeyDown={event => {
        const back = vertical ? 'ArrowLeft' : 'ArrowUp';
        const forward = vertical ? 'ArrowRight' : 'ArrowDown';
        if (event.key !== back && event.key !== forward) return;
        event.preventDefault();
        props.onNudge(event.key === back ? -1 : 1);
      }}
    />
  );
}
