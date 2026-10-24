import { Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { FileLinks } from '@/components/FileLinks';
import { bff } from '@/lib/bff';
import { approveExit, rejectExit, sendBackExit } from '../resignation/actions';

interface Item {
  id: string;
  employee: {
    code: string;
    name: string;
    typeName: string;
    department: string | null;
    designation: string | null;
  };
  exitType: { name: string };
  reason: string;
  letterFileId: string | null;
  requestedOn: string;
  proposedLastDay: string;
  noticeDays: number;
  expectedLastDay: string;
  shortfallDays: number;
  bySelf: boolean;
  waitingAt: string | null;
}
const OK: Record<string, string> = {
  approve: 'Approved.',
  'send-back': 'Sent back with your remark.',
  reject: 'Not accepted.',
};
const dmy = (iso: string) => iso.split('-').reverse().join('-');

/** Resignations and exits waiting at my approval level (docs/design/38, part 5). */
export default async function ExitApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  let data: Item[];
  try {
    data = (await bff.api.fetch<{ data: Item[] }>('/people/exits/to-approve')).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    throw error;
  }
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: '52rem', margin: '0 auto' }}>
      <p style={{ margin: '0 0 var(--sp-2)' }}>
        <a href="/" style={{ textDecoration: 'underline' }}>
          ← Home
        </a>
      </p>
      <PageHeader
        kicker="EduPro staff"
        title="Exits to approve"
        description="Resignations and exits of colleagues waiting for your decision."
      />
      {sp.ok ? (
        <p className="ep-alert ep-alert--success" role="status">
          {OK[sp.ok] ?? 'Done.'}
        </p>
      ) : null}
      {sp.error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {sp.detail || 'That did not work. Please try again.'}
        </p>
      ) : null}
      {data.length === 0 ? <Card>Nothing waits for you.</Card> : null}
      <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
        {data.map((x) => (
          <Card key={x.id} title={`${x.employee.name} (${x.employee.code})`}>
            <p style={{ marginTop: 0 }}>
              {x.exitType.name} · {x.employee.typeName}
              {x.employee.department ? ` · ${x.employee.department}` : ''}
              {x.employee.designation ? ` · ${x.employee.designation}` : ''} ·{' '}
              {x.bySelf ? 'asked in the staff app' : 'recorded by the office'} on{' '}
              {dmy(x.requestedOn)}
              {x.waitingAt ? ` · your level: ${x.waitingAt}` : ''}
            </p>
            <p>
              Proposed last working day {dmy(x.proposedLastDay)}
              {x.noticeDays
                ? x.shortfallDays
                  ? ` · ${String(x.shortfallDays)} days short of the ${String(x.noticeDays)}-day notice (expected ${dmy(x.expectedLastDay)})`
                  : ' · notice served in full'
                : ''}
            </p>
            <p>Reason: {x.reason}</p>
            {x.letterFileId ? (
              <p>
                Letter:{' '}
                <FileLinks
                  url={`/api/exit-letter/${x.id}`}
                  saveUrl={`/api/exit-letter/${x.id}?save=1`}
                  label={`letter of ${x.employee.name}`}
                />
              </p>
            ) : null}
            <form style={{ display: 'grid', gap: 'var(--sp-3)' }}>
              <input type="hidden" name="id" value={x.id} />
              <input type="hidden" name="proposedLastDay" value={x.proposedLastDay} />
              <label className="ep-field" htmlFor={`xa-last-${x.id}`}>
                <span className="ep-field__label">Accepted last working day</span>
                <input
                  id={`xa-last-${x.id}`}
                  name="acceptedLastDay"
                  className="ep-input"
                  type="date"
                  min={x.requestedOn}
                  defaultValue={x.proposedLastDay}
                />
              </label>
              {x.shortfallDays ? (
                <label className="ep-check">
                  <input type="checkbox" name="waiveNotice" className="ep-check__input" />
                  <span className="ep-check__box" aria-hidden="true" />
                  <span className="ep-check__text">Waive the notice shortfall</span>
                </label>
              ) : null}
              <label className="ep-field" htmlFor={`xa-note-${x.id}`}>
                <span className="ep-field__label">Remark (needed to send back or reject)</span>
                <input id={`xa-note-${x.id}`} name="note" className="ep-input" maxLength={500} />
              </label>
              <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                <button type="submit" formAction={approveExit} className="ep-btn ep-btn--primary">
                  Approve
                </button>
                <button
                  type="submit"
                  formAction={sendBackExit}
                  className="ep-btn ep-btn--secondary"
                >
                  Send back
                </button>
                <button type="submit" formAction={rejectExit} className="ep-btn ep-btn--danger">
                  Reject
                </button>
              </div>
            </form>
          </Card>
        ))}
      </div>
    </main>
  );
}
