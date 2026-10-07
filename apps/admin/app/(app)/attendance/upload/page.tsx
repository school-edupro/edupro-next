import { Badge, Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { AttendanceNav } from '@/components/attendance/AttendanceNav';
import {
  cancelAttendanceUpload,
  commitAttendanceUpload,
  verifyAttendanceUpload,
} from '@/lib/attendance-actions';
import { apiFetch, getMe } from '@/lib/api';

interface Summary {
  id: string;
  date: string;
  code: 'P' | 'A';
  fileName: string | null;
  state: 'verified' | 'committed' | 'cancelled';
  totalRows: number;
  okRows: number;
  problemRows: number;
  replaceExisting: boolean;
  restPresent: boolean;
  marked: number;
  replaced: number;
  kept: number;
  restMarked: number;
  notifySms: boolean;
  notifyEmail: boolean;
  smsSent: number;
  emailSent: number;
  notifyNote: string | null;
  createdBy: string | null;
  createdAt: string;
  committedAt: string | null;
}
interface Row {
  row: number;
  admissionNo: string;
  name: string | null;
  section: string | null;
  existing: string | null;
  issue: 'not_found' | 'not_enrolled' | 'duplicate' | 'locked' | 'on_leave' | null;
}
interface Detail extends Summary {
  rows: Row[];
  preview: { fresh: number; same: number; differs: number; sections: number };
}

const ISSUE: Record<NonNullable<Row['issue']>, string> = {
  not_found: 'No student has this admission number',
  not_enrolled: 'Not enrolled in a class this session',
  duplicate: 'Repeated in the file',
  locked: 'The class register of that day is locked',
  on_leave: 'On approved leave: stays as leave',
};
const CODE: Record<string, string> = {
  P: 'Present',
  A: 'Absent',
  L: 'Late',
  H: 'Half day',
  LV: 'Leave',
  OD: 'On duty',
  SR: 'Short',
  SB: 'By bus',
};
const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
const STATE = { verified: 'To confirm', committed: 'Marked', cancelled: 'Cancelled' } as const;

/**
 * Attendance from an Excel list: the file has admission numbers only. Choose the date and Present or
 * Absent, check the list the file gives, then mark it; parents of the absent may be told by SMS or
 * e-mail. Every upload stays in the log below.
 */
export default async function AttendanceUploadPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const [log, detail] = await Promise.all([
    apiFetch<{ data: Summary[] }>('/attendance/bulk').then((r) => r.data),
    /^\d{1,18}$/.test(sp.id ?? '')
      ? apiFetch<Detail>(`/attendance/bulk/${sp.id!}`).catch(() => null)
      : Promise.resolve(null),
  ]);
  const good = detail ? detail.rows.filter((r) => !r.issue) : [];
  const bad = detail ? detail.rows.filter((r) => r.issue) : [];
  return (
    <>
      <PageHeader
        kicker="Attendance"
        title="Attendance from Excel"
        description="Upload a list of admission numbers, choose the date and Present or Absent, check the list, then mark."
        actions={
          <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/api/attendance/upload-format">
            Download the format
          </a>
        }
      />
      <AttendanceNav current="/attendance/upload" permissions={me.permissions} />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.ok === 'upload_cancelled'
            ? 'The upload was cancelled; nothing was marked.'
            : 'Attendance is marked.'}
        </div>
      ) : null}
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || sp.error}
        </div>
      ) : null}

      {!detail ? (
        <Card title="1. Upload the list" style={{ marginBottom: 'var(--sp-4)' }}>
          <form
            action={verifyAttendanceUpload}
            style={{
              display: 'flex',
              gap: 'var(--sp-3)',
              flexWrap: 'wrap',
              alignItems: 'flex-end',
            }}
          >
            <InputField
              id="au-date"
              name="date"
              label="Date *"
              type="date"
              required
              max={today()}
              defaultValue={today()}
            />
            <SelectField
              id="au-code"
              name="code"
              label="These students are *"
              defaultValue="A"
              options={[
                { value: 'A', label: 'Absent' },
                { value: 'P', label: 'Present' },
              ]}
            />
            <InputField
              id="au-file"
              name="file"
              label="Excel file (admission numbers) *"
              type="file"
              accept=".xlsx"
              required
            />
            <Button type="submit">Check the list</Button>
          </form>
          <p className="ep-field__help" style={{ marginBottom: 0 }}>
            The file needs one column, “Admission no”. Nothing is marked until you confirm on the
            next screen.
          </p>
        </Card>
      ) : (
        <>
          <Card
            title={`${detail.state === 'verified' ? '2. Check and confirm' : 'Upload'} · ${detail.date} · ${CODE[detail.code]}`}
            actions={
              <Badge
                tone={
                  detail.state === 'committed'
                    ? 'success'
                    : detail.state === 'cancelled'
                      ? 'neutral'
                      : 'warning'
                }
              >
                {STATE[detail.state]}
              </Badge>
            }
            style={{ marginBottom: 'var(--sp-4)' }}
          >
            <p style={{ marginTop: 0 }}>
              <strong>{detail.totalRows}</strong> row(s) in {detail.fileName ?? 'the file'}:{' '}
              <strong>{detail.okRows}</strong> ready, <strong>{detail.problemRows}</strong> with a
              problem (these are left out). Of the ready ones {detail.preview.fresh} are not yet
              marked, {detail.preview.same} are already {CODE[detail.code]?.toLowerCase()} and{' '}
              <strong>{detail.preview.differs}</strong> are marked differently, in{' '}
              {detail.preview.sections} class(es).
            </p>
            {detail.state === 'verified' ? (
              <form action={commitAttendanceUpload} style={{ display: 'grid', gap: 'var(--sp-2)' }}>
                <input type="hidden" name="id" value={detail.id} />
                <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                  <input type="checkbox" name="replace" value="1" />
                  Replace existing marks that differ ({detail.preview.differs}); without this only
                  students not yet marked are filled
                </label>
                {detail.code === 'A' ? (
                  <>
                    <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                      <input type="checkbox" name="restPresent" value="1" />
                      Mark the other students of these {detail.preview.sections} class(es), not yet
                      marked, as Present
                    </label>
                    <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                      <input type="checkbox" name="sms" value="1" />
                      Send an SMS to the parents of the absent
                    </label>
                    <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                      <input type="checkbox" name="email" value="1" />
                      Send an e-mail to the parents of the absent
                    </label>
                    <p className="ep-field__help" style={{ margin: 0 }}>
                      Up to {detail.okRows} parent(s) are told, once each, only for students this
                      upload marks absent. The SMS uses the school’s SMS template with the code
                      absent_alert.
                    </p>
                  </>
                ) : null}
                <span style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                  <Button type="submit" disabled={detail.okRows === 0}>
                    Mark attendance
                  </Button>
                  <Button type="submit" variant="ghost" formAction={cancelAttendanceUpload}>
                    Cancel this upload
                  </Button>
                </span>
              </form>
            ) : (
              <p style={{ marginBottom: 0 }}>
                {detail.state === 'committed' ? (
                  <>
                    Marked {detail.marked}, replaced {detail.replaced}, left as they were{' '}
                    {detail.kept}
                    {detail.restPresent
                      ? `, others marked present ${String(detail.restMarked)}`
                      : ''}
                    . SMS sent {detail.smsSent}, e-mail queued {detail.emailSent}.
                    {detail.notifyNote ? ` ${detail.notifyNote}` : ''}
                  </>
                ) : (
                  'Cancelled: nothing was marked.'
                )}{' '}
                <a href="/attendance/upload" style={{ textDecoration: 'underline' }}>
                  New upload
                </a>
              </p>
            )}
          </Card>
          {bad.length ? (
            <Card
              title={`Problems (${String(bad.length)})`}
              style={{ marginBottom: 'var(--sp-4)' }}
            >
              <div
                className="ep-table-wrap"
                tabIndex={0}
                role="region"
                aria-label="Rows with a problem"
              >
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">Rows of the file that are left out</caption>
                  <thead>
                    <tr>
                      <th scope="col">Row</th>
                      <th scope="col">Admission no</th>
                      <th scope="col">Student</th>
                      <th scope="col">Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bad.map((r) => (
                      <tr key={r.row}>
                        <td>{r.row}</td>
                        <td>{r.admissionNo}</td>
                        <td>{r.name ? `${r.name}${r.section ? ` · ${r.section}` : ''}` : '–'}</td>
                        <td>{ISSUE[r.issue!]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
          <Card title={`Ready (${String(good.length)})`} style={{ marginBottom: 'var(--sp-4)' }}>
            <div
              className="ep-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="Students of the file"
            >
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">Students the file names</caption>
                <thead>
                  <tr>
                    <th scope="col">Row</th>
                    <th scope="col">Admission no</th>
                    <th scope="col">Student</th>
                    <th scope="col">Class</th>
                    <th scope="col">Marked now</th>
                    <th scope="col">Will be</th>
                  </tr>
                </thead>
                <tbody>
                  {good.map((r) => (
                    <tr key={r.row}>
                      <td>{r.row}</td>
                      <td>{r.admissionNo}</td>
                      <th scope="row">{r.name}</th>
                      <td>{r.section}</td>
                      <td>
                        {r.existing ? (
                          <Badge tone={r.existing === detail.code ? 'neutral' : 'warning'}>
                            {CODE[r.existing] ?? r.existing}
                          </Badge>
                        ) : (
                          'Not marked'
                        )}
                      </td>
                      <td>{CODE[detail.code]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <Card title="Log of uploads">
        {log.length === 0 ? (
          <p className="ep-field__help" style={{ margin: 0 }}>
            No upload yet.
          </p>
        ) : (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Log of uploads">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Attendance uploads of this session</caption>
              <thead>
                <tr>
                  <th scope="col">Uploaded</th>
                  <th scope="col">By</th>
                  <th scope="col">For date</th>
                  <th scope="col">As</th>
                  <th scope="col" className="ep-num">
                    Rows
                  </th>
                  <th scope="col" className="ep-num">
                    Problems
                  </th>
                  <th scope="col" className="ep-num">
                    Marked
                  </th>
                  <th scope="col" className="ep-num">
                    Replaced
                  </th>
                  <th scope="col" className="ep-num">
                    SMS
                  </th>
                  <th scope="col" className="ep-num">
                    E-mail
                  </th>
                  <th scope="col">State</th>
                </tr>
              </thead>
              <tbody>
                {log.map((u) => (
                  <tr key={u.id}>
                    <th scope="row">
                      <a
                        href={`/attendance/upload?id=${u.id}`}
                        style={{ textDecoration: 'underline' }}
                      >
                        {when(u.createdAt)}
                      </a>
                    </th>
                    <td>{u.createdBy ?? ''}</td>
                    <td>{u.date}</td>
                    <td>{CODE[u.code]}</td>
                    <td className="ep-num">{u.totalRows}</td>
                    <td className="ep-num">{u.problemRows}</td>
                    <td className="ep-num">{u.marked + u.restMarked}</td>
                    <td className="ep-num">{u.replaced}</td>
                    <td className="ep-num">{u.notifySms ? u.smsSent : '–'}</td>
                    <td className="ep-num">{u.notifyEmail ? u.emailSent : '–'}</td>
                    <td>
                      <Badge
                        tone={
                          u.state === 'committed'
                            ? 'success'
                            : u.state === 'cancelled'
                              ? 'neutral'
                              : 'warning'
                        }
                      >
                        {STATE[u.state]}
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
