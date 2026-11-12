import { ApiError } from '@edupro/bff';
import { Badge, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { CorrectionDecision } from '@/components/CorrectionDecision';
import { bff } from '@/lib/bff';
import {
  LEAVE_STATUS,
  correctionPeople,
  dmy,
  type AttendanceDay,
  type LeaveStatus,
} from '@/lib/leave';
import { askCorrection, decideCorrection, withdrawCorrection } from '../actions';

const SOURCE: Record<string, string> = {
  device: 'device',
  central: 'device database',
  import: 'Excel',
  manual: 'by hand',
};

/**
 * A day of my attendance (docs/design/85, phase C): what it is and how it was worked out, the punches, a
 * late mark or missing punch; ask for a correction, or withdraw one asked. An approver of a colleague's
 * correction opens it here too (?emp=) and decides it.
 */
export default async function MyAttendanceDayPage({
  params,
  searchParams,
}: {
  params: Promise<{ day: string }>;
  searchParams: Promise<{ emp?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const { day } = await params;
  const sp = await searchParams;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) notFound();
  const emp = sp.emp && /^\d{1,18}$/.test(sp.emp) ? sp.emp : null;
  let d: AttendanceDay;
  try {
    const me = emp
      ? null
      : await bff.api.fetch<MyAttendanceEmp>(`/staff-attendance/mine?month=${day.slice(0, 7)}`);
    const id = emp ?? me?.employee?.id;
    if (!id) notFound();
    d = await bff.api.fetch<AttendanceDay>(`/staff-attendance/days/${id}/${day}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  }
  const r = d.row;
  const here = `/my-attendance/${day}${emp ? `?emp=${emp}` : ''}`;
  const live = d.regularisations.find((g) => g.status === 'pending');
  return (
    <>
      <PageHeader
        kicker={d.can.mine ? 'My attendance' : `${d.employee.name} · ${d.employee.code}`}
        title={`${dmy(day)} · ${r ? r.words : 'Not marked yet'}`}
        description={
          r ? r.how : 'Nothing is recorded for this day yet: the punches are read every 15 minutes.'
        }
      />
      {sp.ok ? (
        <p className="ep-alert ep-alert--success" role="status">
          {sp.detail ?? 'Done.'}
        </p>
      ) : null}
      {sp.error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {sp.detail ?? 'That did not work.'}
        </p>
      ) : null}
      <Card>
        <p>
          {[
            r?.in ? `IN ${r.in}` : 'No IN',
            r?.out ? `OUT ${r.out}` : 'No OUT',
            r?.worked != null ? `${String(r.worked)} hours` : null,
            r?.late ? `late ${String(r.late)} min` : null,
            r?.early ? `left ${String(r.early)} min early` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {r?.leave ? <p>Leave: {r.leave}</p> : null}
        {r?.manual ? (
          <p className="ep-field__help">Set by hand — the punches no longer change it.</p>
        ) : null}
        {d.marks.map((m) => (
          <p key={m.kind} className="ep-field__help">
            {m.detail} · {m.status === 'pending' ? 'counts this month' : m.status}
          </p>
        ))}
        <h2 className="ep-card__title">Punches</h2>
        {d.punches.length ? (
          <ul style={{ margin: 0 }}>
            {d.punches.map((p) => (
              <li key={p.at}>
                {dmy(p.date)} {p.time} · {SOURCE[p.source] ?? p.source}
              </li>
            ))}
          </ul>
        ) : (
          <p>No punches read for this day.</p>
        )}
      </Card>
      {d.can.decide && live ? (
        <Card>
          <h2 className="ep-card__title">A correction waits for you</h2>
          <p>
            {[
              live.in_time ? `IN ${live.in_time}` : null,
              live.out_time ? `OUT ${live.out_time}` : null,
              live.day_type,
            ]
              .filter(Boolean)
              .join(' · ')}{' '}
            — {live.reason}
          </p>
          <CorrectionDecision
            action={decideCorrection.bind(null, d.can.decide)}
            back="/attendance-corrections"
            fid="cd"
          />
        </Card>
      ) : null}
      {d.regularisations.length ? (
        <Card>
          <h2 className="ep-card__title">Corrections asked</h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {d.regularisations.map((g) => (
              <li key={g.id} style={{ padding: 'var(--sp-2) 0' }}>
                <Badge tone={LEAVE_STATUS[g.status as LeaveStatus]?.tone ?? 'neutral'}>
                  {LEAVE_STATUS[g.status as LeaveStatus]?.label ?? g.status}
                </Badge>{' '}
                {[
                  g.in_time ? `IN ${g.in_time}` : null,
                  g.out_time ? `OUT ${g.out_time}` : null,
                  g.day_type,
                ]
                  .filter(Boolean)
                  .join(' · ')}{' '}
                — {g.reason}
                {correctionPeople(g) ? (
                  <span style={{ display: 'block' }} className="ep-field__help">
                    {correctionPeople(g)}
                  </span>
                ) : null}
                {g.status === 'pending' && d.can.mine ? (
                  <form
                    action={withdrawCorrection.bind(null, g.id)}
                    style={{ marginTop: 'var(--sp-2)' }}
                  >
                    <input type="hidden" name="back" value={here} />
                    <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                      Withdraw
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {d.correctionNote ? (
        <p className="ep-alert ep-alert--info" role="status">
          <span>{d.correctionNote}</span>
        </p>
      ) : null}
      {d.can.regularise ? (
        <Card>
          <h2 className="ep-card__title">Ask for a correction</h2>
          <form action={askCorrection} className="ep-form-section__body">
            <input type="hidden" name="day" value={day} />
            <label className="ep-field" htmlFor="mc-in">
              <span className="ep-field__label">IN</span>
              <input
                id="mc-in"
                name="in"
                type="time"
                className="ep-input"
                defaultValue={r?.in ?? ''}
              />
            </label>
            <label className="ep-field" htmlFor="mc-out">
              <span className="ep-field__label">OUT</span>
              <input
                id="mc-out"
                name="out"
                type="time"
                className="ep-input"
                defaultValue={r?.out ?? ''}
              />
            </label>
            <label className="ep-field" htmlFor="mc-type">
              <span className="ep-field__label">The day was</span>
              <select id="mc-type" name="dayType" className="ep-select" defaultValue="">
                <option value="">Worked out from the times</option>
                <option value="P">Present</option>
                <option value="HD">Half day</option>
                <option value="WO">Weekly off</option>
                <option value="H">Holiday</option>
              </select>
            </label>
            <label className="ep-field" htmlFor="mc-why">
              <span className="ep-field__label">Reason</span>
              <textarea
                id="mc-why"
                name="reason"
                rows={2}
                required
                minLength={3}
                maxLength={500}
                className="ep-input"
              />
            </label>
            <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
              Send to my approver
            </button>
          </form>
        </Card>
      ) : null}
      <p>
        <a
          href={d.can.mine ? `/my-attendance?month=${day.slice(0, 7)}` : '/attendance-corrections'}
        >
          {d.can.mine ? 'Back to my attendance' : 'Back to the corrections'}
        </a>
      </p>
    </>
  );
}

type MyAttendanceEmp = { employee: { id: string } | null };
