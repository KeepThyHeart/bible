import { useRef, useCallback } from 'preact/hooks';

interface ResizeHandleProps {
  onResize: (deltaX: number) => void;
}

export function ResizeHandle({ onResize }: ResizeHandleProps) {
  const startX = useRef(0);

  const handleMouseDown = useCallback((e: MouseEvent) => {
    e.preventDefault();
    startX.current = e.clientX;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX.current;
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
  }, [onResize]);

  return (
    <div class="resize-handle" onMouseDown={handleMouseDown}>
      <div class="resize-handle__line" />
    </div>
  );
}
