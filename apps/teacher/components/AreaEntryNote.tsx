import { Badge, Button } from '@edupro/ui';
import { closeAreaEntry } from '@/lib/area-entry-actions';
import { t, type Lang } from '@/lib/i18n';

/** a section's area as the API gives it on the sheets (docs/design/98) */
export interface AreaEntryState {
  locked: boolean;
  locks: { exam: boolean; class: boolean };
  open: { until: string; reason: string; openedAt: string; openedBy: string | null } | null;
  canClose: boolean;
}
export type EntryAreaKey = 'indicators' | 'remarks' | 'attendance' | 'health';

const WORDS: Record<EntryAreaKey, string> = {
  indicators: 'Indicators',
  remarks: 'Remarks',
  attendance: 'Exam attendance',
  health: 'Height and weight',
};

const untilWords = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });

/**
 * docs/design/98: the office reopened this section's area while the exam is locked — until when and why, and
 * for the class teacher **Done — close entry** (a second click confirms). After Done the page says it closed.
 */
export function AreaEntryNote({
  examId,
  classSectionId,
  area,
  entry,
  back,
  closed,
  lang,
  label = true,
}: {
  examId: string;
  classSectionId: string;
  area: EntryAreaKey;
  entry: AreaEntryState | undefined;
  back: string;
  /** the page's `closed` parameter: the area just closed by Done */
  closed?: string;
  lang: Lang;
  /** name the area (the register shows several) */
  label?: boolean;
}) {
  if (closed === area)
    return (
      <div
        className="ep-alert ep-alert--success"
        role="status"
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        {t(
          lang,
          'Entry closed: it is locked again with the rest of the exam; what you saved stays.',
        )}
      </div>
    );
  if (!entry?.open) return null;
  return (
    <div className="ep-area-entry">
      <Badge tone="info">
        {label ? `${t(lang, WORDS[area])} · ` : ''}
        {t(lang, 'Open for entry until')} {untilWords(entry.open.until)}
      </Badge>
      <span className="ep-area-entry__why">
        {t(lang, 'Reopened by the office')}
        {entry.open.openedBy ? ` (${entry.open.openedBy})` : ''}: {entry.open.reason}
      </span>
      {entry.canClose ? (
        <details className="ep-area-entry__done">
          <summary className="ep-btn ep-btn--secondary ep-btn--sm">
            {t(lang, 'Done — close entry')}
          </summary>
          <form action={closeAreaEntry} className="ep-area-entry__confirm">
            <input type="hidden" name="examId" value={examId} />
            <input type="hidden" name="classSectionId" value={classSectionId} />
            <input type="hidden" name="area" value={area} />
            <input type="hidden" name="back" value={back} />
            <p className="ep-field__help" style={{ margin: 0 }}>
              {t(
                lang,
                'Finished? It locks again with the rest of the exam; only the office can reopen it. What you saved stays.',
              )}
            </p>
            <Button type="submit" size="sm">
              {t(lang, 'Close entry')}
            </Button>
          </form>
        </details>
      ) : null}
    </div>
  );
}
