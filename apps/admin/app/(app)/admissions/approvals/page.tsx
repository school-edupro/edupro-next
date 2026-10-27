import { Badge, Card, PageHeader } from '@edupro/ui';
import {
  DECISION_LABEL,
  STATUS_LABEL,
  approvalsQuery,
  remarkColumns,
  type ApprovalFilters,
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
const BASE = '/admissions/approvals';
const dmy = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
  }).format(new Date(iso));

/**
 * Admission approvals (docs/design/50, 51): the registrations waiting at a level this person is named
 * in, and those they decided lately, with every level's decision and remark as columns; filters and
 * Excel / PDF of what is shown. Open to anyone named in a process level; the API shows each only theirs.
 */
export default async function AdmissionApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<ApprovalFilters & { ok?: string }>;
}) {
  const sp = await searchParams;
  const tab = sp.tab === 'decided' ? 'decided' : 'waiting';
  const q = approvalsQuery({ ...sp, tab });
  const list = await apiFetch<ApprovalList>(`/admissions/approvals?${q.toString()}&size=500`);
  const cols = remarkColumns(list.data);
  const remarkAt = (r: ApprovalRow, col: string) =>
    r.remarks.find((m) => `${m.stage} · ${m.levelName}` === col);
  const filtered = [...q.keys()].some((k) => k !== 'tab');
  const o = list.options;
  return (
    <>
      <PageHeader
        kicker="Admissions"
        title="Admission approvals"
        description="Registrations waiting for your decision at the levels you are named in. Open one to see the form, the documents and the points, correct an answer if needed, and decide with your remark."
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/api/admission-approvals/export?${q.toString()}&format=xlsx`}
            >
              Export Excel
            </a>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/api/admission-approvals/export?${q.toString()}&format=pdf`}
            >
              Export PDF
            </a>
          </span>
        }
      />
      {sp.ok && OK[sp.ok] ? (
        <p className="ep-alert ep-alert--success" role="status">
          {OK[sp.ok]}
        </p>
      ) : null}
      <nav className="ep-lead-views" aria-label="Show" style={{ marginBottom: 'var(--sp-3)' }}>
        <a href={BASE} aria-current={tab === 'waiting' ? 'page' : undefined}>
          Waiting for me ({list.waiting}
          {list.overdue ? `, ${String(list.overdue)} overdue` : ''})
        </a>
        <a href={`${BASE}?tab=decided`} aria-current={tab === 'decided' ? 'page' : undefined}>
          Decided by me ({list.decided})
        </a>
      </nav>
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <form
          method="get"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))',
            gap: 'var(--sp-3)',
            alignItems: 'end',
          }}
        >
          <input type="hidden" name="tab" value={tab} />
          <label className="ep-field" style={{ margin: 0 }}>
            <span className="ep-field__label">Search</span>
            <input
              className="ep-input"
              name="q"
              defaultValue={sp.q ?? ''}
              placeholder="Name, registration no., mobile"
            />
          </label>
          <label className="ep-field" style={{ margin: 0 }}>
            <span className="ep-field__label">Session</span>
            <select className="ep-select" name="cycleId" defaultValue={sp.cycleId ?? ''}>
              <option value="">All sessions</option>
              {o.sessions.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" style={{ margin: 0 }}>
            <span className="ep-field__label">Class</span>
            <select className="ep-select" name="classId" defaultValue={sp.classId ?? ''}>
              <option value="">All classes</option>
              {o.classes.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" style={{ margin: 0 }}>
            <span className="ep-field__label">Stage</span>
            <select className="ep-select" name="stage" defaultValue={sp.stage ?? ''}>
              <option value="">Any stage</option>
              {o.stages.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" style={{ margin: 0 }}>
            <span className="ep-field__label">Level</span>
            <select className="ep-select" name="level" defaultValue={sp.level ?? ''}>
              <option value="">Any level</option>
              {o.levels.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" style={{ margin: 0 }}>
            <span className="ep-field__label">Fee category</span>
            <select className="ep-select" name="categoryId" defaultValue={sp.categoryId ?? ''}>
              <option value="">All categories</option>
              {o.categories.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" style={{ margin: 0 }}>
            <span className="ep-field__label">Status</span>
            <select className="ep-select" name="status" defaultValue={sp.status ?? ''}>
              <option value="">Any status</option>
              {o.statuses.map((x) => (
                <option key={x} value={x}>
                  {STATUS_LABEL[x] ?? x}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" style={{ margin: 0 }}>
            <span className="ep-field__label">
              {tab === 'decided' ? 'Decided from' : 'Waiting since, from'}
            </span>
            <input className="ep-input" type="date" name="from" defaultValue={sp.from ?? ''} />
          </label>
          <label className="ep-field" style={{ margin: 0 }}>
            <span className="ep-field__label">to</span>
            <input className="ep-input" type="date" name="to" defaultValue={sp.to ?? ''} />
          </label>
          {tab === 'waiting' ? (
            <label className="ep-check">
              <input type="checkbox" name="overdue" value="1" defaultChecked={sp.overdue === '1'} />
              <span>Overdue only</span>
            </label>
          ) : null}
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
            <button className="ep-btn ep-btn--primary" type="submit">
              Show
            </button>
            {filtered ? (
              <a className="ep-btn ep-btn--ghost" href={`${BASE}?tab=${tab}`}>
                Clear
              </a>
            ) : null}
          </span>
        </form>
      </Card>
      <Card>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          {list.total} registration{list.total === 1 ? '' : 's'}
          {filtered ? ' match the filters' : ''}.
        </p>
        {list.data.length === 0 ? (
          <p style={{ margin: 0 }}>
            {filtered
              ? 'No registration matches the filters.'
              : tab === 'waiting'
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
                      <a href={`${BASE}/${r.id}`}>{r.candidate ?? r.number}</a>
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
