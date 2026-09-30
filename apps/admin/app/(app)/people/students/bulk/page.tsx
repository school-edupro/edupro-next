import { Badge, Breadcrumbs, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { Notice } from '@/components/Notice';
import { studentBulkCommit, studentBulkValidate } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { ProfileCatalogue } from '@/lib/profile';
import { sectionOptions } from '@/lib/sections';

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
  problems: Array<{ row: number; admissionNo?: string; column: string; message: string }>;
  preview: Array<{
    row: number;
    admissionNo: string;
    name: string;
    rollNo: number | null;
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

export default async function StudentBulkPage({
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
    !can(mode === 'update' ? 'people.student.edit' : 'people.student.create')
  )
    notFound();
  const [catalogue, sections, recent, check] = await Promise.all([
    apiFetch<ProfileCatalogue>('/people/profile/catalogue'),
    sectionOptions(),
    apiFetch<{ data: BulkListRow[] }>('/people/profile/bulk').then((r) => r.data),
    sp.check && /^\d{1,18}$/.test(sp.check)
      ? apiFetch<BulkSummary>(`/people/profile/bulk/${sp.check}`).catch(() => null)
      : Promise.resolve(null),
  ]);
  const editable = catalogue.fields.filter((f) => !f.readOnly && f.key !== 'admission_no');
  const tab = (m: 'update' | 'create', label: string) => (
    <a
      className="ep-tabs__tab"
      role="tab"
      aria-selected={mode === m}
      href={`/people/students/bulk?mode=${m}`}
    >
      {label}
    </a>
  );
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'People', href: '/people/students' },
          { label: 'Students', href: '/people/students' },
          { label: 'Bulk update' },
        ]}
      />
      <PageHeader
        kicker="People"
        title="Students from Excel"
        description="Update many students at once by admission number, or add new students in bulk. Nothing is saved until you check the file and apply it."
        actions={
          <a className="ep-btn ep-btn--secondary" href="/people/students/quick-add">
            Quick add one student
          </a>
        }
      />
      <div className="ep-tabs" style={{ marginBottom: 'var(--sp-4)' }}>
        <div role="tablist" aria-label="Upload type" className="ep-tabs__list">
          {tab('update', 'Update existing students')}
          {tab('create', 'Add new students')}
        </div>
      </div>
      <Notice params={sp} />
      <div className="ep-grid-cards">
        <Card title="1. Download the template">
          <form
            method="get"
            action="/api/students-bulk/template"
            style={{ display: 'grid', gap: 'var(--sp-3)' }}
          >
            <input type="hidden" name="mode" value={mode} />
            {mode === 'update' ? (
              <label className="ep-field" htmlFor="bulk-section">
                <span className="ep-field__label">Students of</span>
                <select
                  id="bulk-section"
                  name="classSectionId"
                  className="ep-input"
                  defaultValue=""
                >
                  <option value="">All sections</option>
                  {sections.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <span className="ep-field__help">
                  The file comes pre-filled with their current details, one row per admission
                  number.
                </span>
              </label>
            ) : (
              <p className="ep-field__help" style={{ margin: 0 }}>
                One row per new student. Admission No, Class-Section (e.g. VI-A) and the columns
                marked * are required; the rest can be added later.
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
                        <label
                          key={f.key}
                          style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}
                        >
                          <input type="checkbox" name="field" value={f.key} />
                          {f.label}
                        </label>
                      ))}
                    </div>
                  </details>
                );
              })}
            </fieldset>
            <div>
              <button type="submit" className="ep-btn ep-btn--primary">
                Download template
              </button>
            </div>
          </form>
        </Card>
        <Card title="2. Upload the filled file">
          <form action={studentBulkValidate} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
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
                action={studentBulkCommit}
                fields={{ id: check.id, mode: check.mode }}
                label={`Apply ${String(check.readyRows)} row${check.readyRows === 1 ? '' : 's'}`}
                variant="primary"
                title={`Apply ${String(check.readyRows)} row${check.readyRows === 1 ? '' : 's'}?`}
                confirmLabel="Apply"
              >
                <p>
                  {check.mode === 'update'
                    ? 'The changes listed below are saved to the student profiles and recorded in the audit log.'
                    : 'The new students are created, enrolled in their sections and recorded in the audit log.'}{' '}
                  Rows with errors are skipped; fix them and upload again.
                </p>
              </ConfirmAction>
              <span className="ep-field__help">Rows with errors are not applied.</span>
            </div>
          ) : null}
          {check.status === 'committed' ? (
            <p>
              Applied on {new Date(check.committedAt ?? '').toLocaleString('en-IN')}.{' '}
              <a href={`/api/students-bulk/${check.id}/result`}>Download the result file</a>
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
                      <th scope="col">Admission no</th>
                      <th scope="col">Column</th>
                      <th scope="col">Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {check.problems.slice(0, 300).map((p, i) => (
                      <tr key={`${String(p.row)}-${String(i)}`}>
                        <td>{p.row}</td>
                        <td>{p.admissionNo ?? ''}</td>
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
                {check.mode === 'update' ? 'Changes' : 'New students'} ({check.readyRows})
              </h3>
              <div className="ep-table-wrap" tabIndex={0}>
                <table className="ep-table">
                  <thead>
                    <tr>
                      <th scope="col">Row</th>
                      <th scope="col">Admission no</th>
                      <th scope="col">Student</th>
                      <th scope="col">{check.mode === 'update' ? 'Old → new' : 'Details'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {check.preview.map((p) => (
                      <tr key={p.row}>
                        <td>{p.row}</td>
                        <td>{p.admissionNo}</td>
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
                            {p.rollNo ? <li>Roll no: {p.rollNo}</li> : null}
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
                    <td>{r.mode === 'update' ? 'Update' : 'New students'}</td>
                    <td>
                      <a href={`/people/students/bulk?mode=${r.mode}&check=${r.id}`}>
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
                      <a href={`/api/students-bulk/${r.id}/result`}>Excel</a>
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
