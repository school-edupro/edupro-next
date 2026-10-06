import { Badge, Button, Card, InputField, PageHeader } from '@edupro/ui';
import { AttendanceNav } from '@/components/attendance/AttendanceNav';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { approveLeave, rejectLeave } from '@/lib/attendance-actions';
import {
  LEAVE_TONE,
  leaveDays,
  type StudentLeave,
  type StudentLeaveDetail,
} from '@/lib/attendance-plus';

const TABS: Array<[string, string]> = [
  ['inbox', 'To approve'],
  ['pending', 'Waiting'],
  ['approved', 'Approved'],
  ['rejected', 'Not approved'],
  ['all', 'All'],
];
const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

/**
 * Student leave: what waits at this person's level, and every leave that came to them (the coordinator's
 * office sees all). Opening one shows the reason, the certificate and the approval levels; the approver
 * approves or rejects with a note.
 */
export default async function StudentLeavesPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    q?: string;
    open?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const tab = TABS.some(([t]) => t === sp.tab) ? sp.tab! : 'inbox';
  const q = sp.q?.trim().slice(0, 80) ?? '';
  const [me, list, open] = await Promise.all([
    getMe(),
    apiFetch<{ data: StudentLeave[]; inbox: number; overseer: boolean }>(
      `/attendance/leaves?${new URLSearchParams({ tab, ...(q ? { q } : {}) }).toString()}`,
    ),
    /^\d+$/.test(sp.open ?? '')
      ? apiFetch<StudentLeaveDetail>(`/attendance/leaves/${sp.open!}`).catch(() => null)
      : Promise.resolve(null),
  ]);
  return (
    <>
      <PageHeader
        kicker="Attendance"
        title="Student leave"
        description="Leave the families applied for. A short leave is approved by the class teacher; a long one goes on to the coordinator and the principal. An approved leave is marked LV in class and bus attendance."
      />
      <AttendanceNav current="/attendance/leaves" permissions={me.permissions} ok={sp.ok} />
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      <nav className="ep-tabs-links" aria-label="Lists" style={{ marginBottom: 'var(--sp-3)' }}>
        {TABS.map(([value, label]) => (
          <a
            key={value}
            href={`/attendance/leaves?tab=${value}`}
            aria-current={tab === value ? 'page' : undefined}
          >
            {label}
            {value === 'inbox' ? ` · ${String(list.inbox)}` : ''}
          </a>
        ))}
      </nav>
      {open ? (
        <Card
          title={`${open.number} · ${open.student}`}
          style={{ marginBottom: 'var(--sp-4)' }}
          actions={
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/attendance/leaves?tab=${tab}`}>
              Close
            </a>
          }
        >
          <dl className="ep-sheet__grid">
            {(
              [
                [
                  'Student',
                  [open.student, open.admissionNo, open.section].filter(Boolean).join(' · '),
                ],
                ['Leave', `${open.leaveTypeLabel} · ${open.long ? 'long leave' : 'short leave'}`],
                ['Days', leaveDays(open)],
                [
                  'Applied',
                  `${when(open.appliedAt)}${open.appliedBy ? ` by ${open.appliedBy}` : ''}`,
                ],
                ['Reason', open.reason],
              ] as Array<[string, string]>
            ).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
            <div>
              <dt>Certificate</dt>
              <dd>
                {open.files.length
                  ? open.files.map((f, i) => (
                      <FileLinks
                        key={f.id}
                        href={`/api/attendance/leave-file/${open.id}/${f.id}`}
                        label={`attachment ${String(i + 1)} of ${open.number}`}
                      />
                    ))
                  : 'None attached'}
              </dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <Badge tone={LEAVE_TONE[open.status] ?? 'neutral'}>
                  {open.status === 'pending' && open.waitingOn
                    ? `Waiting: ${open.waitingOn}`
                    : open.status}
                </Badge>
                {open.endedOn ? ` · back from ${open.endedOn}` : ''}
              </dd>
            </div>
          </dl>
          <ol className="ep-steps" aria-label="Approval levels">
            {open.approvals.map((a) => (
              <li key={a.seq} data-state={a.status}>
                <strong>{a.label}</strong>{' '}
                <span className="ep-field__help">
                  {a.status === 'approved'
                    ? `Approved by ${a.actedBy ?? ''} · ${when(a.actedAt)}`
                    : a.status === 'rejected'
                      ? `Not approved by ${a.actedBy ?? ''} · ${when(a.actedAt)}`
                      : a.status === 'pending'
                        ? `Waiting for ${a.approvers ?? 'the approver'}`
                        : a.status === 'skipped'
                          ? (a.note ?? 'Skipped')
                          : `Next: ${a.approvers ?? ''}`}
                  {a.note && a.status !== 'skipped' ? ` · “${a.note}”` : ''}
                </span>
              </li>
            ))}
          </ol>
          {open.canDecide ? (
            <form
              action={approveLeave}
              className="ep-hd__form"
              style={{ marginTop: 'var(--sp-3)' }}
            >
              <input type="hidden" name="id" value={open.id} />
              <input type="hidden" name="tab" value={tab} />
              <label className="ep-field" htmlFor="lv-note">
                <span className="ep-field__label">Note (needed when not approving)</span>
                <textarea id="lv-note" name="note" className="ep-input" rows={2} maxLength={500} />
              </label>
              <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                <Button type="submit" formAction={approveLeave}>
                  Approve
                </Button>
                <Button type="submit" formAction={rejectLeave} variant="secondary">
                  Do not approve
                </Button>
              </div>
            </form>
          ) : null}
        </Card>
      ) : null}
      <div className="ep-filter-band">
        <form method="get" className="ep-dlog__filters">
          <input type="hidden" name="tab" value={tab} />
          <InputField
            id="lv-q"
            name="q"
            type="search"
            label="Student, admission no. or leave no."
            defaultValue={q}
            maxLength={80}
          />
          <Button type="submit">Show</Button>
        </form>
      </div>
      <Card>
        {list.data.length === 0 ? (
          <p className="ep-field__help" style={{ margin: 0 }}>
            {tab === 'inbox' ? 'No leave waits for your approval.' : 'Nothing here.'}
          </p>
        ) : (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Student leave">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Student leave</caption>
              <thead>
                <tr>
                  <th scope="col">Leave no.</th>
                  <th scope="col">Student</th>
                  <th scope="col">Class</th>
                  <th scope="col">Type</th>
                  <th scope="col">Days</th>
                  <th scope="col">Applied</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((l) => (
                  <tr key={l.id}>
                    <th scope="row">
                      <a
                        href={`/attendance/leaves?tab=${tab}&open=${l.id}`}
                        style={{ textDecoration: 'underline' }}
                      >
                        {l.number}
                      </a>
                    </th>
                    <td>
                      {l.student}
                      <div className="ep-field__help">{l.admissionNo}</div>
                    </td>
                    <td>{l.section ?? '–'}</td>
                    <td>
                      {l.leaveTypeLabel}
                      {l.long ? ' · long' : ''}
                    </td>
                    <td>{leaveDays(l)}</td>
                    <td>{when(l.appliedAt)}</td>
                    <td>
                      <Badge tone={LEAVE_TONE[l.status] ?? 'neutral'}>
                        {l.status === 'pending' && l.waitingOn
                          ? `Waiting: ${l.waitingOn}`
                          : l.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
