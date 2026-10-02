import { useCallback, useEffect, useRef, useState } from 'react';
import { noteDirectionAPI, type NoteDirectionChoice } from '../../../../services/noteDirectionAPI';

/**
 * The stored default text direction of one note. Loads when `notePath`
 * changes (the Default value until it arrives), saves on change. A failed
 * load or save leaves the in-memory choice in place; it is a display preference.
 */
export function useNoteDirection(notePath: string | undefined): [NoteDirectionChoice, (next: NoteDirectionChoice) => void] {
  const [direction, setDirection] = useState<NoteDirectionChoice>(null);
  const pathRef = useRef(notePath);
  pathRef.current = notePath;

  useEffect(() => {
    setDirection(null);
    if (!notePath) return;
    let cancelled = false;
    noteDirectionAPI.get(notePath).then(
      (d) => { if (!cancelled) setDirection(d); },
      () => { /* keep Default */ },
    );
    return () => { cancelled = true; };
  }, [notePath]);

  const update = useCallback((next: NoteDirectionChoice) => {
    setDirection(next);
    const p = pathRef.current;
    if (p) noteDirectionAPI.set(p, next).catch(() => { /* not persisted; still applied this session */ });
  }, []);

  return [direction, update];
}
