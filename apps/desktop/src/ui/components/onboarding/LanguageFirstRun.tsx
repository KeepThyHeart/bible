import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SUPPORTED_CONTENT_LANGUAGES, type StarterPack } from '@bible/core';
import { useI18n } from '../../contexts/useI18n';
import { selectableLocales } from '../PreferencesDialog/GeneralSection';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useOnboardingStore } from '../../stores/useOnboardingStore';
import {
  areLocaleCatalogsReady,
  whenLocaleCatalogsReady,
} from '../../services/localeCatalogsReady';
import type { LocaleMetadata } from '../../services/II18nService';

/**
 * First-run language question, plus the content suggestion that follows from
 * the answer.
 *
 * ## Why this is a dialog when `WelcomeBar` deliberately is not
 *
 * The welcome bar's argument against being modal - "a new user's first
 * interaction should be with the app, not with a wizard" - does not transfer.
 * A user who cannot read the UI cannot interact with the app at all, so
 * language is the one question that has to be answered before anything else
 * is useful. It is also asked exactly once per install and takes one click.
 *
 * ## Two steps, and why the second one can be empty
 *
 * 1. **Language.** The four languages in `SUPPORTED_CONTENT_LANGUAGES` are
 *    listed first because those are the ones we intend to have study content
 *    for. Every other *offered* locale stays reachable behind a disclosure -
 *    hiding a working translation to keep a list short would be a regression,
 *    and the app ships more catalogs than it ships content for.
 *
 *    Which locales are offered at all is decided by `selectableLocales()` in
 *    `PreferencesDialog/GeneralSection.tsx` - the single gate shared with the
 *    Preferences language picker, so the two can never disagree. When it
 *    leaves only one language there is no question to ask, and this step is
 *    skipped outright rather than rendered as a one-item radio group.
 * 2. **Suggested content.** Starter packs for the chosen language, if the
 *    catalog offers any. It frequently offers none: `hi` has no Bible
 *    translation confirmed to be public domain (see the note on
 *    `SUPPORTED_CONTENT_LANGUAGES`), and an offline install has no catalog at
 *    all. So this step renders an honest "nothing to suggest yet, here is
 *    where to look later" rather than an empty list or a spinner that never
 *    resolves - and the whole step is skipped when step 1 produced nothing to
 *    ask about.
 *
 * The dialog never blocks on the network: the pack lookup is fired after the
 * language is committed, and any failure degrades to the empty state. It does
 * wait for the locale catalogs to load before appearing at all, because the
 * list of languages is exactly what is missing until they do.
 */

/** Locale shown when the user has never been asked and nothing is persisted. */
const DEFAULT_LOCALE = 'en';

type Step = 'language' | 'content';

interface LanguageOptionProps {
  info: LocaleMetadata;
  selected: boolean;
  onSelect: (code: string) => void;
}

const LanguageOption: React.FC<LanguageOptionProps> = ({ info, selected, onSelect }) => {
  const { t } = useI18n();
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onSelect(info.code)}
      data-testid={`first-run-language-${info.code}`}
      className={[
        'flex w-full items-baseline gap-sm rounded border px-md py-sm text-start',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        selected
          ? 'border-accent bg-accent-soft text-text-primary'
          : 'border-border bg-background hover:bg-background-hover text-text-primary',
      ].join(' ')}
    >
      {/* The endonym leads: someone who cannot read the UI language is
          scanning for their own language written the way they write it. */}
      <span className="text-base font-medium" lang={info.code}>
        {info.nativeName}
      </span>
      {info.nativeName !== info.name && (
        <span className="text-sm text-text-secondary">{info.name}</span>
      )}
      {info.status === 'draft' && (
        // Never imply a review that did not happen - every non-English
        // catalog here is machine-drafted.
        <span className="ms-auto flex-shrink-0 rounded bg-background-hover px-xs text-xs text-text-secondary">
          {t('onboarding.language.draftBadge')}
        </span>
      )}
    </button>
  );
};

const LanguageFirstRun: React.FC = () => {
  const { i18n, t } = useI18n();
  const markLanguageChosen = useOnboardingStore((s) => s.markLanguageChosen);
  // Read ONCE, at mount, rather than subscribing.
  //
  // Committing the language calls `markLanguageChosen()` while the dialog is
  // still on screen - step 2 has yet to be shown. A live subscription would
  // flip this to true at that moment and unmount the whole dialog mid-flow,
  // so the user would pick a language and never see the content step at all.
  // What this component needs is "had the question been answered when I
  // opened?", which is a snapshot, not a subscription.
  const [answeredBefore] = useState(() => useOnboardingStore.getState().languageChosen);

  const [step, setStep] = useState<Step>('language');
  const [selected, setSelected] = useState<string>(i18n.currentLocale || DEFAULT_LOCALE);
  const [showAll, setShowAll] = useState(false);
  const [packs, setPacks] = useState<StarterPack[] | null>(null);
  const [dismissed, setDismissed] = useState(false);
  // Locale catalogs arrive asynchronously and `loadCatalog()` fires no event,
  // so a picker rendered at first paint would list only the statically
  // bundled `en` and never learn about the rest. Wait for the load to settle
  // before showing anything - see `services/localeCatalogsReady.ts`.
  const [catalogsReady, setCatalogsReady] = useState(areLocaleCatalogsReady);

  useEffect(() => {
    if (catalogsReady) return;
    let cancelled = false;
    void whenLocaleCatalogsReady().then(() => {
      if (!cancelled) setCatalogsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [catalogsReady]);

  const open = !answeredBefore && !dismissed && catalogsReady;
  const containerRef = useFocusTrap<HTMLDivElement>(open);

  // The offered set, not every loaded catalog - see the module doc comment.
  const allLocales = selectableLocales(i18n.availableLocaleInfos, i18n.currentLocale);

  // One language means no question. A single-item radio group is a dead
  // control whose only possible answer is the one already highlighted.
  const languageChoiceNeeded = allLocales.length > 1;

  // Split into "languages we intend to have content for" and everything else.
  // `SUPPORTED_CONTENT_LANGUAGES` drives the order so the list does not
  // reshuffle as translation status changes.
  const { featured, others } = useMemo(() => {
    const byCode = new Map(allLocales.map((info) => [info.code, info]));
    const featuredList: LocaleMetadata[] = [];
    for (const code of SUPPORTED_CONTENT_LANGUAGES) {
      const info = byCode.get(code);
      // A supported language whose catalog failed to load is simply absent
      // rather than a broken row - the picker must still work.
      if (info) featuredList.push(info);
    }
    const featuredCodes = new Set(featuredList.map((i) => i.code));
    const otherList = allLocales.filter((info) => !featuredCodes.has(info.code));
    return { featured: featuredList, others: otherList };
  }, [allLocales]);

  // Keep the highlighted row in step with the live locale until the user
  // touches the control, so the dialog opens on whatever the app detected.
  useEffect(() => {
    setSelected((current) => (current ? current : i18n.currentLocale || DEFAULT_LOCALE));
  }, [i18n.currentLocale]);

  const handleConfirmLanguage = useCallback(async () => {
    // Switch first so step 2 renders in the language just chosen.
    if (selected && selected !== i18n.currentLocale) {
      try {
        await i18n.setLocale(selected);
      } catch {
        // A failed switch must not trap the user in the dialog; they can
        // change language later in Preferences.
      }
    }
    markLanguageChosen();
    setStep('content');

    // Ask for suggestions AFTER committing the language. Failures (offline,
    // no catalog configured, a catalog that lists no starter packs) all land
    // on the same empty state - there is nothing actionable to distinguish.
    try {
      const api = window.electron?.moduleManager;
      const result = await api?.getStarterPacks?.(selected);
      setPacks(result && result.ok && Array.isArray(result.value) ? result.value : []);
    } catch {
      setPacks([]);
    }
  }, [i18n, markLanguageChosen, selected]);

  const handleClose = useCallback(() => {
    // Closing from step 2 is a completed flow. Closing from step 1 (Escape,
    // or the close button) still counts as answered: re-asking on every
    // launch would be nagging, and Preferences owns the setting from here on.
    markLanguageChosen();
    setDismissed(true);
  }, [markLanguageChosen]);

  // Skipping step 1 still has to *commit* it: the locale is confirmed, the
  // question is recorded as answered, and the pack lookup that step 2 renders
  // is fired. Guarded by a ref rather than by `step`, because the commit is
  // async and a re-render before it lands would otherwise fire it twice.
  //
  // `open` gates this so the commit waits for the catalogs - before they load
  // only the statically bundled `en` is known, and every install would look
  // like a one-language install.
  const autoCommitted = useRef(false);
  useEffect(() => {
    if (!open || languageChoiceNeeded || autoCommitted.current) return;
    autoCommitted.current = true;
    void handleConfirmLanguage();
  }, [open, languageChoiceNeeded, handleConfirmLanguage]);

  if (!open) return null;

  // Never paint the language step when there is nothing to choose: `step` is
  // still 'language' for the one render before the auto-commit effect runs.
  const onLanguageStep = step === 'language' && languageChoiceNeeded;

  const visibleOthers = showAll ? others : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-lg"
      data-testid="first-run-language-backdrop"
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-run-language-title"
        data-testid="first-run-language-dialog"
        className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-background shadow-lg"
      >
        <div className="flex-shrink-0 border-b border-border px-lg py-md">
          <h2 id="first-run-language-title" className="text-lg font-semibold text-text-primary">
            {onLanguageStep
              ? t('onboarding.language.title')
              : t('onboarding.language.contentTitle')}
          </h2>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-lg py-md">
          {onLanguageStep ? (
            <>
              <p className="mb-md text-sm text-text-secondary">
                {t('onboarding.language.intro')}
              </p>

              <div
                role="radiogroup"
                aria-labelledby="first-run-language-title"
                className="flex flex-col gap-xs"
              >
                {featured.map((info) => (
                  <LanguageOption
                    key={info.code}
                    info={info}
                    selected={info.code === selected}
                    onSelect={setSelected}
                  />
                ))}

                {visibleOthers.map((info) => (
                  <LanguageOption
                    key={info.code}
                    info={info}
                    selected={info.code === selected}
                    onSelect={setSelected}
                  />
                ))}
              </div>

              {others.length > 0 && !showAll && (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  data-testid="first-run-language-more"
                  className="mt-sm text-sm text-accent underline hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {t('onboarding.language.showMore', { count: others.length })}
                </button>
              )}
            </>
          ) : (
            <StarterPackStep packs={packs} onClose={handleClose} />
          )}
        </div>

        <div className="flex flex-shrink-0 items-center justify-end gap-sm border-t border-border px-lg py-md">
          {onLanguageStep ? (
            <button
              type="button"
              onClick={() => void handleConfirmLanguage()}
              data-testid="first-run-language-continue"
              className="rounded bg-accent px-lg py-sm text-sm text-text-on-accent hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {t('onboarding.language.continue')}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleClose}
              data-testid="first-run-language-done"
              className="rounded bg-accent px-lg py-sm text-sm text-text-on-accent hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {t('onboarding.language.done')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

interface StarterPackStepProps {
  /** `null` while the lookup is in flight; `[]` once it resolved with nothing. */
  packs: StarterPack[] | null;
  onClose: () => void;
}

/**
 * Step 2 - what we can offer in the chosen language.
 *
 * Installing is deliberately NOT wired to a one-click button here. A starter
 * pack is several hundred megabytes of separately-licensed content, and each
 * module's licence is presented by the Module Manager before its download.
 * Short-circuiting that for a first-run convenience button would put content
 * on disk whose terms the user was never shown. So this step names what is
 * available and points at the Module Manager, which already does the job
 * properly.
 */
const StarterPackStep: React.FC<StarterPackStepProps> = ({ packs }) => {
  const { t } = useI18n();

  if (packs === null) {
    return (
      <p className="text-sm text-text-secondary" data-testid="first-run-packs-loading">
        {t('onboarding.language.packsLoading')}
      </p>
    );
  }

  if (packs.length === 0) {
    return (
      <div data-testid="first-run-packs-empty">
        <p className="text-sm text-text-primary">
          {t('onboarding.language.packsEmpty')}
        </p>
        <p className="mt-sm text-sm text-text-secondary">
          {t('onboarding.language.packsEmptyHint')}
        </p>
      </div>
    );
  }

  return (
    <div data-testid="first-run-packs-list">
      <p className="mb-md text-sm text-text-secondary">
        {t('onboarding.language.packsIntro')}
      </p>
      <ul className="flex flex-col gap-sm">
        {packs.map((pack) => (
          <li
            key={pack.pack_id}
            className="rounded border border-border px-md py-sm"
            data-testid={`first-run-pack-${pack.pack_id}`}
          >
            <p className="text-sm font-medium text-text-primary">{pack.name}</p>
            <p className="mt-xs text-sm text-text-secondary">{pack.description}</p>
            <p className="mt-xs text-xs text-text-secondary">
              {t('onboarding.language.packModuleCount', { count: pack.module_ids.length })}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default LanguageFirstRun;
