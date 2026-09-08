import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collapseReferencesStructured, type BookNameFormat, type CollapsedSegment } from '@bible/core';
import { useI18n } from '../../contexts/useI18n';
import { tskPhraseAside, tskPhraseKeyword } from '../../utils/tskPhrase';
import { crossReferenceModuleLabel } from '../../utils/moduleNaming';
import VersePreviewTooltip from '../VersePreviewTooltip';

/**
 * One phrase group inside a cross-reference module's row.
 *
 * TSK does not list a verse's references as one flat run: it groups them under
 * the phrase they belong to ("Yea.", "hath God said"), and a group with no
 * phrase covers the verse as a whole. Reading only `entries` (via
 * `targetVerseIdsFromGroups`) would throw that structure away and print every
 * target of every group as a single undifferentiated line.
 */
export interface CrossReferencePhraseGroup {
  /** Stable key. The module's `group_id`, or the index for a cache-backed group. */
  groupId: number;
  /**
   * The phrase these references hang off, raw from the module. Absent for a
   * whole-verse group. May carry a TSK aside - see `tskPhrase.ts`.
   */
  phrase?: string;
  /**
   * Every target verse id in this group, in module order. Ranges are
   * pre-expanded by the caller so the collapser can render them as `4:9-10`
   * rather than two disjoint references.
   */
  verseIds: number[];
}

/**
 * One cross-reference module's phrase groups for a single verse.
 *
 * Not built from `bible_verse.formatting.crossReferences` - JSON on the
 * Bible module's own verse rows. No shipped module populates that key
 * (bible_kjv.db has 19,672 verses with `formatting` and zero with
 * `crossReferences`), so building from it would leave the inline Study-mode
 * section structurally incapable of showing anything. The real data lives in
 * the registered cross-reference modules (TSK: 63,878 groups / 379,476
 * links).
 */
export interface ModuleCrossReferences {
  /** Registry abbreviation, e.g. `TSKxref`. */
  abbreviation: string;
  /** Full module name, used as the row's tooltip. */
  moduleName: string;
  /** Phrase groups, whole-verse group first. */
  groups: CrossReferencePhraseGroup[];
}

interface CrossReferenceDisplayProps {
  moduleRefs: ModuleCrossReferences[];
  onNavigateToVerse?: (verseId: number) => void;
  showUserRefs?: boolean;
  userRefCount?: number;
}

/**
 * How many references a phrase group shows before collapsing behind a "+N more".
 *
 * The row lives directly under the verse text in Study mode, so it has to stay
 * out of the way: a dense TSK verse can carry 60+ targets, which would push the
 * next verse off the screen. Twelve short references wrap to at most two lines
 * at the default pane width. Applied PER GROUP, not per module - a verse with
 * eight phrases would otherwise show its first phrase and silently hide the
 * rest behind one counter.
 */
const MAX_COLLAPSED_REFS = 12;

/** Grace period before a hovered verse preview closes, so the pointer can reach it. */
const TOOLTIP_HIDE_DELAY_MS = 100;

/** What the hovered verse preview is currently showing. */
interface TooltipState {
  visible: boolean;
  verseId: number;
  endVerseId?: number;
  position: { x: number; y: number };
}

const HIDDEN_TOOLTIP: TooltipState = { visible: false, verseId: 0, position: { x: 0, y: 0 } };

/**
 * Hover-preview plumbing for reference buttons.
 *
 * `useScriptureTooltip` cannot serve these: it keys on `tagName === 'A'` plus
 * the `scripture-link` class, and every reference here is a `<button>` (these
 * activate in-app navigation, not a URL). This is the dockview Study pane's
 * pattern instead - a local state object positioned from the pointer, with a
 * deferred hide so the pointer can travel into the popup without closing it.
 */
export function useVerseHoverPreview(): {
  tooltip: TooltipState;
  show: (verseId: number, endVerseId: number | undefined, event: React.MouseEvent) => void;
  hide: () => void;
  cancelHide: () => void;
  close: () => void;
} {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState>(HIDDEN_TOOLTIP);

  const cancelHide = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const show = useCallback(
    (verseId: number, endVerseId: number | undefined, event: React.MouseEvent) => {
      cancelHide();
      setTooltip({ visible: true, verseId, endVerseId, position: { x: event.clientX, y: event.clientY } });
    },
    [cancelHide]
  );

  const hide = useCallback(() => {
    cancelHide();
    timeoutRef.current = setTimeout(() => {
      setTooltip(prev => ({ ...prev, visible: false }));
    }, TOOLTIP_HIDE_DELAY_MS);
  }, [cancelHide]);

  const close = useCallback(() => setTooltip(prev => ({ ...prev, visible: false })), []);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  return { tooltip, show, hide, cancelHide, close };
}

/**
 * A run of collapsed references, truncated to {@link MAX_COLLAPSED_REFS} with a
 * "+N more" toggle.
 *
 * Truncation happens on `ref` segments only, never mid-separator, so a
 * collapsed run never ends in a dangling "; ".
 */
export const ReferenceRun: React.FC<{
  verseIds: number[];
  /**
   * How many references to show before the rest collapse behind "+N more".
   * `null` means NO limit: every reference renders and no toggle is drawn.
   *
   * The two callers want opposite things. The inline row under each verse in
   * the Bible text keeps the default budget - a dense TSK verse carries 60+
   * targets and would push the next verse off the screen. The dockview Study
   * pane, a dedicated column the reader opened to study cross-references,
   * passes `null`: hiding two thirds of the answer behind a counter is the
   * wrong trade there.
   */
  maxRefs?: number | null;
  /**
   * Book name width. Defaults to 'medium' ("Rom 5:8; 8:32") for the inline row
   * under a verse: 'long' wraps a dense verse onto four lines. The Study pane
   * passes 'short' to match the web pane.
   */
  format?: BookNameFormat;
  onNavigateToVerse?: (verseId: number, endVerseId?: number) => void;
  onHoverReference?: (verseId: number, endVerseId: number | undefined, event: React.MouseEvent) => void;
  onLeaveReference?: () => void;
}> = ({
  verseIds,
  maxRefs = MAX_COLLAPSED_REFS,
  format = 'medium',
  onNavigateToVerse,
  onHoverReference,
  onLeaveReference,
}) => {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  const segments = useMemo(
    () => collapseReferencesStructured(verseIds, { format }),
    [verseIds, format]
  );

  const refCount = segments.filter(s => s.type === 'ref').length;
  // Resolving the budget to a plain number first keeps the truncation loop and
  // the toggle's render condition free of null checks: "unlimited" and
  // "expanded" are simply a budget of `refCount`, which hides nothing.
  const limit = maxRefs === null || expanded ? refCount : maxRefs;
  const hiddenCount = Math.max(0, refCount - limit);

  const visible: CollapsedSegment[] = [];
  if (hiddenCount === 0) {
    visible.push(...segments);
  } else {
    let seen = 0;
    for (const segment of segments) {
      if (segment.type === 'ref') {
        if (seen === limit) break;
        seen++;
      }
      visible.push(segment);
    }
  }

  if (refCount === 0) return null;

  return (
    <>
      {visible.map((segment, index) =>
        segment.type === 'sep' ? (
          <span key={`sep-${index}`}>{segment.text}</span>
        ) : (
          <button
            key={`ref-${segment.verseId}-${index}`}
            type="button"
            className="text-accent hover:text-accent-strong hover:underline"
            onClick={() => onNavigateToVerse?.(segment.verseId, segment.endVerseId)}
            onMouseEnter={event => onHoverReference?.(segment.verseId, segment.endVerseId, event)}
            onMouseLeave={onLeaveReference}
          >
            {segment.label}
          </button>
        ),
      )}
      {(hiddenCount > 0 || expanded) && (
        <>
          {' '}
          <button
            type="button"
            className="text-text-muted hover:text-text-primary underline"
            onClick={() => setExpanded(prev => !prev)}
          >
            {expanded
              ? t('crossReferenceDisplay.showFewerRefs')
              : t('crossReferenceDisplay.showMoreRefs', { count: hiddenCount })}
          </button>
        </>
      )}
    </>
  );
};

/**
 * Compact per-module cross-reference row:
 * `TSK: Yea. Gen 3:1; Rom 1:20  hath God said. Ps 19:1`
 *
 * The phrase groups run INLINE, each keyword in bold followed by its own
 * references, which is how TSK itself prints a verse and what the reader asked
 * for. A heading-per-group (as the dockview Study pane uses) is right for a
 * dedicated pane but triples the height of a row that sits under every verse.
 *
 * References are formatted by `collapseReferencesStructured` from
 * `@bible/core` - the same collapser the web Study pane uses.
 */
const ModuleRefRow: React.FC<{
  moduleRefs: ModuleCrossReferences;
  onNavigateToVerse?: (verseId: number) => void;
  onHoverReference?: (verseId: number, endVerseId: number | undefined, event: React.MouseEvent) => void;
  onLeaveReference?: () => void;
}> = ({ moduleRefs, onNavigateToVerse, onHoverReference, onLeaveReference }) => {
  const { t } = useI18n();

  if (moduleRefs.groups.length === 0) return null;

  return (
    <div
      className="flex flex-wrap items-baseline gap-x-1"
      data-testid={`cross-reference-row-${moduleRefs.abbreviation}`}
    >
      <span className="flex-shrink-0 font-semibold text-text-secondary" title={moduleRefs.moduleName}>
        {crossReferenceModuleLabel(moduleRefs.abbreviation)}:
      </span>
      <span className="text-text-secondary">
        {moduleRefs.groups.map((group, index) => {
          // The raw phrase routinely carries an editorial aside run together
          // with the keyword ("locusts.The word {arbeh,}..."). Printed inline it
          // reads as corrupt data, so only the keyword goes in the flow; the
          // aside stays reachable as the title.
          const keyword = group.phrase ? tskPhraseKeyword(group.phrase) : null;
          const aside = group.phrase ? tskPhraseAside(group.phrase) : null;
          return (
            <React.Fragment key={group.groupId}>
              {index > 0 && <span className="inline-block w-3" />}
              <strong
                className="font-semibold text-text-primary"
                title={aside ?? undefined}
                data-testid="cross-reference-phrase"
              >
                {keyword ?? t('crossReferenceDisplay.overall')}.
              </strong>{' '}
              <ReferenceRun
                verseIds={group.verseIds}
                onNavigateToVerse={onNavigateToVerse}
                onHoverReference={onHoverReference}
                onLeaveReference={onLeaveReference}
              />
            </React.Fragment>
          );
        })}
      </span>
    </div>
  );
};

/**
 * Cross-references for one verse, rendered as a compact line under the verse
 * text rather than as a boxed section: one row per cross-reference module,
 * plus the user's own cross-reference count.
 *
 * Hovering any reference shows the same `VersePreviewTooltip` the Study pane,
 * commentary views and note editors use, so a reader can read the target
 * without leaving the chapter.
 */
const CrossReferenceDisplay: React.FC<CrossReferenceDisplayProps> = ({
  moduleRefs,
  onNavigateToVerse,
  showUserRefs = true,
  userRefCount = 0,
}) => {
  const { t } = useI18n();
  const [showUserReferences, setShowUserReferences] = useState(false);
  const { tooltip, show, hide, cancelHide, close } = useVerseHoverPreview();

  const populated = moduleRefs.filter(m => m.groups.length > 0);

  if (populated.length === 0 && userRefCount === 0) {
    return null;
  }

  return (
    <div className="mt-1 text-sm leading-snug space-y-0.5" data-testid="verse-cross-references">
      {populated.map(module => (
        <ModuleRefRow
          key={module.abbreviation}
          moduleRefs={module}
          onNavigateToVerse={onNavigateToVerse}
          onHoverReference={show}
          onLeaveReference={hide}
        />
      ))}

      {showUserRefs && userRefCount > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowUserReferences(!showUserReferences)}
            className="text-text-secondary hover:text-text-primary"
            aria-expanded={showUserReferences}
          >
            {t('crossReferenceDisplay.myCrossReferences', { count: userRefCount, })}
          </button>
          {showUserReferences && (
            <p className="text-text-secondary">{t('crossReferenceDisplay.userRefsPlaceholder')}</p>
          )}
        </div>
      )}

      {tooltip.visible && (
        <VersePreviewTooltip
          verseId={tooltip.verseId}
          endVerseId={tooltip.endVerseId}
          position={tooltip.position}
          onClose={close}
          onMouseEnter={cancelHide}
          onGoToVerse={() => {
            const target = tooltip.verseId;
            close();
            onNavigateToVerse?.(target);
          }}
          hint={t('versePreviewTooltip.hintClick')}
        />
      )}
    </div>
  );
};

export default CrossReferenceDisplay;
