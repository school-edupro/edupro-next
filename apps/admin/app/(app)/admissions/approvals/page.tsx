import { Badge, Card, PageHeader } from '@edupro/ui';
import {
  DECISION_LABEL,
  STATUS_LABEL,
  remarkColumns,
  type ApprovalList,
  type ApprovalRow,
} from '@/lib/admission-approvals';
import { apiFetch } from '@/lib/api';

const OK: Record<string, string> = {
  approve: 'Approved: it moves on to the next level.',
  hold: 'Put on hold with your remark.',
  reject: 'Marked not selected; the family is told.',
  'sent-back': 'Sent back to the family to correct.',
};
const dmy = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
  }).format(new Date(iso));

/**
 * Admission approvals (docs/design/50): the registrations waiting at a level this person is named in,
 * and those they decided lately, with every level's decision and remark as columns. Open to anyone
 * named in a process level; the API shows each only what waits for them.
 */
export default async function AdmissionApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; ok?: string }>;
}) {
  const sp = await searchParams;
  const tab = sp.tab === 'decided' ? 'decided' : 'waiting';
  const list = await apiFetch<ApprovalList>(`/admissions/approvals?tab=${tab}&size=200`);
  const cols = remarkColumns(list.data);
  const remarkAt = (r: ApprovalRow, col: string) =>
    r.remarks.find((m) => `${m.stage} · ${m.levelName}` === col);
  return (
    <>
      <PageHeader
        kicker="Admissions"
        title="Admission approvals"
        description="Registrations waiting for your decision at the levels you are named in. Open one to see the form, the documents and the points, and decide with your remark."
      />
      {sp.ok && OK[sp.ok] ? (
        <p className="ep-alert ep-alert--success" role="status">
          {OK[sp.ok]}
        </p>
      ) : null}
      <nav className="ep-lead-views" aria-label="Show" style={{ marginBottom: 'var(--sp-3)' }}>
        <a href="/admissions/approvals" aria-current={tab === 'waiting' ? 'page' : undefined}>
          Waiting for me ({list.waiting}
          {list.overdue ? `, ${String(list.overdue)} overdue` : ''})
        </a>
        <a
          href="/admissions/approvals?tab=decided"
          aria-current={tab === 'decided' ? 'page' : undefined}
        >
          Decided by me ({list.decided})
        </a>
      </nav>
      <Card>
        {list.data.length === 0 ? (
          <p style={{ margin: 0 }}>
            {tab === 'waiting'
              ? 'Nothing waits for your decision now.'
              : 'You have not decided any registration in the last 30 days.'}
          </p>
        ) : (
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Registrations (scrolls sideways)"
          >
            <table className="ep-table">
              <caption className="ep-sr-only">Admission approvals</caption>
              <thead>
                <tr>
                  <th scope="col">Registration</th>
                  <th scope="col">Class</th>
                  <th scope="col">Points</th>
                  <th scope="col">{tab === 'waiting' ? 'Waiting at' : 'Status'}</th>
                  {cols.map((c) => (
                    <th key={c} scope="col">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.data.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <a href={`/admissions/approvals/${r.id}`}>{r.candidate ?? r.number}</a>
                      <div className="ep-field__help" style={{ margin: 0 }}>
                        {[r.number, r.category].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td>{r.className}</td>
                    <td className="ep-num">{r.points ?? '-'}</td>
                    <td>
                      {tab === 'waiting' ? (
                        <>
                          {r.stage ?? '-'}
                          <div className="ep-field__help" style={{ margin: 0 }}>
                            {r.level ?? ''}
                            {r.since ? ` · since ${dmy(r.since)}` : ''}
                          </div>
                          {r.overdue ? <Badge tone="danger">Overdue</Badge> : null}
                        </>
                      ) : (
                        (STATUS_LABEL[r.status] ?? r.status)
                      )}
                    </td>
                    {cols.map((c) => {
                      const m = remarkAt(r, c);
                      return (
                        <td key={c}>
                          {m ? (
                            <>
                              <strong>{DECISION_LABEL[m.decision] ?? m.decision}</strong>
                              {m.remarks ? ` — ${m.remarks}` : ''}
                              <div className="ep-field__help" style={{ margin: 0 }}>
                                {m.by ?? ''} · {dmy(m.at)}
                              </div>
                            </>
                          ) : (
                            <span className="ep-field__help">-</span>
                          )}
                        </td>
                      );
                    })}
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
