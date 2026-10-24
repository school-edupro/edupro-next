import { Card, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { FileLinks } from '@/components/FileLinks';
import { bff } from '@/lib/bff';
import { applyResignation, resubmitResignation, withdrawResignation } from './actions';

interface ExitRow {
  id: string;
  exitType: { code: string; name: string };
  reason: string;
  letterFileId: string | null;
  requestedOn: string;
  proposedLastDay: string;
  noticeDays: number;
  expectedLastDay: string;
  shortfallDays: number;
  acceptedLastDay: string | null;
  noticeWaived: boolean;
  status: 'pending' | 'sent_back' | 'approved' | 'rejected' | 'withdrawn';
  bySelf: boolean;
  sentBackNote: string | null;
  decisionNote: string | null;
  waitingAt: string | null;
}
interface Mine {
  employee: { name: string; code: string; typeName: string };
  types: Array<{ code: string; name: string; noticeApplies: boolean }>;
  noticeDays: number;
  data: ExitRow[];
}
const STATUS: Record<ExitRow['status'], string> = {
  pending: 'Waiting for approval',
  sent_back: 'Sent back to you',
  approved: 'Accepted',
  rejected: 'Not accepted',
  withdrawn: 'Withdrawn',
};
const OK: Record<string, string> = {
  sent: 'Sent for approval.',
  withdrawn: 'Withdrawn.',
  resent: 'Sent for approval again.',
};
const dmy = (iso: string | null) => (iso ? iso.split('-').reverse().join('-') : '—');
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** My resignation (docs/design/38, part 5): ask for it, see where it is, withdraw it until accepted. */
export default async function ResignationPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  let mine: Mine;
  try {
    mine = await bff.api.fetch<Mine>('/me/exits');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 404)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: '52rem', margin: '0 auto' }}>
          <Card>Your sign-in is not linked to an employee record; ask the office.</Card>
        </main>
      );
    throw error;
  }
  const open = mine.data.find((x) => ['pending', 'sent_back', 'approved'].includes(x.status));
  const today = new Date().toISOString().slice(0, 10);
  const expected = addDays(today, mine.noticeDays);
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: '52rem', margin: '0 auto' }}>
      <p style={{ margin: '0 0 var(--sp-2)' }}>
        <a href="/" style={{ textDecoration: 'underline' }}>
          ← Home
        </a>
      </p>
      <PageHeader
        kicker="EduPro staff"
        title="My resignation"
        description={`${mine.employee.name} (${mine.employee.code}) · ${mine.employee.typeName} staff · notice period ${String(mine.noticeDays)} days`}
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
      {open ? (
        <Card title={`${open.exitType.name}: ${STATUS[open.status]}`}>
          <dl className="ep-facts">
            <div>
              <dt>Asked on</dt>
              <dd>{dmy(open.requestedOn)}</dd>
            </div>
            <div>
              <dt>Last working day</dt>
              <dd>
                {open.acceptedLastDay
                  ? `${dmy(open.acceptedLastDay)} (accepted)`
                  : `${dmy(open.proposedLastDay)} (proposed)`}
              </dd>
            </div>
            {open.noticeDays ? (
              <div>
                <dt>Notice</dt>
                <dd>
                  {open.noticeWaived
                    ? 'Shortfall waived'
                    : open.shortfallDays
                      ? `${String(open.shortfallDays)} days short (expected last day ${dmy(open.expectedLastDay)})`
                      : 'Served in full'}
                </dd>
              </div>
            ) : null}
            {open.status === 'pending' ? (
              <div>
                <dt>Waiting at</dt>
                <dd>{open.waitingAt ?? 'The approvers'}</dd>
              </div>
            ) : null}
            <div>
              <dt>Reason</dt>
              <dd>{open.reason}</dd>
            </div>
            {open.letterFileId ? (
              <div>
                <dt>Letter</dt>
                <dd>
                  <FileLinks
                    url={`/api/exit-letter/${open.id}`}
                    saveUrl={`/api/exit-letter/${open.id}?save=1`}
                    label="my letter"
                  />
                </dd>
              </div>
            ) : null}
          </dl>
          {open.status === 'sent_back' ? (
            <>
              <p className="ep-alert ep-alert--info" role="status">
                Sent back: {open.sentBackNote}
              </p>
              <form action={resubmitResignation} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
                <input type="hidden" name="id" value={open.id} />
                <label className="ep-field" htmlFor="rs-last">
                  <span className="ep-field__label">Proposed last working day</span>
                  <input
                    id="rs-last"
                    name="proposedLastDay"
                    className="ep-input"
                    type="date"
                    min={open.requestedOn}
                    defaultValue={open.proposedLastDay}
                  />
                </label>
                <label className="ep-field" htmlFor="rs-reason">
                  <span className="ep-field__label">Reason</span>
                  <textarea
                    id="rs-reason"
                    name="reason"
                    className="ep-input"
                    rows={3}
                    required
                    minLength={3}
                    maxLength={1000}
                    defaultValue={open.reason}
                  />
                </label>
                <label className="ep-field" htmlFor="rs-letter">
                  <span className="ep-field__label">A new letter (PDF or photo, optional)</span>
                  <input
                    id="rs-letter"
                    name="letter"
                    className="ep-input"
                    type="file"
                    accept="application/pdf,image/png,image/jpeg,image/webp"
                  />
                </label>
                <button type="submit" className="ep-btn ep-btn--primary">
                  Send again
                </button>
              </form>
            </>
          ) : null}
          {open.status === 'pending' || open.status === 'sent_back' ? (
            <form action={withdrawResignation} style={{ marginTop: 'var(--sp-3)' }}>
              <input type="hidden" name="id" value={open.id} />
              <button type="submit" className="ep-btn ep-btn--ghost">
                Withdraw my {open.exitType.name.toLowerCase()}
              </button>
            </form>
          ) : null}
        </Card>
      ) : mine.types.length ? (
        <Card title="Ask for resignation">
          <form action={applyResignation} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            {mine.types.length > 1 ? (
              <label className="ep-field" htmlFor="rn-type">
                <span className="ep-field__label">Type</span>
                <select id="rn-type" name="exitType" className="ep-select">
                  {mine.types.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <input type="hidden" name="exitType" value={mine.types[0]!.code} />
            )}
            <label className="ep-field" htmlFor="rn-last">
              <span className="ep-field__label">Proposed last working day</span>
              <input
                id="rn-last"
                name="proposedLastDay"
                className="ep-input"
                type="date"
                min={today}
                defaultValue={expected}
                aria-describedby="rn-last-help"
              />
              <span id="rn-last-help" className="ep-field__help">
                With {mine.noticeDays} days of notice the last day is {dmy(expected)}. An earlier
                day is a shortfall the school may waive.
              </span>
            </label>
            <label className="ep-field" htmlFor="rn-reason">
              <span className="ep-field__label">Reason</span>
              <textarea
                id="rn-reason"
                name="reason"
                className="ep-input"
                rows={3}
                required
                minLength={3}
                maxLength={1000}
              />
            </label>
            <label className="ep-field" htmlFor="rn-letter">
              <span className="ep-field__label">Resignation letter (PDF or photo, optional)</span>
              <input
                id="rn-letter"
                name="letter"
                className="ep-input"
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
              />
            </label>
            <button type="submit" className="ep-btn ep-btn--primary">
              Send for approval
            </button>
          </form>
        </Card>
      ) : (
        <Card>The school takes resignations at the office.</Card>
      )}
      {mine.data.filter((x) => x !== open).length ? (
        <Card title="Earlier" style={{ marginTop: 'var(--sp-4)' }}>
          <ul className="ep-rp__events">
            {mine.data
              .filter((x) => x !== open)
              .map((x) => (
                <li key={x.id}>
                  {x.exitType.name} asked on {dmy(x.requestedOn)}: {STATUS[x.status]}
                  {x.decisionNote ? ` · ${x.decisionNote}` : ''}
                </li>
              ))}
          </ul>
        </Card>
      ) : null}
    </main>
  );
}
