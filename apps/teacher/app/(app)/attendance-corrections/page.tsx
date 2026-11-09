import { Badge, Card, PageHeader } from '@edupro/ui';
import { CorrectionDecision } from '@/components/CorrectionDecision';
import { bff } from '@/lib/bff';
import { LEAVE_STATUS, dmy, type LeaveStatus, type RegApproval } from '@/lib/leave';
import { decideCorrection } from '../my-attendance/actions';

/** Colleagues' attendance corrections waiting at my level (docs/design/85, phase C), oldest first. */
export default async function AttendanceCorrectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const view = sp.view === 'decided' ? 'decided' : 'waiting';
  const d = await bff.api.fetch<{ rows: RegApproval[] }>(
    `/staff-attendance/regularisations/approvals?view=${view}`,
  );
  return (
    <>
      <PageHeader
        kicker="Leave"
        title="Attendance corrections to approve"
        description="Days colleagues say are wrong — a forgotten punch, a device that missed them — waiting at your level. Approving sets the day as asked."
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
      <nav className="ep-tabs" aria-label="Which corrections">
        <a
          className="ep-tabs__tab"
          href="/attendance-corrections"
          aria-current={view === 'waiting' ? 'page' : undefined}
        >
          Waiting
        </a>
        <a
          className="ep-tabs__tab"
          href="/attendance-corrections?view=decided"
          aria-current={view === 'decided' ? 'page' : undefined}
        >
          Decided by me
        </a>
      </nav>
      {d.rows.length ? (
        d.rows.map((r) => (
          <Card key={r.id}>
            <p style={{ margin: 0 }}>
              <a href={`/my-attendance/${r.day}?emp=${r.employee_id}`}>
                <strong>
                  {r.employee} · {dmy(r.day)}
                </strong>
              </a>{' '}
              {view === 'decided' ? (
                <Badge tone={LEAVE_STATUS[r.status as LeaveStatus]?.tone ?? 'neutral'}>
                  {LEAVE_STATUS[r.status as LeaveStatus]?.label ?? r.status}
                </Badge>
              ) : null}
            </p>
            <p className="ep-field__help">
              {[
                r.in_time ? `IN ${r.in_time}` : null,
                r.out_time ? `OUT ${r.out_time}` : null,
                r.day_type,
              ]
                .filter(Boolean)
                .join(' · ')}{' '}
              — {r.reason}
            </p>
            {view === 'waiting' && r.mayDecide ? (
              <CorrectionDecision
                action={decideCorrection.bind(null, r.id)}
                back="/attendance-corrections"
                fid={`cd-${r.id}`}
              />
            ) : null}
          </Card>
        ))
      ) : (
        <Card>
          <p>
            {view === 'waiting'
              ? 'Nothing waits for you.'
              : 'You have not decided any correction yet.'}
          </p>
        </Card>
      )}
    </>
  );
}
