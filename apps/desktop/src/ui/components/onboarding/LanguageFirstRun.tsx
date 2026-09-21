import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SUPPORTED_CONTENT_LANGUAGES, type OfferedStarterPack, type CatalogModule } from '@bible/core';
import { useI18n } from '../../contexts/useI18n';
import { selectableLocales } from '../PreferencesDialog/GeneralSection';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useOnboardingStore } from '../../stores/useOnboardingStore';
import { useNetworkStore } from '../../stores/useNetworkStore';
import { useModuleStore } from '../../stores/useModuleStore';
import { openModuleManager } from '../../utils/openModuleManager';
import {
  areLocaleCatalogsReady,
  whenLocaleCatalogsReady,
} from '../../services/localeCatalogsReady';
import type { LocaleMetadata } from '../../services/II18nService';

/**
 * First-run language question, the network consent question that follows it,
 * and the content suggestion that follows THAT.
 *
 * ## Why this is a dialog when `WelcomeBar` deliberately is not
 *
 * The welcome bar's argument against being modal - "a new user's first
 * interaction should be with the app, not with a wizard" - does not transfer.
 * A user who cannot read the UI cannot interact with the app at all, so
 * language is the one question that has to be answered before anything else
 * is useful. It is also asked exactly once per install and takes one click.
 *
 * ## Three steps, and why two of them can be skipped
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
 * 2. **Network.** A fresh install is offline (`allowNetwork=false` by design -
 *    see `electron/services/NetworkConfig.ts`) and the only switch used to be
 *    a menu item nobody would find. Shown only once the shared
 *    `useNetworkStore` has definitely loaded AND definitely says the switch is
 *    off - if the store hasn't answered yet, this step is skipped rather than
 *    stalling the flow on an unresolved read, and the content step below
 *    falls back to its own (always-safe) offline rendering. Going online here
 *    goes through the exact same `requestAllow()` - and therefore the same
 *    native confirmation dialog - as the Privacy menu and Preferences; a
 *    cancelled dialog leaves this step exactly as it was.
 * 3. **Suggested content.** Starter packs for the chosen language, if the
 *    catalog offers any; otherwise the catalog's recommended modules for that
 *    language (the published catalog has modules but no `starter_packs`
 *    section), Bible first, installed through the same card. Region codes fall
 *    back to the base language (`en-US` -> `en`) for both lookups. It can
 *    still offer nothing: `hi` has no Bible
 *    translation confirmed to be public domain (see the note on
 *    `SUPPORTED_CONTENT_LANGUAGES`), and an offline install has no catalog at
 *    all. So this step renders an honest "nothing to suggest yet" state - with
 *    a way to go online or install from a file while offline, or a shortcut to
 *    the Module Manager while online - rather than an empty list or a spinner
 *    that never resolves.
 *
 * The dialog never blocks on the network: the pack lookup is fired after the
 * language (and, if asked, the network question) is settled, and any failure
 * degrades to the empty state. It does wait for the locale catalogs to load
 * before appearing at all, because the list of languages is exactly what is
 * missing until they do.
 */

/** Locale shown when the user has never been asked and nothing is persisted. */
const DEFAULT_LOCALE = 'en';

type Step = 'language' | 'network' | 'content';

/** What step 3 can put in front of the user for a language. */
interface ContentOffer {
  packs: OfferedStarterPack[];
  /** Recommended catalog modules, Bible first. Only populated when `packs` is empty. */
  modules: CatalogModule[];
}

/**
 * Language codes to try, most specific first: `en-US` -> `en`. Catalog entries
 * and starter packs are keyed by the bare language (only `en` is published
 * today), while the UI locale can carry a region.
 */
function languageCandidates(languageCode: string): string[] {
  const base = languageCode.split(/[-_]/)[0];
  return base && base !== languageCode ? [languageCode, base] : [languageCode];
}

/**
 * Starter packs for the language, else its recommended catalog modules.
 *
 * The official catalog has published modules without any `starter_packs`
 * section, so "no packs" must not be reported as "no content". Any failure
 * degrades to an empty offer.
 */
async function findOffer(languageCode: string): Promise<ContentOffer> {
  const api = window.electron?.moduleManager;
  const candidates = languageCandidates(languageCode);

  for (const code of candidates) {
    try {
      const result = await api?.getStarterPacks?.(code);
      if (result && result.ok && Array.isArray(result.value) && result.value.length > 0) {
        return { packs: result.value, modules: [] };
      }
    } catch {
      // Treated as "no packs"; fall through to the module lookup.
    }
  }

  for (const code of candidates) {
    try {
      const result = await api?.searchModules?.({ languageCode: code, recommended: true });
      if (result && result.ok && Array.isArray(result.value) && result.value.length > 0) {
        const modules = result.value as CatalogModule[];
        // Bible first, otherwise catalog order (stable sort).
        const bibleFirst = [...modules].sort(
          (a, b) => Number(b.module_type === 'bible') - Number(a.module_type === 'bible')
        );
        return { packs: [], modules: bibleFirst };
      }
    } catch {
      // Treated as "no modules".
    }
  }

  return { packs: [], modules: [] };
}

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
      {info.status !== 'complete' && (
        // Never imply a review that did not happen - every non-English
        // catalog here is machine-drafted. `selectableLocales()` already
        // withholds built-in `draft` locales, so a `draft` reaching this
        // component is always user-supplied; `beta` may be either.
        <span
          data-testid={`first-run-language-${info.status}-badge-${info.code}`}
          className="ms-auto flex-shrink-0 rounded bg-background-hover px-xs text-xs text-text-secondary"
        >
          {t(
            info.status === 'beta'
              ? 'onboarding.language.betaBadge'
              : 'onboarding.language.draftBadge',
          )}
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
  // still on screen - later steps have yet to be shown. A live subscription
  // would flip this to true at that moment and unmount the whole dialog
  // mid-flow, so the user would pick a language and never see what follows.
  // What this component needs is "had the question been answered when I
  // opened?", which is a snapshot, not a subscription.
  const [answeredBefore] = useState(() => useOnboardingStore.getState().languageChosen);

  const [step, setStep] = useState<Step>('language');
  const [selected, setSelected] = useState<string>(i18n.currentLocale || DEFAULT_LOCALE);
  const [showAll, setShowAll] = useState(false);
  const [offer, setOffer] = useState<ContentOffer | null>(null);
  const [dismissed, setDismissed] = useState(false);
  // Shown on the network step while `requestAllow(true)` -> `refreshAllCatalogs()`
  // is in flight, between the user confirming the native dialog and the
  // content step appearing.
  const [catalogLoading, setCatalogLoading] = useState(false);
  // Locale catalogs arrive asynchronously and `loadCatalog()` fires no event,
  // so a picker rendered at first paint would list only the statically
  // bundled `en` and never learn about the rest. Wait for the load to settle
  // before showing anything - see `services/localeCatalogsReady.ts`.
  const [catalogsReady, setCatalogsReady] = useState(areLocaleCatalogsReady);

  const allowWebRequests = useNetworkStore((s) => s.allowWebRequests);
  const requestAllow = useNetworkStore((s) => s.requestAllow);

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

  // Boot's own `useNetworkStore.getState().load()` (main.tsx) usually wins the
  // race, but this dialog must not depend on load order - the network step's
  // decision below reads the store fresh, so it needs the load to have been
  // requested at least once.
  useEffect(() => {
    void useNetworkStore.getState().load();
  }, []);

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

  // Ask for suggestions for `languageCode`: starter packs first, then - because
  // the published catalog may carry modules but no `starter_packs` section at
  // all - its recommended modules for that language. Failures (offline, no
  // catalog configured, nothing published) all land on the same empty state -
  // there is nothing actionable to distinguish, and this never itself makes a
  // network request (it reads whatever catalog is cached).
  const fetchPacksFor = useCallback(async (languageCode: string) => {
    setOffer(await findOffer(languageCode));
  }, []);

  const handleConfirmLanguage = useCallback(async () => {
    // Switch first so later steps render in the language just chosen.
    if (selected && selected !== i18n.currentLocale) {
      try {
        await i18n.setLocale(selected);
      } catch {
        // A failed switch must not trap the user in the dialog; they can
        // change language later in Preferences.
      }
    }
    markLanguageChosen();

    // Only insert the network step when the store has DEFINITELY answered
    // "off" - an unresolved read (bridge not wired, still in flight) skips
    // straight to content rather than asking a question we cannot yet
    // justify. The content step's own offline rendering falls back to the
    // same safe (fail-closed) assumption independently, so nothing is lost.
    const netState = useNetworkStore.getState();
    if (netState.loaded && !netState.allowWebRequests) {
      setStep('network');
      return;
    }

    setStep('content');
    await fetchPacksFor(selected);
  }, [i18n, markLanguageChosen, selected, fetchPacksFor]);

  // Network step's "Go online". Always goes through `requestAllow()`, which
  // is the renderer's only path to the native confirmation dialog - see
  // `useNetworkStore`'s doc comment. A cancelled dialog resolves `false` and
  // this simply returns, leaving the step exactly as it was.
  const handleGoOnline = useCallback(async () => {
    const allowed = await requestAllow(true);
    if (!allowed) return;

    setCatalogLoading(true);
    try {
      // Read `window.electron` directly rather than through `moduleAPI`
      // (whose `requireElectronAPI()` snapshots `window.electron` once at
      // module import time) - the same reason `fetchPacksFor` above does,
      // and the only way this keeps working across the first-run dialog's
      // full lifetime in a single renderer session.
      await window.electron?.moduleManager?.refreshAllCatalogs?.();
    } catch {
      // A refresh can still fail for ordinary reasons (DNS hiccup, the
      // official catalog momentarily down) even once the switch is on. The
      // content step's honest empty state covers that - never block here.
    } finally {
      setCatalogLoading(false);
    }
    setStep('content');
    await fetchPacksFor(selected);
  }, [requestAllow, selected, fetchPacksFor]);

  const handleStayOffline = useCallback(() => {
    setStep('content');
    void fetchPacksFor(selected);
  }, [selected, fetchPacksFor]);

  const handleClose = useCallback(() => {
    // Closing from any step is a completed flow. Closing from step 1
    // (Escape, or the close button) still counts as answered: re-asking on
    // every launch would be nagging, and Preferences owns the setting from
    // here on.
    markLanguageChosen();
    setDismissed(true);
  }, [markLanguageChosen]);

  // Skipping step 1 still has to *commit* it: the locale is confirmed, the
  // question is recorded as answered, and the next step is decided exactly as
  // `handleConfirmLanguage` would. Guarded by a ref rather than by `step`,
  // because the commit is async and a re-render before it lands would
  // otherwise fire it twice.
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
  const onNetworkStep = step === 'network';

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
              : onNetworkStep
              ? t('onboarding.network.title')
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
          ) : onNetworkStep ? (
            <NetworkStep loading={catalogLoading} />
          ) : (
            <StarterPackStep offer={offer} allowWebRequests={allowWebRequests} onGoOnline={handleGoOnline} />
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
          ) : onNetworkStep ? (
            <>
              <button
                type="button"
                onClick={handleStayOffline}
                disabled={catalogLoading}
                data-testid="first-run-network-stay-offline"
                className="rounded border border-border px-lg py-sm text-sm text-text-primary hover:bg-background-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
              >
                {t('onboarding.network.stayOffline')}
              </button>
              <button
                type="button"
                onClick={() => void handleGoOnline()}
                disabled={catalogLoading}
                data-testid="first-run-network-go-online"
                className="rounded bg-accent px-lg py-sm text-sm text-text-on-accent hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
              >
                {catalogLoading ? t('onboarding.network.loadingCatalog') : t('onboarding.network.goOnline')}
              </button>
            </>
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

/**
 * Network consent step - inserted between language and content only when
 * `useNetworkStore` has definitely loaded and definitely says the switch is
 * off (see the module doc comment). Buying "Go online" and "Stay offline"
 * their own step, rather than folding the question into the content step,
 * keeps the invariant simple to audit: this is the ONLY first-run copy that
 * asks about network access, and it never renders while a catalog load is
 * already answering a question the user has not been asked yet.
 */
const NetworkStep: React.FC<{ loading: boolean }> = ({ loading }) => {
  const { t } = useI18n();
  if (loading) {
    return (
      <p className="text-sm text-text-secondary" data-testid="first-run-network-loading">
        {t('onboarding.network.loadingCatalog')}
      </p>
    );
  }
  return (
    <p className="text-sm text-text-secondary" data-testid="first-run-network-body">
      {t('onboarding.network.body')}
    </p>
  );
};

/**
 * One row of a starter pack's module list: a checkbox, name, licence and size,
 * always visible. The whole row is the label, so the name is a click target.
 */
const StarterPackModuleRow: React.FC<{
  module: CatalogModule;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}> = ({ module, checked, disabled, onToggle }) => {
  const { t } = useI18n();
  return (
    <li data-testid={`first-run-pack-module-${module.module_id}`}>
      <label className="flex cursor-pointer items-baseline gap-sm text-xs text-text-secondary">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
          data-testid={`first-run-pack-module-check-${module.module_id}`}
          className="translate-y-[2px]"
        />
        <span className="flex-1 text-text-primary">{module.name}</span>
        <span className="whitespace-nowrap">
          {t('onboarding.language.packModuleMeta', {
            license: module.license || '—',
            size: formatSize(module.download_size_bytes),
          })}
        </span>
      </label>
    </li>
  );
};

type PackInstallState =
  | { status: 'idle' }
  | { status: 'installing'; index: number; total: number }
  | { status: 'done'; failed: CatalogModule[] };

/**
 * One starter pack: its modules (fetched lazily, with licence + size ALWAYS
 * shown, never behind a toggle) and an Install button.
 *
 * Installing straight from first run used to be deliberately unwired - a
 * starter pack is several hundred megabytes of separately-licensed content,
 * and short-circuiting the licence disclosure for a one-click convenience
 * button would put content on disk whose terms the user was never shown.
 * That objection is met here rather than avoided: every module's licence and
 * size is on screen, unconditionally, before Install can be clicked - at
 * least as much disclosure as `ModuleCard`'s "Show details" toggle in the
 * Module Manager (which starts collapsed).
 */
const StarterPackCard: React.FC<{ pack: OfferedStarterPack }> = ({ pack }) => {
  const [modules, setModules] = useState<CatalogModule[] | null>(null);
  const catalogId = pack.source?.catalogId;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = catalogId !== undefined
          ? await window.electron?.moduleManager?.getStarterPackModules?.(pack.pack_id, catalogId)
          : undefined;
        if (cancelled) return;
        setModules(res && res.ok ? res.value.modules : []);
      } catch {
        if (!cancelled) setModules([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pack.pack_id, catalogId]);

  return (
    <InstallCard
      id={pack.pack_id}
      name={pack.name}
      description={pack.description}
      // Every pack first run offers comes from the verified official
      // catalog (see `getStarterPacksForLanguage`); the badge states that
      // plainly so users learn what "verified" means here.
      verified
      modules={modules}
      catalogId={catalogId}
    />
  );
};

interface InstallCardProps {
  id: string;
  name: string;
  description: string;
  /** Show the "verified official catalog" badge. Only packs may claim it. */
  verified?: boolean;
  /** `null` while still being looked up. */
  modules: CatalogModule[] | null;
  /** Scopes each install to one catalog; undefined for the module fallback. */
  catalogId: number | undefined;
}

/**
 * The module list (licence + size always visible) and Install button shared by
 * starter packs and the recommended-modules fallback.
 */
const InstallCard: React.FC<InstallCardProps> = ({ id, name, description, verified, modules, catalogId }) => {
  const { t } = useI18n();
  const installModule = useModuleStore((s) => s.installModule);
  const loadInstalledModules = useModuleStore((s) => s.loadInstalledModules);
  const [install, setInstall] = useState<PackInstallState>({ status: 'idle' });

  // Everything starts ticked: the recommended set is the easy path, and
  // unticking is how a reader trims it. Reset whenever the list is (re)loaded.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    setSelected(new Set((modules ?? []).map((m) => m.module_id)));
  }, [modules]);

  const chosen = (modules ?? []).filter((m) => selected.has(m.module_id));
  const totalSize = chosen.reduce((sum, m) => sum + (m.download_size_bytes || 0), 0);
  const busy = install.status === 'installing';

  const toggle = (moduleId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });

  const handleInstall = async () => {
    if (chosen.length === 0) return;
    const failed: CatalogModule[] = [];
    for (let i = 0; i < chosen.length; i++) {
      setInstall({ status: 'installing', index: i + 1, total: chosen.length });
      // Scoped to the pack's own catalog - see `IModuleCatalogService.getModuleInfo`'s
      // doc comment for why a bare module id must never be resolved across
      // every enabled catalog here.
      const ok = await installModule(chosen[i].module_id, catalogId);
      if (!ok) failed.push(chosen[i]);
    }
    // `installModule` already reloads the installed list per call; one more
    // pass here is cheap insurance so every reader pane sees the final state
    // even if a mid-loop failure left it out of step.
    await loadInstalledModules();
    setInstall({ status: 'done', failed });
  };

  return (
    <li
      className="rounded border border-border px-md py-sm"
      data-testid={`first-run-pack-${id}`}
    >
      <div className="flex items-baseline gap-xs">
        <p className="text-sm font-medium text-text-primary">{name}</p>
        {verified && (
          <span
            className="rounded bg-success-soft px-xs text-xs text-success-text"
            data-testid={`first-run-pack-verified-${id}`}
          >
            {t('onboarding.packs.verifiedBadge')}
          </span>
        )}
      </div>
      <p className="mt-xs text-sm text-text-secondary">{description}</p>

      {modules === null ? (
        <p className="mt-sm text-xs text-text-secondary">{t('onboarding.language.packModulesLoading')}</p>
      ) : (
        <>
          <ul className="mt-sm flex flex-col gap-xs" data-testid={`first-run-pack-modules-${id}`}>
            {modules.map((module) => (
              <StarterPackModuleRow
                key={module.module_id}
                module={module}
                checked={selected.has(module.module_id)}
                disabled={busy}
                onToggle={() => toggle(module.module_id)}
              />
            ))}
          </ul>
          <p className="mt-xs text-xs text-text-secondary" data-testid={`first-run-pack-summary-${id}`}>
            {t('onboarding.language.packSelectedCount', { selected: chosen.length, count: modules.length })}
            {' · '}
            {t('onboarding.language.packTotalSize', { size: formatSize(totalSize) })}
            {install.status === 'idle' && modules.length > 1 && (
              <>
                {' · '}
                <button
                  type="button"
                  onClick={() => setSelected(chosen.length === modules.length ? new Set() : new Set(modules.map((m) => m.module_id)))}
                  data-testid={`first-run-pack-toggle-all-${id}`}
                  className="text-accent underline hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {chosen.length === modules.length ? t('onboarding.language.packSelectNone') : t('onboarding.language.packSelectAll')}
                </button>
              </>
            )}
          </p>
        </>
      )}

      <div className="mt-sm">
        {install.status === 'idle' && (
          <button
            type="button"
            onClick={() => void handleInstall()}
            disabled={chosen.length === 0}
            data-testid={`first-run-pack-install-${id}`}
            className="rounded bg-accent px-md py-xs text-sm text-text-on-accent hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
          >
            {t('onboarding.language.packInstall')}
          </button>
        )}
        {install.status === 'installing' && (
          <p className="text-sm text-text-secondary" data-testid={`first-run-pack-installing-${id}`}>
            {t('onboarding.language.packInstalling', { current: install.index, total: install.total })}
          </p>
        )}
        {install.status === 'done' && install.failed.length === 0 && (
          <p className="text-sm text-success" data-testid={`first-run-pack-installed-${id}`}>
            {t('onboarding.language.packInstalled')}
          </p>
        )}
        {install.status === 'done' && install.failed.length > 0 && (
          <div data-testid={`first-run-pack-failed-${id}`}>
            <p className="text-sm text-danger">{t('onboarding.language.packInstallPartial')}</p>
            <ul className="mt-xs text-xs text-danger">
              {install.failed.map((m) => (
                <li key={m.module_id}>{m.name}</li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => openModuleManager()}
              className="mt-xs text-sm text-accent underline hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {t('onboarding.language.openModuleManager')}
            </button>
          </div>
        )}
      </div>
    </li>
  );
};

interface StarterPackStepProps {
  /** `null` while the lookup is in flight; empty packs AND modules once it resolved with nothing. */
  offer: ContentOffer | null;
  /** Read live so this step reflects "Go online" happening from within it. */
  allowWebRequests: boolean;
  /** Same handler the network step's own "Go online" button uses. */
  onGoOnline: () => void;
}

/**
 * Step 3 - what we can offer in the chosen language, if the network switch is
 * on, and whatever else there is to do about it if it is not.
 */
const StarterPackStep: React.FC<StarterPackStepProps> = ({ offer, allowWebRequests, onGoOnline }) => {
  const { t } = useI18n();
  const [fileInstall, setFileInstall] = useState<{ message: string; isError: boolean } | null>(null);
  const [fileInstallBusy, setFileInstallBusy] = useState(false);

  const handleInstallFromFile = async () => {
    setFileInstallBusy(true);
    try {
      // Same `window.electron` bridge `StarterPackCard` and `fetchPacksFor`
      // use - see the comment on `handleGoOnline` for why `moduleAPI` is
      // avoided here.
      const response = await window.electron?.moduleManager?.installFromFile?.();
      if (!response) throw new Error('Electron API not available.');
      if (!response.ok) throw new Error(response.error.message);
      const result = response.value;
      if (result === null) return; // User cancelled the picker - no feedback needed.
      const message =
        result.kind === 'single'
          ? t('onboarding.language.installFromFileSuccess', { name: result.moduleName })
          : t('onboarding.language.installFromFilePackSuccess', { count: result.summary.installed.length });
      setFileInstall({ message, isError: false });
    } catch (error) {
      setFileInstall({
        message: t('onboarding.language.installFromFileError', { message: (error as Error).message }),
        isError: true,
      });
    } finally {
      setFileInstallBusy(false);
    }
  };

  if (offer === null) {
    return (
      <p className="text-sm text-text-secondary" data-testid="first-run-packs-loading">
        {t('onboarding.language.packsLoading')}
      </p>
    );
  }

  const { packs, modules } = offer;

  if (packs.length === 0 && modules.length > 0) {
    return (
      <div data-testid="first-run-modules-list">
        <p className="mb-md text-sm text-text-secondary">{t('onboarding.language.recommendedIntro')}</p>
        <ul className="flex flex-col gap-sm">
          <InstallCard
            id="recommended"
            name={t('onboarding.language.recommendedName')}
            description={t('onboarding.language.recommendedDescription')}
            modules={modules}
            catalogId={undefined}
          />
        </ul>
        <p className="mt-md text-xs text-text-secondary">{t('onboarding.language.moreLater')}</p>
      </div>
    );
  }

  if (packs.length === 0) {
    return (
      <div data-testid="first-run-packs-empty">
        {allowWebRequests ? (
          <>
            <p className="text-sm text-text-primary">{t('onboarding.language.packsEmpty')}</p>
            <p className="mt-sm text-sm text-text-secondary">{t('onboarding.language.packsEmptyHint')}</p>
            <button
              type="button"
              onClick={() => openModuleManager()}
              data-testid="first-run-open-module-manager"
              className="mt-sm rounded border border-border px-md py-sm text-sm text-text-primary hover:bg-background-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {t('onboarding.language.openModuleManager')}
            </button>
          </>
        ) : (
          <>
            <p className="mt-sm text-sm text-text-secondary" data-testid="first-run-packs-offline-body">
              {t('onboarding.language.offlineBody')}
            </p>
            <div className="mt-sm flex gap-sm">
              <button
                type="button"
                onClick={onGoOnline}
                data-testid="first-run-packs-go-online"
                className="rounded bg-accent px-md py-sm text-sm text-text-on-accent hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {t('onboarding.network.goOnline')}
              </button>
              <button
                type="button"
                onClick={() => void handleInstallFromFile()}
                disabled={fileInstallBusy}
                data-testid="first-run-install-from-file"
                className="rounded border border-border px-md py-sm text-sm text-text-primary hover:bg-background-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
              >
                {t('onboarding.language.installFromFile')}
              </button>
            </div>
            {fileInstall && (
              <p
                className={`mt-sm text-sm ${fileInstall.isError ? 'text-danger' : 'text-success'}`}
                data-testid="first-run-install-from-file-result"
              >
                {fileInstall.message}
              </p>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div data-testid="first-run-packs-list">
      <p className="mb-md text-sm text-text-secondary">{t('onboarding.language.packsIntro')}</p>
      <ul className="flex flex-col gap-sm">
        {packs.map((pack) => (
          <StarterPackCard key={pack.pack_id} pack={pack} />
        ))}
      </ul>
      <p className="mt-md text-xs text-text-secondary">{t('onboarding.language.moreLater')}</p>
    </div>
  );
};

/** `0 B` / `1.5 MB` / `2.1 GB` - same rounding as `ModuleCard`'s local helper. */
function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, exponent);
  return `${Math.round(value * 100) / 100} ${units[exponent]}`;
}

export default LanguageFirstRun;
