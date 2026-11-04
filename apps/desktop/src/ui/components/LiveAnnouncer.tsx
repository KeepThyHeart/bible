import React, { useEffect, useState } from 'react';
import { useI18n } from '../contexts/useI18n';
import { registerAnnouncerSink, registerAnnouncerTranslator } from '../services/announcer';

/** The single app-level live region pair. Mount once (App, detached windows). */
export const LiveAnnouncer: React.FC = () => {
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');
  const { t } = useI18n();
  useEffect(() => {
    registerAnnouncerTranslator((key, params) => t(key, params as never));
    return () => registerAnnouncerTranslator(null);
  }, [t]);
  useEffect(() => {
    registerAnnouncerSink((text, isAssertive) => (isAssertive ? setAssertive(text) : setPolite(text)));
    return () => registerAnnouncerSink(null);
  }, []);
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="live-announcer">
        {polite}
      </div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true" data-testid="live-announcer-assertive">
        {assertive}
      </div>
    </>
  );
};

export default LiveAnnouncer;
