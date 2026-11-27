/**
 * Mounts the "Compile passage notes" dialog once per window and opens it on
 * the `command:notes:compilePassageNotes` event.
 */
import React, { useCallback, useEffect, useState } from 'react';
import CompilePassageNotesDialog from './CompilePassageNotesDialog';
import { COMPILE_PASSAGE_NOTES_EVENT, type CompileRequestDetail } from '../../../services/compile/compileRequest';
import { requestOpenNote } from '../UserNotesPane/noteOpenRequest';
import { revealNotesPanel } from '../../bible/revealNotesPanel';

interface CompilePassageNotesHostProps {
  /** Pop-out windows have no workbench to reveal a Notes pane in. */
  isDetached?: boolean;
}

const CompilePassageNotesHost: React.FC<CompilePassageNotesHostProps> = ({ isDetached = false }) => {
  const [request, setRequest] = useState<CompileRequestDetail | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      setRequest((e as CustomEvent<CompileRequestDetail | undefined>).detail ?? {});
    };
    window.addEventListener(COMPILE_PASSAGE_NOTES_EVENT, onOpen);
    return () => window.removeEventListener(COMPILE_PASSAGE_NOTES_EVENT, onOpen);
  }, []);

  const handleClose = useCallback(() => setRequest(null), []);
  const handleCreated = useCallback(
    (path: string) => {
      if (!isDetached) revealNotesPanel();
      requestOpenNote(path);
    },
    [isDetached]
  );

  if (!request) return null;
  return (
    <CompilePassageNotesDialog
      open
      initialReference={request.reference}
      initialOptions={request.initialOptions}
      onClose={handleClose}
      onCreated={handleCreated}
    />
  );
};

export default CompilePassageNotesHost;
