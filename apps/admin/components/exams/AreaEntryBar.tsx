import { Badge, Card } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { ConfirmAction } from '@/components/ConfirmAction';
import { apiFetch } from '@/lib/api';
import { closeAreaEntry, openAreaForEntry } from '@/lib/exam-entry-actions';
import type { LockImpact } from '@/lib/types';

export type EntryAreaKey = 'indicators' | 'remarks' | 'attendance' | 'health';

/** a section's area as the API gives it on the sheets (docs/design/98) */
export interface AreaEntryState {
  locked: boolean;
  locks: { exam: boolean; class: boolean };
  open: { until: string; reason: string; openedAt: string; openedBy: string | null } | null;
  canClose: boolean;
}

const IST = 'Asia/Kolkata';

/** a moment as the dialog's date-time box reads it (the school's clock) */
function localInput(ms: number): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: IST,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export const untilWords = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: IST,
  });

/**
 * docs/design/98: on the Indicators, Remarks, Attendance and Height & weight pages (a section picked) —
 * while the exam or the class's lock of the area holds, the school admin's **Reopen for entry** (a reason,
 * when it closes, the class's published card taken back); once reopened, "Open for entry until …" with
 * **Close now** (the class teacher's Done is on the staff website and app).
 */
export async function AreaEntryBar({
  examId,
  classId,
  classSectionId,
  section,
  area,
  entry,
  canLock,
  back,
}: {
  examId: string;
  classId: string;
  classSectionId: string;
  section: string;
  area: EntryAreaKey;
  entry: AreaEntryState | undefined;
  canLock: boolean;
  back: string;
}) {
  if (!entry) return null;
  const r = await getTranslations('examHub.reopen');
  const what = r(`areas.${area}`);
  const fields = { examId, classSectionId, area, back };
  if (entry.open)
    return (
      <div className="ep-area-entry" role="status">
        <Badge tone="info">{r('until', { until: untilWords(entry.open.until) })}</Badge>
        <span className="ep-area-entry__why">
          {entry.open.openedBy
            ? r('by', { name: entry.open.openedBy, reason: entry.open.reason })
            : entry.open.reason}
        </span>
        {entry.canClose ? (
          <ConfirmAction
            action={closeAreaEntry}
            fields={fields}
            label={canLock ? r('closeNow') : r('done')}
            title={r('closeTitle', { area: what, section })}
            confirmLabel={canLock ? r('closeNow') : r('done')}
          >
            {r('closeBody')}
          </ConfirmAction>
        ) : null}
      </div>
    );
  if (!canLock || !(entry.locks.exam || entry.locks.class)) return null;
  const cards = await apiFetch<{ data: LockImpact[] }>(
    `/exams/${examId}/lock-impact?classId=${encodeURIComponent(classId)}`,
  )
    .then((x) => x.data.flatMap((k) => k.cards.map((c) => `"${c.name}"`)))
    .catch(() => [] as string[]);
  // the closing time: two days from now unless changed, from a few minutes to 30 days ahead
  const now = Date.now();
  const day = 24 * 3600_000;
  return (
    <div className="ep-area-entry">
      <ConfirmAction
        action={openAreaForEntry}
        fields={fields}
        label={r('open')}
        title={r('openTitle', { area: what, section })}
        confirmLabel={r('open')}
        reason={{ label: r('openReason') }}
        when={{
          name: 'closesAt',
          label: r('closesAt'),
          value: localInput(now + 2 * day),
          min: localInput(now + 10 * 60_000),
          max: localInput(now + 30 * day),
          help: r('closesHelp'),
        }}
      >
        {[
          r('openBody', { area: what, section }),
          cards.length ? r('openCards', { cards: cards.join(', ') }) : '',
        ]
          .filter(Boolean)
          .join(' ')}
      </ConfirmAction>
    </div>
  );
}

interface Opening {
  id: string;
  classSectionId: string;
  section: string;
  area: EntryAreaKey;
  reason: string;
  openedBy: string | null;
  openedAt: string;
  until: string;
  open: boolean;
  closedAt: string | null;
  closedHow: 'done' | 'admin' | 'lock' | 'lapsed' | null;
  closedBy: string | null;
}

/**
 * docs/design/98: the exam's Status page — the sections' areas reopened under the lock, open now first (with Close
 * now for the school admin), then the last closed and how. Nothing shows when nothing was ever reopened.
 */
export async function AreaOpeningsCard({ examId, canLock }: { examId: string; canLock: boolean }) {
  const list = await apiFetch<{ data: Opening[] }>(`/exams/${examId}/area-entry`)
    .then((x) => x.data)
    .catch(() => [] as Opening[]);
  if (!list.length) return null;
  const r = await getTranslations('examHub.reopen');
  return (
    <Card elevated title={r('listTitle')} style={{ marginBottom: 'var(--sp-4)' }}>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        {r('listHelp')}
      </p>
      <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={r('listTitle')}>
        <table className="ep-table">
          <thead>
            <tr>
              <th scope="col">{r('colSection')}</th>
              <th scope="col">{r('colArea')}</th>
              <th scope="col">{r('colReason')}</th>
              <th scope="col">{r('colOpened')}</th>
              <th scope="col">{r('colUntil')}</th>
              <th scope="col">{r('colState')}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((x) => (
              <tr key={x.id}>
                <th scope="row">{x.section}</th>
                <td>{r(`areas.${x.area}`)}</td>
                <td>{x.reason}</td>
                <td>
                  {untilWords(x.openedAt)}
                  {x.openedBy ? ` · ${x.openedBy}` : ''}
                </td>
                <td>{untilWords(x.until)}</td>
                <td>
                  {x.open ? (
                    <span className="ep-area-entry" style={{ marginBottom: 0 }}>
                      <Badge tone="info">{r('stateOpen')}</Badge>
                      {canLock ? (
                        <ConfirmAction
                          action={closeAreaEntry}
                          fields={{
                            examId,
                            classSectionId: x.classSectionId,
                            area: x.area,
                            back: `/exams/${examId}/status`,
                          }}
                          label={r('closeNow')}
                          title={r('closeTitle', {
                            area: r(`areas.${x.area}`),
                            section: x.section,
                          })}
                          confirmLabel={r('closeNow')}
                        >
                          {r('closeBody')}
                        </ConfirmAction>
                      ) : null}
                    </span>
                  ) : (
                    <>
                      {x.closedHow ? r(`how.${x.closedHow}`) : ''}
                      {x.closedBy && x.closedHow !== 'lapsed' ? ` · ${x.closedBy}` : ''}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
