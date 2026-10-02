import { useRef, useCallback } from 'preact/hooks';
import { useDirection } from '@bible/ui';

interface ResizeHandleProps {
  onResize: (deltaX: number) => void;
}

export function ResizeHandle({ onResize }: ResizeHandleProps) {
  const startX = useRef(0);
  const dir = useDirection();

  const handleMouseDown = useCallback((e: MouseEvent) => {
    e.preventDefault();
    startX.current = e.clientX;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      // rtl-physical: pointer deltas are physical; a drag toward inline-end must grow the same pane in RTL
      const physical = moveEvent.clientX - startX.current;
      const delta = dir === 'rtl' && physical !== 0 ? -physical : physical;
      startX.current = moveEvent.clientX;
      onResize(delta);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [onResize, dir]);

  return (
    <div class="resize-handle" onMouseDown={handleMouseDown}>
      <div class="resize-handle__line" />
    </div>
  );
}
