import { useState, useEffect } from 'preact/hooks';
import { useTranslation } from 'react-i18next';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { API_BASE } from '../../utils/apiUrl';

interface FeedbackDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Kept in step with the server's accepted categories in `feedbackRoutes.ts`. */
const CATEGORIES = ['bug', 'idea', 'other'] as const;
type FeedbackCategory = typeof CATEGORIES[number];

type SubmitState = 'idle' | 'sending' | 'sent' | 'error';

export function FeedbackDialog({ isOpen, onClose }: FeedbackDialogProps) {
  const { t } = useTranslation();
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState<FeedbackCategory>('other');
  const [contact, setContact] = useState('');
  const [state, setState] = useState<SubmitState>('idle');

  useEscapeKey(isOpen, onClose);

  // Reset only on *open*, never on close: a failed submit leaves the dialog
  // open holding the user's text, and clearing on close would throw away a
  // draft the moment they pressed Escape to go look something up.
  useEffect(() => {
    if (!isOpen) return;
    setState('idle');
  }, [isOpen]);

  if (!isOpen) return null;

  const trimmed = message.trim();
  const canSubmit = trimmed.length > 0 && state !== 'sending';

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    if (!canSubmit) return;
    setState('sending');
    try {
      const res = await fetch(`${API_BASE}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          category,
          ...(contact.trim() ? { contact: contact.trim() } : {}),
        }),
      });
      if (!res.ok) throw new Error(`Feedback request failed: ${res.status}`);
      // Only clear the fields once the server has actually taken the message.
      setMessage('');
      setContact('');
      setState('sent');
    } catch (err) {
      console.error('Failed to send feedback:', err);
      // State moves to 'error' but `message` is untouched, so the user's text
      // survives a failed send and the retry button resubmits it as-is.
      setState('error');
    }
  };

  return (
    <div class="settings-panel-overlay" onClick={onClose}>
      <div class="feedback-dialog" onClick={(e) => e.stopPropagation()}>
        <div class="feedback-dialog__header">
          <h3>
            <i class="fa-solid fa-comment-dots" style={{ marginRight: '8px', opacity: 0.5 }} />
            {t('feedbackDialog.title')}
          </h3>
          <button class="feedback-dialog__close" onClick={onClose} title={t('feedbackDialog.close')}>
            <i class="fa-solid fa-xmark" />
          </button>
        </div>

        {state === 'sent' ? (
          <div class="feedback-dialog__body">
            <div class="feedback-dialog__status feedback-dialog__status--success" data-testid="feedback-success">
              <i class="fa-solid fa-circle-check" />
              <div>
                <strong>{t('feedbackDialog.successTitle')}</strong>
                <p>{t('feedbackDialog.successBody')}</p>
              </div>
            </div>
            <div class="feedback-dialog__actions">
              <button type="button" class="feedback-dialog__btn feedback-dialog__btn--primary" onClick={onClose}>
                {t('feedbackDialog.close')}
              </button>
            </div>
          </div>
        ) : (
          <form class="feedback-dialog__body" onSubmit={handleSubmit}>
            <p class="feedback-dialog__intro">{t('feedbackDialog.intro')}</p>

            {state === 'error' && (
              <div class="feedback-dialog__status feedback-dialog__status--error" role="alert" data-testid="feedback-error">
                <i class="fa-solid fa-triangle-exclamation" />
                <div>
                  <strong>{t('feedbackDialog.errorTitle')}</strong>
                  <p>{t('feedbackDialog.errorBody')}</p>
                </div>
              </div>
            )}

            <label class="feedback-dialog__field">
              <span class="feedback-dialog__label">
                {t('feedbackDialog.categoryLabel')}
                <small> ({t('feedbackDialog.categoryOptional')})</small>
              </span>
              <select
                class="feedback-dialog__select"
                value={category}
                data-testid="feedback-category"
                onChange={(e) => setCategory((e.target as HTMLSelectElement).value as FeedbackCategory)}
              >
                <option value="bug">{t('feedbackDialog.categoryBug')}</option>
                <option value="idea">{t('feedbackDialog.categoryIdea')}</option>
                <option value="other">{t('feedbackDialog.categoryOther')}</option>
              </select>
            </label>

            <label class="feedback-dialog__field">
              <span class="feedback-dialog__label">{t('feedbackDialog.messageLabel')}</span>
              <textarea
                class="feedback-dialog__textarea"
                rows={6}
                required
                maxLength={5000}
                autofocus
                data-testid="feedback-message"
                placeholder={t('feedbackDialog.messagePlaceholder')}
                value={message}
                onInput={(e) => setMessage((e.target as HTMLTextAreaElement).value)}
              />
            </label>

            <label class="feedback-dialog__field">
              <span class="feedback-dialog__label">
                {t('feedbackDialog.contactLabel')}
                <small> ({t('feedbackDialog.contactOptional')})</small>
              </span>
              <input
                type="text"
                class="feedback-dialog__input"
                maxLength={200}
                data-testid="feedback-contact"
                placeholder={t('feedbackDialog.contactPlaceholder')}
                value={contact}
                onInput={(e) => setContact((e.target as HTMLInputElement).value)}
              />
            </label>

            <div class="feedback-dialog__actions">
              <button type="button" class="feedback-dialog__btn" onClick={onClose}>
                {t('feedbackDialog.cancel')}
              </button>
              <button
                type="submit"
                class="feedback-dialog__btn feedback-dialog__btn--primary"
                disabled={!canSubmit}
                data-testid="feedback-submit"
              >
                {state === 'sending' ? t('feedbackDialog.submitting') : t('feedbackDialog.submit')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
