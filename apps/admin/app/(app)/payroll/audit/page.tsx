import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Pager, PerPage, pageSizeOf } from '@/components/Pager';
import { ApiError, apiFetch, getMe } from '@/lib/api';

interface Row {
  id: string;
  at: string;
  who: string | null;
  kind: 'Change' | 'Event' | 'Read';
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  changed: string[];
  self?: boolean;
}
const KEYS = ['from', 'to', 'kind', 'table', 'action', 'who', 'record', 'contains'] as const;
const TONE = { Change: 'info', Event: 'neutral', Read: 'warning' } as const;
const when = (s: string) =>
  new Date(s)
    .toLocaleString('en-GB', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
    .replace(/\//g, '-')
    .replace(',', '');
const ACTION_WORDS: Record<string, string> = {
  insert: 'Added',
  update: 'Changed',
  delete: 'Removed',
  'payroll.report.view': 'Ran a report',
  'payroll.report.download': 'Downloaded a report',
  'payroll.audit.view': 'Looked at the audit trail',
  'payroll.audit.export': 'Exported the audit trail',
  'payroll.profile.reveal': 'Revealed a PAN or account',
};

/**
 * The payroll audit trail (docs/design/86, phase F): every payroll change (each table's rows before and after), each
 * event (runs, approvals, settings and roles, files) and each read (reports run or downloaded, reveals). Kept as long
 * as the audit log is; seeing it is itself recorded. For checkers, the payroll admin and the payroll auditor.
 */
export default async function PayrollAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('payroll.audit.view')) notFound();
  const size = pageSizeOf(sp.size);
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const q = new URLSearchParams();
  for (const k of KEYS) if (sp[k]) q.set(k, sp[k]!);
  let d: { rows: Row[]; total: number; tables: string[] };
  try {
    d = await apiFetch(`/payroll/audit?${q.toString()}&page=${String(page)}&size=${size}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) notFound();
    if (e instanceof ApiError && e.status === 400) d = { rows: [], total: 0, tables: [] };
    else throw e;
  }
  const href = (p: number) => `/payroll/audit?${q.toString()}&size=${size}&page=${String(p)}`;
  const fy = (() => {
    const t = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const y = Number(t.slice(5, 7)) >= 4 ? Number(t.slice(0, 4)) : Number(t.slice(0, 4)) - 1;
    return `${String(y - 1)}-${String(y % 100).padStart(2, '0')}`;
  })();
  return (
    <>
      <Breadcrumbs items={[{ label: 'Payroll', href: '/payroll' }, { label: 'Audit trail' }]} />
      <PageHeader
        kicker="Payroll"
        title="Payroll audit trail"
        description="Every payroll change, event and read, with the fields before and after. Kept as long as the audit log; looking here is recorded too."
      />
      <section className="ep-card" aria-labelledby="au-f">
        <h2 id="au-f" className="ep-card__title">
          Find
        </h2>
        <form method="get" action="/payroll/audit" className="ep-form-section__body">
          <div className="ep-form-row" data-columns="4">
            <label className="ep-field" htmlFor="au-from">
              <span className="ep-field__label">From</span>
              <input
                id="au-from"
                name="from"
                type="date"
                className="ep-input"
                defaultValue={sp.from ?? ''}
              />
            </label>
            <label className="ep-field" htmlFor="au-to">
              <span className="ep-field__label">To</span>
              <input
                id="au-to"
                name="to"
                type="date"
                className="ep-input"
                defaultValue={sp.to ?? ''}
              />
            </label>
            <label className="ep-field" htmlFor="au-kind">
              <span className="ep-field__label">Kind</span>
              <select id="au-kind" name="kind" className="ep-select" defaultValue={sp.kind ?? ''}>
                <option value="">All</option>
                <option value="Change">Changes</option>
                <option value="Event">Events</option>
                <option value="Read">Reads</option>
              </select>
            </label>
            <label className="ep-field" htmlFor="au-table">
              <span className="ep-field__label">Table</span>
              <select
                id="au-table"
                name="table"
                className="ep-select"
                defaultValue={sp.table ?? ''}
              >
                <option value="">All payroll tables</option>
                {d.tables.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/^payroll_/, '').replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </label>
            <label className="ep-field" htmlFor="au-who">
              <span className="ep-field__label">Who</span>
              <input
                id="au-who"
                name="who"
                className="ep-input"
                defaultValue={sp.who ?? ''}
                maxLength={80}
              />
            </label>
            <label className="ep-field" htmlFor="au-act">
              <span className="ep-field__label">Action begins with</span>
              <input
                id="au-act"
                name="action"
                className="ep-input"
                defaultValue={sp.action ?? ''}
                placeholder="payroll.run"
                maxLength={80}
              />
            </label>
            <label className="ep-field" htmlFor="au-rec">
              <span className="ep-field__label">Record id</span>
              <input
                id="au-rec"
                name="record"
                className="ep-input"
                defaultValue={sp.record ?? ''}
                maxLength={64}
              />
            </label>
            <label className="ep-field" htmlFor="au-has">
              <span className="ep-field__label">Contains</span>
              <input
                id="au-has"
                name="contains"
                className="ep-input"
                defaultValue={sp.contains ?? ''}
                maxLength={100}
              />
            </label>
            <PerPage id="au-size" value={size} />
          </div>
          <div className="ep-grid__toolbar">
            <button type="submit" className="ep-btn ep-btn--primary">
              Show
            </button>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={`/api/payroll/pay-file?kind=auditlog&${q.toString()}`}
              download
            >
              Excel (before and after)
            </a>
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href="/payroll/audit?contains=selfApproved"
            >
              Self-approvals
            </a>
            {me.permissions.includes('payroll.run.approve') ? (
              <a
                className="ep-btn ep-btn--ghost ep-btn--sm"
                href={`/api/payroll/pay-file?kind=auditpack&fy=${fy}`}
                download
              >
                Auditor pack {fy} (ZIP)
              </a>
            ) : null}
          </div>
        </form>
      </section>
      <section className="ep-card" aria-labelledby="au-list">
        <h2 id="au-list" className="ep-card__title">
          Entries
        </h2>
        {d.rows.length ? (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-labelledby="au-list">
            <table className="ep-table ep-table--dense">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Who</th>
                  <th scope="col">Kind</th>
                  <th scope="col">What</th>
                  <th scope="col">Record</th>
                  <th scope="col">Fields changed</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <a href={`/payroll/audit/${r.id}`}>{when(r.at)}</a>
                    </td>
                    <td>{r.who ?? 'The system'}</td>
                    <td>
                      <Badge tone={TONE[r.kind]}>{r.kind}</Badge>
                    </td>
                    <td>
                      {ACTION_WORDS[r.action] ?? r.action}
                      {r.self ? (
                        <>
                          {' '}
                          <Badge tone="warning">Self-approved</Badge>
                        </>
                      ) : null}
                      {r.entity_type ? (
                        <div className="ep-field__help">{r.entity_type.replace(/_/g, ' ')}</div>
                      ) : null}
                    </td>
                    <td>{r.entity_id ?? ''}</td>
                    <td>{r.changed.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>Nothing found.</p>
        )}
        <Pager page={page} size={Number(size)} total={d.total} href={href} noun="entries" />
      </section>
    </>
  );
}
