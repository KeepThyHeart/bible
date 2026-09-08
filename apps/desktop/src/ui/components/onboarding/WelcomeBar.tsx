import React, { useCallback } from 'react';
import { useI18n } from '../../contexts/useI18n';
import { useOnboardingStore } from '../../stores/useOnboardingStore';

/**
 * First-run orientation strip, shown once directly under the app header.
 *
 * Deliberately a bar and not a dialog: a new user's first interaction with the
 * app should be with the app, not with a wizard standing in front of it. It
 * costs one row of vertical space, blocks nothing, and disappears for good the
 * moment it is dismissed (or the tour is finished).
 *
 * The dismissal is persisted by `useOnboardingStore`, so it does not come back
 * on the next launch.
 */
const WelcomeBar: React.FC = () => {
  const { t } = useI18n();

  const welcomeDismissed = useOnboardingStore((s) => s.welcomeDismissed);
  const tourCompleted = useOnboardingStore((s) => s.tourCompleted);
  const dismissWelcome = useOnboardingStore((s) => s.dismissWelcome);
  const startTour = useOnboardingStore((s) => s.startTour);

  const handleTakeTour = useCallback(() => {
    dismissWelcome();
    startTour();
  }, [dismissWelcome, startTour]);

  // Finishing the tour is itself an answer to "what is this?", so the bar
  // retires either way rather than lingering until it is separately closed.
  if (welcomeDismissed || tourCompleted) return null;

  return (
    <div
      role="region"
      aria-label={t('onboarding.welcome.regionLabel')}
      data-testid="onboarding-welcome-bar"
      className="flex-shrink-0 flex items-center gap-md border-b border-border bg-accent-soft px-lg py-sm"
    >
      <p className="flex-1 min-w-0 text-sm text-text-primary">
        {t('onboarding.welcome.message')}
      </p>

      <button
        type="button"
        onClick={handleTakeTour}
        data-testid="onboarding-welcome-tour"
        className="flex-shrink-0 px-md py-xs text-sm rounded bg-accent text-text-on-accent hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {t('onboarding.welcome.takeTour')}
      </button>

      <button
        type="button"
        onClick={dismissWelcome}
        data-testid="onboarding-welcome-dismiss"
        aria-label={t('onboarding.welcome.dismissLabel')}
        title={t('onboarding.welcome.dismissLabel')}
        className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded text-text-secondary hover:bg-background-hover hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
};

export default WelcomeBar;
