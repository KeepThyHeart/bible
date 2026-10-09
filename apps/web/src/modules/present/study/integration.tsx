/**
 * The Presenter inside Study, registered into host slots by `module.ts`
 * (task 0123). Rendering is what `BibleContent`, `VerseRenderer` and
 * `AppShell` did inline before the Presenter became a feature module.
 */
import { useEffect, useState } from 'preact/hooks';
import type { ComponentType } from 'preact';
import i18n from 'i18next';
import { appRegistry } from '../../../host/appHost';
import type { VerseDecorator } from '../../../host/slots';
import { useReadable } from '../../../host/useReadable';
import { bibleStore } from '../../../stores/bibleStore';
import { draftIsOnWall } from '../lib/wordHighlight';
import { followStore } from '../stores/followStore';
import { presentStore } from '../stores/presentStore';
import { PresentHighlightBar, useHighlightDraftLifecycle } from './PresentHighlightBar';
import { FollowHighlightedText, PresenterWords, SendRailButton } from './verseDecorations';

/**
 * Per verse: a follower's current verse (and the presenter's highlighted
 * words on it); while presenting, the send rail on every verse, the green
 * "on screen" verse and the tappable words on the active verse.
 */
export const presentVerseDecorator: VerseDecorator = (ctx) => {
  const classes: string[] = [];
  let rail;
  let text;

  // Follow-along (`/present/f/<code>`): null on every ordinary tab.
  const live = followStore.liveVerse;
  if (live && live.book === ctx.book && live.chapter === ctx.chapter && live.verse === ctx.verse) {
    classes.push('verse--follow-live');
    if (live.highlights.length > 0) {
      text = <FollowHighlightedText html={ctx.html} verseId={ctx.verseId} highlights={live.highlights} />;
    }
  }

  // Present mode. A verse is "sent" when it is the very verse the wall shows,
  // of this passage in this translation; the send button on every other verse
  // sends it (and moves the study focus there, so the next arrow key continues
  // from what was just sent).
  if (presentStore.session !== null) {
    const wall = presentStore.wall;
    const wl = wall?.live;
    const wallVerse = wl?.kind === 'passage'
      && wl.module === ctx.moduleAbbr && wl.book === ctx.book && wl.chapter === ctx.chapter
      ? wall!.position.index
      : null;
    const sent = wallVerse === ctx.verse;
    if (sent) classes.push('verse--sent');
    rail = (
      <SendRailButton
        rail={{
          sent,
          onSend: () => {
            if (!ctx.book || !ctx.chapter) return;
            bibleStore.focusVerseNumber(ctx.verse);
            void presentStore.show({ kind: 'passage', module: ctx.moduleAbbr, book: ctx.book, chapter: ctx.chapter }, ctx.verse);
          },
          label: sent
            ? i18n.t('present.verseOnScreen', { verse: ctx.verse })
            : i18n.t('present.sendVerse', { verse: ctx.verse }),
        }}
      />
    );
    if (ctx.isActive) {
      const draft = presentStore.highlightDraft;
      text = (
        <PresenterWords
          html={ctx.html}
          verseId={ctx.verseId}
          wordHighlight={{
            draft,
            sent: draftIsOnWall(draft, wall?.position.highlights ?? []),
            onHold: (index: number) => presentStore.beginHighlight(ctx.verseId, index),
            onTap: (index: number) => presentStore.tapHighlightWord(ctx.verseId, index),
          }}
        />
      );
    }
  }

  if (classes.length === 0 && rail === undefined && text === undefined) return null;
  return { classes, rail, text };
};

/** Inside the reader: the highlight draft's lifecycle and its docked bar. */
export function PresentReaderOverlay() {
  useHighlightDraftLifecycle();
  return <PresentHighlightBar />;
}

/** Mounts the Presenter's clicker keys (a lazy chunk) while a session is live, whichever app is shown. */
export function PresenterKeysHost() {
  const apps = useReadable(appRegistry.state);
  const busy = apps.apps.some((a) => a.item.id === 'present' && a.busy);
  const [Keys, setKeys] = useState<ComponentType | null>(null);
  useEffect(() => {
    if (!busy || Keys) return;
    let live = true;
    void import('./PresenterKeys').then((m) => {
      if (live) setKeys(() => m.PresenterKeys);
    });
    return () => {
      live = false;
    };
  }, [busy, Keys]);
  return busy && Keys ? <Keys /> : null;
}
