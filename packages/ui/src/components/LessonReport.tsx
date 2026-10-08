import type { ReactNode } from 'react';

export interface LessonListRow {
  id: string;
  date: string;
  classes: string;
  topic: string;
  employee: string;
  employeeCode: string;
  department: string;
  status: 'pending' | 'acknowledged' | 'rejected';
  currentLevel: number;
  levels: number;
  approver: string | null;
  requestedAt: string;
  files: number;
  mine: boolean;
  myTurn: boolean;
  deleted: boolean;
}
export interface LessonListData {
  data: LessonListRow[];
  counts: { total: number; pending: number; acknowledged: number; rejected: number };
  page: { number: number; size: number; total: number };
  office: boolean;
}
export interface LessonFilters {
  by?: string;
  q?: string;
  from?: string;
  to?: string;
  status?: string;
  level?: string;
  record?: string;
  mine?: string;
}

const STATUS = { pending: 'Pending', acknowledged: 'Acknowledged', rejected: 'Rejected' } as const;
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' }).replace(/\//g, '-');

/**
 * Lesson Report: the four counts, the filters, the status tabs and the list with who each lesson waits
 * for. `path` is the page (its `tab` is kept by `keep`), `exportPath` the app's download route.
 */
export function LessonReport({
  list,
  filters,
  path,
  keep,
  exportPath,
  detailHref,
}: {
  list: LessonListData;
  filters: LessonFilters;
  path: string;
  /** Query pairs every link keeps (the tab of the page). */
  keep: Record<string, string>;
  exportPath: string;
  detailHref: (id: string) => string;
}) {
  const clean = Object.fromEntries(
    Object.entries(filters).filter(([, v]) => v !== undefined && v !== ''),
  ) as Record<string, string>;
  const href = (over: Record<string, string | undefined>) => {
    const q = new URLSearchParams({ ...keep, ...clean });
    for (const [k, v] of Object.entries(over)) {
      if (v === undefined || v === '') q.delete(k);
      else q.set(k, v);
    }
    return `${path}?${q.toString()}`;
  };
  const exportQuery = new URLSearchParams(clean).toString();
  const tiles: Array<[string, number, string | undefined, string]> = [
    ['Total requests', list.counts.total, undefined, 'total'],
    ['Pending', list.counts.pending, 'pending', 'pending'],
    ['Acknowledged', list.counts.acknowledged, 'acknowledged', 'acknowledged'],
    ['Rejected', list.counts.rejected, 'rejected', 'rejected'],
  ];
  const tab = (label: string, n: number, status: string | undefined): ReactNode => (
    <a
      key={label}
      href={href({ status })}
      aria-current={(filters.status ?? '') === (status ?? '') ? 'page' : undefined}
    >
      {label} ({n})
    </a>
  );
  return (
    <div className="ep-lesson">
      <div className="ep-lesson__tiles">
        {tiles.map(([label, n, status, tone]) => (
          <a key={label} href={href({ status })} className="ep-lesson__tile" data-tone={tone}>
            <span className="ep-lesson__tilelabel">{label}</span>
            <span className="ep-lesson__tilenum">{n}</span>
          </a>
        ))}
      </div>
      <form method="get" action={path} className="ep-lesson__filters">
        {Object.entries(keep).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label className="ep-field">
          <span className="ep-field__label">Filter type</span>
          <select className="ep-select" name="by" defaultValue={filters.by ?? 'employee_code'}>
            <option value="employee_code">Employee ID</option>
            <option value="employee">Employee name</option>
            <option value="class">Class</option>
            <option value="topic">Topic</option>
            <option value="any">Any of these</option>
          </select>
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Search keyword</span>
          <input
            className="ep-input"
            name="q"
            defaultValue={filters.q ?? ''}
            placeholder="Enter search term"
            maxLength={80}
          />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Date from</span>
          <input className="ep-input" type="date" name="from" defaultValue={filters.from ?? ''} />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Date to</span>
          <input className="ep-input" type="date" name="to" defaultValue={filters.to ?? ''} />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Status</span>
          <select className="ep-select" name="status" defaultValue={filters.status ?? ''}>
            <option value="">All status</option>
            <option value="pending">Pending</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Level</span>
          <select className="ep-select" name="level" defaultValue={filters.level ?? ''}>
            <option value="">All levels</option>
            <option value="1">Level 1 pending</option>
            <option value="2">Level 2 pending</option>
            <option value="3">Level 3 pending</option>
          </select>
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Record status</span>
          <select className="ep-select" name="record" defaultValue={filters.record ?? 'active'}>
            <option value="active">Active</option>
            <option value="deleted">Deleted</option>
          </select>
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Show</span>
          <select className="ep-select" name="mine" defaultValue={filters.mine ?? ''}>
            <option value="">{list.office ? 'All lessons' : 'Mine and those I approve'}</option>
            <option value="approve">Waiting for me</option>
            <option value="own">Uploaded by me</option>
          </select>
        </label>
        <span className="ep-lesson__buttons">
          <button type="submit" className="ep-btn ep-btn--primary">
            Search
          </button>
          <a
            className="ep-btn ep-btn--secondary"
            href={`${path}?${new URLSearchParams(keep).toString()}`}
          >
            Reset
          </a>
          <a className="ep-btn ep-btn--secondary" href={`${exportPath}?format=xlsx&${exportQuery}`}>
            Excel
          </a>
          <a className="ep-btn ep-btn--secondary" href={`${exportPath}?format=pdf&${exportQuery}`}>
            PDF
          </a>
        </span>
      </form>
      <nav className="ep-tabs-links" aria-label="Status">
        {tab('All', list.counts.total, undefined)}
        {tab('Pending', list.counts.pending, 'pending')}
        {tab('Acknowledged', list.counts.acknowledged, 'acknowledged')}
        {tab('Rejected', list.counts.rejected, 'rejected')}
      </nav>
      {list.data.length === 0 ? (
        <p className="ep-sheet__hint">No lesson for these filters.</p>
      ) : (
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Lessons">
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">Lessons uploaded for approval</caption>
            <thead>
              <tr>
                <th scope="col">S.no</th>
                <th scope="col">Request ID</th>
                <th scope="col">Employee details</th>
                <th scope="col">Class</th>
                <th scope="col">Topic</th>
                <th scope="col">Request date</th>
                <th scope="col">Status</th>
                <th scope="col">Current approver</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((r, i) => (
                <tr key={r.id}>
                  <td>{(list.page.number - 1) * list.page.size + i + 1}</td>
                  <th scope="row">
                    <a href={detailHref(r.id)} style={{ textDecoration: 'underline' }}>
                      #{r.id}
                    </a>
                  </th>
                  <td>
                    <strong>{r.employee}</strong>
                    <span className="ep-sheet__meta">
                      {r.employeeCode}
                      {r.department ? ` · ${r.department}` : ''}
                    </span>
                  </td>
                  <td>{r.classes}</td>
                  <td>
                    {r.topic}
                    {r.files ? (
                      <span className="ep-sheet__meta">{r.files} attachment(s)</span>
                    ) : null}
                  </td>
                  <td>{day(r.requestedAt)}</td>
                  <td>
                    <span className="ep-lesson__status" data-status={r.status}>
                      {STATUS[r.status]}
                    </span>
                  </td>
                  <td>
                    {r.status === 'pending' ? (
                      <>
                        <span className="ep-lesson__level">
                          Level {r.currentLevel} of {r.levels} pending
                        </span>
                        <span className="ep-sheet__meta">{r.approver ?? 'N/A'}</span>
                      </>
                    ) : (
                      '–'
                    )}
                  </td>
                  <td>
                    <a
                      className={`ep-btn ep-btn--sm ${r.myTurn ? 'ep-btn--primary' : 'ep-btn--secondary'}`}
                      href={detailHref(r.id)}
                      aria-label={`${r.myTurn ? 'Review' : 'View'} lesson ${r.id}: ${r.topic}`}
                    >
                      {r.myTurn ? 'Review' : 'View'}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.page.total > list.page.size ? (
        <nav className="ep-lesson__pager" aria-label="Pages">
          {list.page.number > 1 ? (
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={href({ page: String(list.page.number - 1) })}
            >
              ‹ Previous
            </a>
          ) : null}
          <span>
            Page {list.page.number} of {Math.ceil(list.page.total / list.page.size)}
          </span>
          {list.page.number * list.page.size < list.page.total ? (
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={href({ page: String(list.page.number + 1) })}
            >
              Next ›
            </a>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

// ---- one lesson -----------------------------------------------------------------------------------
export interface LessonDetailData extends LessonListRow {
  description: string | null;
  fileIds: string[];
  ruleScope: string | null;
  approvals: Array<{
    level: number;
    approver: string;
    byRole: boolean;
    state: 'pending' | 'acknowledged' | 'rejected';
    remark: string | null;
    actedBy: string | null;
    actedAt: string | null;
  }>;
}
type Act = (fd: FormData) => void | Promise<void>;
const RULE: Record<string, string> = {
  employee: 'the rule for this employee',
  class: 'the rule for the class',
  department: 'the rule for the department',
  default: 'the school default',
  none: 'no rule (the principal / school admin)',
};
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** One lesson in full: what was uploaded, its attachments, the levels it went through, and my action. */
export function LessonDetail({
  lesson,
  office,
  fileLinks,
  acknowledge,
  reject,
  remove,
}: {
  lesson: LessonDetailData;
  office: boolean;
  fileLinks: (fileId: string, n: number) => ReactNode;
  acknowledge: Act;
  reject: Act;
  remove: Act;
}) {
  const untouched = lesson.approvals.every((a) => a.state === 'pending');
  return (
    <div className="ep-lesson">
      <section className="ep-card">
        <h2 className="ep-card__title">Lesson</h2>
        <dl className="ep-lesson__facts">
          <div>
            <dt>Employee</dt>
            <dd>
              {lesson.employee} ({lesson.employeeCode})
              {lesson.department ? ` · ${lesson.department}` : ''}
            </dd>
          </div>
          <div>
            <dt>Lesson date</dt>
            <dd>{lesson.date}</dd>
          </div>
          <div>
            <dt>Class</dt>
            <dd>{lesson.classes}</dd>
          </div>
          <div>
            <dt>Requested</dt>
            <dd>{when(lesson.requestedAt)}</dd>
          </div>
        </dl>
        {lesson.description ? (
          <div
            className="ep-prose ep-richtext"
            dangerouslySetInnerHTML={{ __html: lesson.description }}
          />
        ) : (
          <p className="ep-field__help">No description was written.</p>
        )}
        {lesson.fileIds.length ? (
          <div className="ep-sheet__files">
            <span>Attachments</span>
            {lesson.fileIds.map((f, i) => (
              <span key={f}>{fileLinks(f, i + 1)}</span>
            ))}
          </div>
        ) : null}
      </section>
      <section className="ep-card">
        <h2 className="ep-card__title">Approval</h2>
        <p className="ep-field__help">
          Approvers come from {RULE[lesson.ruleScope ?? 'none'] ?? 'the set-up'}.
        </p>
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Approval levels">
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">The levels this lesson goes through</caption>
            <thead>
              <tr>
                <th scope="col">Level</th>
                <th scope="col">Approver</th>
                <th scope="col">Status</th>
                <th scope="col">By and when</th>
                <th scope="col">Remark</th>
              </tr>
            </thead>
            <tbody>
              {lesson.approvals.map((a) => (
                <tr key={a.level}>
                  <th scope="row">Level {a.level}</th>
                  <td>
                    {a.approver}
                    {a.byRole ? (
                      <span className="ep-sheet__meta">anyone with this role</span>
                    ) : null}
                  </td>
                  <td>
                    <span className="ep-lesson__status" data-status={a.state}>
                      {a.state === 'pending'
                        ? lesson.status === 'pending' && a.level === lesson.currentLevel
                          ? 'Waiting'
                          : lesson.status === 'pending'
                            ? 'Not reached'
                            : '–'
                        : STATUS[a.state]}
                    </span>
                  </td>
                  <td>{a.actedAt ? `${a.actedBy ?? ''} · ${when(a.actedAt)}` : '–'}</td>
                  <td>{a.remark ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {lesson.myTurn && !lesson.deleted ? (
          <form className="ep-lesson__decide">
            <input type="hidden" name="id" value={lesson.id} />
            <label className="ep-field">
              <span className="ep-field__label">Remark (needed to reject)</span>
              <input className="ep-input" name="remark" maxLength={500} />
            </label>
            <button type="submit" className="ep-btn ep-btn--primary" formAction={acknowledge}>
              Acknowledge
            </button>
            <button type="submit" className="ep-btn ep-btn--secondary" formAction={reject}>
              Reject
            </button>
          </form>
        ) : null}
        {!lesson.deleted && (office || (lesson.mine && untouched)) ? (
          <form action={remove} style={{ marginTop: 'var(--sp-3)' }}>
            <input type="hidden" name="id" value={lesson.id} />
            <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
              Delete this lesson
            </button>
          </form>
        ) : null}
        {lesson.deleted ? <p className="ep-field__help">This lesson was deleted.</p> : null}
      </section>
    </div>
  );
}
