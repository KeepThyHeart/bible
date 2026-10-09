/**
 * Measures module code (lazy): the reader paint controller (the in-text marks and
 * the popup), and the verse's measures list in the Study pane (desktop section and
 * phone card). Everything is registered into generic host slots and removed again
 * when the module switches off.
 */
import type { FeatureModuleContext } from '@bible/core/browser';
import { mobileStudySections, readerPaintControllers, studySections } from '../../host/slots';
import type { StudySectionProps } from '../../host/slots';
import { MeasurePaint } from './MeasurePaint';
import { StudyMeasures } from './StudyMeasures';

function StudyMeasuresSection({ verseId, onOpenSettings }: StudySectionProps) {
  return <StudyMeasures verseId={verseId} onOpenSettings={onOpenSettings} />;
}

function MobileMeasuresSection({ verseId, onOpenSettings }: StudySectionProps) {
  return <StudyMeasures variant="mobile" verseId={verseId} onOpenSettings={onOpenSettings} compact />;
}

export function activate(ctx: FeatureModuleContext): void {
  ctx.subscriptions.push(
    readerPaintControllers.register(MeasurePaint),
    // After Topics and before the other sections, where the list always was.
    studySections.register({ id: 'measures', order: 10, Section: StudyMeasuresSection }),
    mobileStudySections.register({ id: 'measures', order: 10, Section: MobileMeasuresSection }),
  );
}
