import type { TFunction } from 'i18next';
import type { Localizer, RemoteSemantic } from '@bible/core/browser';
import { useTranslation } from 'react-i18next';
import { useLocalizer } from '../../hooks/useLocalizer';

/** The one-line note for a semantic result set, or null when there is nothing to say. */
export function semanticNoteText(
  meta: RemoteSemantic.SemanticMeta | undefined,
  t: TFunction,
  localizer: Localizer,
): string | null {
  const n = meta?.notice;
  if (!n) return null;
  switch (n.kind) {
    case 'declined': return t('remoteSemantic.note.declined');
    case 'degraded': return t('remoteSemantic.note.degraded');
    case 'unavailable': return t('remoteSemantic.note.unavailable');
    case 'rephrase': return t('remoteSemantic.note.rephrase');
    case 'paused': return t('remoteSemantic.note.paused');
    case 'quota': {
      if (!n.resetAtMs) return t('remoteSemantic.note.quotaNoTime');
      const time = localizer.formatDate(new Date(n.resetAtMs), { hour: 'numeric', minute: '2-digit' });
      return t('remoteSemantic.note.quota', { time });
    }
    default: return null;
  }
}

export function SemanticNote({ meta }: { meta: RemoteSemantic.SemanticMeta | undefined }) {
  const { t } = useTranslation();
  const localizer = useLocalizer();
  const text = semanticNoteText(meta, t as TFunction, localizer);
  if (!text) return null;
  return <div class="semantic-note" role="status" data-testid="semantic-note">{text}</div>;
}
