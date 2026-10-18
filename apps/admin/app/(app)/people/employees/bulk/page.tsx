import { Badge, Breadcrumbs, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { Notice } from '@/components/Notice';
import { Icon } from '@/components/nav-icons';
import { employeeBulkCommit, employeeBulkValidate } from '@/lib/employee-actions';
import { apiFetch, getMe } from '@/lib/api';
import type { EmployeeCatalogue } from '@/lib/employee';

interface BulkSummary {
  id: string;
  mode: 'update' | 'create';
  fileName: string | null;
  status: string;
  totalRows: number;
  readyRows: number;
  rejectedRows: number;
  unchangedRows: number;
  applied: number;
  committedAt: string | null;
  problems: Array<{ row: number; code?: string; column: string; message: string }>;
  preview: Array<{
    row: number;
    code: string;
    name: string;
    login: boolean | null;
    changes: Array<{ field: string; from: unknown; to: unknown }>;
  }>;
}
interface BulkListRow {
  id: string;
  mode: 'update' | 'create';
  fileName: string | null;
  status: string;
  totalRows: number;
  readyRows: number;
  rejectedRows: number;
  applied: number;
  createdAt: string;
  requestedBy: string | null;
}

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

/**
 * Employees from Excel (docs/design/30-employee-master.md, part 3): download a template (update: pre-filled
 * by code; create: empty), upload, check every row (old → new, errors by cell), then apply.
 */
export default async function EmployeeBulkPage({
  searchParams,
}: {
  searchParams: Promise<{
    mode?: string;
    check?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const mode = sp.mode === 'create' ? 'create' : 'update';
  const me = await getMe();
  const can = (p: string) => me.permissions.includes(p);
  if (
    !can('people.import.run') ||
    !can(mode === 'update' ? 'people.employee.edit' : 'people.employee.create')
  )
    notFound();
  const [catalogue, recent, check] = await Promise.all([
    apiFetch<EmployeeCatalogue>('/people/staff/catalogue'),
    apiFetch<{ data: BulkListRow[] }>('/people/staff/bulk').then((r) => r.data),
    sp.check && /^\d{1,18}$/.test(sp.check)
      ? apiFetch<BulkSummary>(`/people/staff/bulk/${sp.check}`).catch(() => null)
      : Promise.resolve(null),
  ]);
  const editable = catalogue.fields.filter((f) => !f.readOnly && f.key !== 'employee_code');
  const tab = (m: 'update' | 'create', label: string) => (
    <a
      className="ep-tabs__tab"
      role="tab"
      aria-selected={mode === m}
      href={`/people/employees/bulk?mode=${m}`}
    >
      {label}
    </a>
  );
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'People', href: '/people/employees' },
          { label: 'Employees', href: '/people/employees' },
          { label: 'Excel upload' },
        ]}
      />
      <PageHeader
        kicker="People"
        title="Employees from Excel"
        description="Update many employees at once by employee code, or add new staff in bulk. Nothing is saved until you check the file and apply it."
        actions={
          <a
            className="ep-btn ep-btn--secondary"
            href="/people/employees/new"
            style={{ whiteSpace: 'nowrap' }}
          >
            <Icon name="userPlus" size={16} /> Onboard one employee
          </a>
        }
      />
      <div className="ep-tabs" style={{ marginBottom: 'var(--sp-4)' }}>
        <div role="tablist" aria-label="Upload type" className="ep-tabs__list">
          {tab('update', 'Update existing employees')}
          {tab('create', 'Add new employees')}
        </div>
      </div>
      <Notice params={sp} />
      <div className="ep-grid-cards">
        <Card title="1. Download the template">
          <form
            method="get"
            action="/api/employees-bulk/template"
            style={{ display: 'grid', gap: 'var(--sp-3)' }}
          >
            <input type="hidden" name="mode" value={mode} />
            {mode === 'update' ? (
              <label className="ep-check">
                <input type="checkbox" className="ep-check__input" name="includeInactive" />
                <span className="ep-check__box" aria-hidden="true" />
                <span className="ep-check__text">
                  Include employees who have left (the file comes pre-filled with the current
                  details, one row per employee code)
                </span>
              </label>
            ) : (
              <p className="ep-field__help" style={{ margin: 0 }}>
                One row per new employee. The columns marked * are needed; leave Employee Code empty
                to give the next number. Create staff login is Yes unless you type No.
              </p>
            )}
            <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
              <legend className="ep-field__label">Columns</legend>
              <p className="ep-field__help" style={{ marginTop: 0 }}>
                Tick only what you want to change; leave everything unticked to include every field.
              </p>
              {catalogue.sections.map((s) => {
                const fields = editable.filter((f) => f.section === s.id);
                if (!fields.length) return null;
                return (
                  <details key={s.id} style={{ marginBottom: 'var(--sp-2)' }}>
                    <summary>
                      {s.title} <span className="ep-field__help">({fields.length})</span>
                    </summary>
                    <div className="ep-profile__grid" style={{ marginTop: 'var(--sp-2)' }}>
                      {fields.map((f) => (
                        <label key={f.key} className="ep-check">
                          <input
                            type="checkbox"
                            className="ep-check__input"
                            name="field"
                            value={f.key}
                          />
                          <span className="ep-check__box" aria-hidden="true" />
                          <span className="ep-check__text">{f.label}</span>
                        </label>
                      ))}
                    </div>
                  </details>
                );
              })}
            </fieldset>
            <div>
              <button type="submit" className="ep-btn ep-btn--primary">
                <Icon name="download" size={16} /> Download template
              </button>
            </div>
          </form>
        </Card>
        <Card title="2. Upload the filled file">
          <form action={employeeBulkValidate} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            <input type="hidden" name="mode" value={mode} />
            <label className="ep-field" htmlFor="bulk-file">
              <span className="ep-field__label">Excel or CSV file</span>
              <input
                id="bulk-file"
                name="file"
                type="file"
                className="ep-input"
                accept=".xlsx,.csv"
                required
              />
              <span className="ep-field__help">
                A blank cell means no change. Type CLEAR to empty a field. Up to 5,000 rows and 4
                MB.
              </span>
            </label>
            <div>
              <button type="submit" className="ep-btn ep-btn--primary">
                Check the file
              </button>
            </div>
          </form>
        </Card>
      </div>

      {check ? (
        <Card
          title={`3. Check: ${check.fileName ?? 'upload'}`}
          style={{ marginTop: 'var(--sp-5)' }}
        >
          <div
            style={{
              display: 'flex',
              gap: 'var(--sp-2)',
              flexWrap: 'wrap',
              marginBottom: 'var(--sp-3)',
            }}
          >
            <Badge tone="info">{check.totalRows} rows in the file</Badge>
            <Badge tone="success">{check.readyRows} ready</Badge>
            <Badge tone="neutral">{check.unchangedRows} unchanged</Badge>
            <Badge tone={check.rejectedRows ? 'danger' : 'neutral'}>
              {check.rejectedRows} with errors
            </Badge>
            {check.status === 'committed' ? (
              <Badge tone="success">{check.applied} applied</Badge>
            ) : null}
          </div>
          {check.status === 'validated' && check.readyRows > 0 ? (
            <div
              style={{
                marginBottom: 'var(--sp-4)',
                display: 'flex',
                gap: 'var(--sp-2)',
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <ConfirmAction
                action={employeeBulkCommit}
                fields={{ id: check.id, mode: check.mode }}
                label={`Apply ${String(check.readyRows)} row${check.readyRows === 1 ? '' : 's'}`}
                variant="primary"
                title={`Apply ${String(check.readyRows)} row${check.readyRows === 1 ? '' : 's'}?`}
                confirmLabel="Apply"
              >
                <p>
                  {check.mode === 'update'
                    ? 'The changes listed below are saved to the employee profiles and recorded in the audit log.'
                    : 'The new employees are added with the posting of the year and, where asked, a staff login; all recorded in the audit log.'}{' '}
                  Rows with errors are skipped; fix them and upload again.
                </p>
              </ConfirmAction>
              <span className="ep-field__help">Rows with errors are not applied.</span>
            </div>
          ) : null}
          {check.status === 'committed' ? (
            <p>
              Applied on {new Date(check.committedAt ?? '').toLocaleString('en-IN')}.{' '}
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/api/employees-bulk/${check.id}/result`}
              >
                <Icon name="download" size={16} /> Result file
              </a>
            </p>
          ) : null}
          {check.problems.length ? (
            <>
              <h3 className="ep-card__title">Errors ({check.problems.length})</h3>
              <div className="ep-table-wrap" tabIndex={0}>
                <table className="ep-table">
                  <thead>
                    <tr>
                      <th scope="col">Row</th>
                      <th scope="col">Employee code</th>
                      <th scope="col">Column</th>
                      <th scope="col">Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {check.problems.slice(0, 300).map((p, i) => (
                      <tr key={`${String(p.row)}-${String(i)}`}>
                        <td>{p.row}</td>
                        <td>{p.code ?? ''}</td>
                        <td>{p.column}</td>
                        <td>{p.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
          {check.preview.length ? (
            <>
              <h3 className="ep-card__title" style={{ marginTop: 'var(--sp-4)' }}>
                {check.mode === 'update' ? 'Changes' : 'New employees'} ({check.readyRows})
              </h3>
              <div className="ep-table-wrap" tabIndex={0}>
                <table className="ep-table">
                  <thead>
                    <tr>
                      <th scope="col">Row</th>
                      <th scope="col">Employee code</th>
                      <th scope="col">Employee</th>
                      <th scope="col">{check.mode === 'update' ? 'Old → new' : 'Details'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {check.preview.map((p) => (
                      <tr key={p.row}>
                        <td>{p.row}</td>
                        <td>{p.code}</td>
                        <td>{p.name}</td>
                        <td>
                          <ul style={{ margin: 0, paddingLeft: 'var(--sp-3)' }}>
                            {p.changes.map((c) => (
                              <li key={c.field}>
                                {c.field}:{' '}
                                {check.mode === 'update' ? (
                                  <>
                                    {show(c.from)} →{' '}
                                    <strong>{c.to === null ? '(cleared)' : show(c.to)}</strong>
                                  </>
                                ) : (
                                  <strong>{show(c.to)}</strong>
                                )}
                              </li>
                            ))}
                            {p.login !== null ? (
                              <li>Staff login: {p.login ? 'Yes' : 'No'}</li>
                            ) : null}
                          </ul>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {check.readyRows > check.preview.length ? (
                <p className="ep-field__help">
                  Showing the first {check.preview.length}; the result file lists every row.
                </p>
              ) : null}
            </>
          ) : null}
        </Card>
      ) : null}

      <Card title="Recent uploads" style={{ marginTop: 'var(--sp-5)' }}>
        {recent.length ? (
          <div className="ep-table-wrap" tabIndex={0}>
            <table className="ep-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Type</th>
                  <th scope="col">File</th>
                  <th scope="col">Rows</th>
                  <th scope="col">Status</th>
                  <th scope="col">By</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.createdAt).toLocaleString('en-IN')}</td>
                    <td>{r.mode === 'update' ? 'Update' : 'New employees'}</td>
                    <td>
                      <a href={`/people/employees/bulk?mode=${r.mode}&check=${r.id}`}>
                        {r.fileName ?? `Upload ${r.id}`}
                      </a>
                    </td>
                    <td>
                      {r.readyRows} ready · {r.rejectedRows} errors
                    </td>
                    <td>
                      <Badge tone={r.status === 'committed' ? 'success' : 'info'}>
                        {r.status === 'committed' ? `applied ${String(r.applied)}` : 'checked'}
                      </Badge>
                    </td>
                    <td>{r.requestedBy ?? ''}</td>
                    <td>
                      <a
                        className="ep-btn ep-btn--ghost ep-btn--sm"
                        href={`/api/employees-bulk/${r.id}/result`}
                        aria-label={`Download the result of upload ${r.id}`}
                      >
                        <Icon name="download" size={16} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="ep-field__help">No uploads yet.</p>
        )}
      </Card>
    </>
  );
}
