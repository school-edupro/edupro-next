import { Badge, Breadcrumbs, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ExitActions } from '@/components/exits/ExitActions';
import { ExitClearance } from '@/components/exits/ExitClearance';
import { ViewDownload } from '@/components/admissions/ViewDownload';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { EXIT_EVENT, EXIT_STATUS, dmy, type ExitDetail } from '@/lib/exits';

const STEP: Record<string, string> = {
  pending: 'Waiting',
  approved: 'Approved',
  rejected: 'Ended here',
  skipped: 'Skipped',
};
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '';

/** One exit: the employee, the dates and notice, the letter, the approval steps and the timeline. */
export default async function ExitPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  const x = await apiFetch<ExitDetail>(`/people/exits/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const facts: Array<[string, React.ReactNode]> = [
    ['Exit', x.exitType.name],
    [
      'Asked',
      `${dmy(x.requestedOn)} · ${x.bySelf ? 'by the employee (staff app)' : `by the office${x.raisedBy ? ` (${x.raisedBy})` : ''}`}`,
    ],
    [
      'Notice period',
      x.noticeDays
        ? `${String(x.noticeDays)} days: expected last day ${dmy(x.expectedLastDay)}`
        : 'Does not apply',
    ],
    ['Proposed last working day', dmy(x.proposedLastDay)],
    ['Accepted last working day', x.acceptedLastDay ? dmy(x.acceptedLastDay) : '—'],
    [
      'Notice shortfall',
      x.noticeWaived ? 'Waived' : x.shortfallDays ? `${String(x.shortfallDays)} days` : 'None',
    ],
    ['Reason', x.reason],
    [
      'Letter',
      x.letterFileId ? (
        <ViewDownload href={`/api/exit-letter/${x.id}`} what="the letter" />
      ) : (
        'Not attached'
      ),
    ],
  ];
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee management', href: '/people/employees' },
          { label: 'Exits and resignations', href: '/people/exits' },
          { label: x.employee.name },
        ]}
      />
      <PageHeader
        kicker={`${x.employee.code} · ${x.employee.typeName}${x.employee.department ? ` · ${x.employee.department}` : ''}`}
        title={x.employee.name}
        description={x.employee.designation ?? undefined}
        actions={<Badge tone={EXIT_STATUS[x.status].tone}>{EXIT_STATUS[x.status].label}</Badge>}
      />
      <Notice params={sp} />
      {x.status === 'sent_back' && x.sentBackNote ? (
        <div
          className="ep-alert ep-alert--info"
          role="status"
          style={{ marginBottom: 'var(--sp-4)' }}
        >
          Sent back: {x.sentBackNote}
        </div>
      ) : null}
      <div className="ep-grid-cards">
        <Card title="The exit">
          <dl className="ep-facts">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card title="Approval">
          {x.steps.length ? (
            <ol className="ep-rp__events">
              {x.steps.map((s) => (
                <li key={s.level}>
                  <strong>{s.name}</strong> · {STEP[s.status] ?? s.status}
                  <div className="ep-field__help">
                    {s.actedBy
                      ? `${s.actedBy} ${when(s.actedAt)}`
                      : s.assignees.join(', ') || 'Nobody holds this level'}
                    {s.note ? ` · ${s.note}` : ''}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p style={{ margin: 0 }}>Not sent for approval.</p>
          )}
        </Card>
      </div>
      <div style={{ marginTop: 'var(--sp-4)' }}>
        <ExitActions x={x} />
      </div>
      {x.clearances.length ? (
        <Card title="No-dues clearance" style={{ marginTop: 'var(--sp-4)' }}>
          <ExitClearance
            exitId={x.id}
            rows={x.clearances}
            canReopen={x.status === 'approved' && me.permissions.includes('people.exit.manage')}
          />
        </Card>
      ) : null}
      <Card title="What happened" style={{ marginTop: 'var(--sp-4)' }}>
        <ul className="ep-rp__events">
          {x.events.map((e, i) => (
            <li key={`${e.at}-${String(i)}`}>
              {EXIT_EVENT[e.what] ?? e.what}
              {e.note ? `: ${e.note}` : ''}
              <div className="ep-field__help">
                {e.by ?? ''} {when(e.at)}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
