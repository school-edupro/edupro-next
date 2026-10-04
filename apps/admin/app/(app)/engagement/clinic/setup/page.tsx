import { Alert, Badge, Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { CheckupFormSetup } from '@/components/clinic/CheckupFormSetup';
import { ClinicNav } from '@/components/clinic/ClinicNav';
import { MessageTemplates } from '@/components/MessageTemplates';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import { importClinicSetup, saveClinicEntry } from '@/lib/clinic-actions';
import {
  MEDICINE_FORMS,
  SETUP_TITLE,
  type ClinicSetup,
  type SetupKind,
  type SetupRow,
} from '@/lib/clinic';

const KINDS: SetupKind[] = ['doctor', 'nurse', 'disease', 'medicine', 'clinic'];
type Tab = SetupKind | 'form' | 'messages';
interface List {
  data: SetupRow[];
  page: { number: number; size: number; total: number };
}

/**
 * Clinic set-up (admin). Each list (doctors, nurses, diseases, medicines, clinics) has search, pages,
 * Excel and PDF, an upload from Excel with a sample file, and its add / edit form. The check-up form and
 * the message templates have their own tabs.
 */
export default async function ClinicSetupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const tab: Tab = [...KINDS, 'form', 'messages'].includes(sp.tab as Tab)
    ? (sp.tab as Tab)
    : 'doctor';
  const isList = KINDS.includes(tab as SetupKind);
  const kind = tab as SetupKind;
  const q = sp.q?.trim().slice(0, 80) ?? '';
  const status = ['active', 'inactive'].includes(sp.status ?? '') ? sp.status! : '';
  const page = Math.max(1, Number(sp.page) || 1);
  const size = ['10', '25', '50'].includes(sp.size ?? '') ? sp.size! : '10';
  const filters: Record<string, string> = {
    ...(q ? { q } : {}),
    ...(status ? { status } : {}),
    ...(size === '10' ? {} : { size }),
  };
  const qs = (extra: Record<string, string> = {}) =>
    new URLSearchParams({ tab, ...filters, ...extra }).toString();
  const [me, setup, list] = await Promise.all([
    getMe(),
    apiFetch<ClinicSetup>('/clinic/setup'),
    isList
      ? apiFetch<List>(
          `/clinic/setup/list?${new URLSearchParams({ kind, ...(q ? { q } : {}), ...(status ? { status } : {}), size, page: String(page) }).toString()}`,
        )
      : null,
  ]);
  const editing = isList && sp.edit ? (list!.data.find((x) => x.id === sp.edit) ?? null) : null;
  const adding = isList && (sp.add === '1' || Boolean(editing));
  const pages = list ? Math.max(1, Math.ceil(list.page.total / list.page.size)) : 1;
  const person = kind === 'doctor' || kind === 'nurse';
  const medicine = kind === 'medicine';
  const title = isList ? SETUP_TITLE[kind] : null;
  const exportHref = (format: 'xlsx' | 'pdf') =>
    `/api/clinic/setup-export?${new URLSearchParams({ kind, format, ...(q ? { q } : {}), ...(status ? { status } : {}) }).toString()}`;
  return (
    <>
      <PageHeader
        kicker="Clinic"
        title="Set-up"
        description="What the clinic's forms pick from. School Doctor and School Nurse are roles you give under Access."
      />
      <ClinicNav current="/engagement/clinic/setup" permissions={me.permissions} ok={sp.ok} />
      {sp.ok === 'imported' ? (
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <Alert tone={Number(sp.failed) ? 'warning' : 'success'}>
            Excel read: {sp.added ?? '0'} added, {sp.updated ?? '0'} updated
            {Number(sp.failed) ? `, ${sp.failed!} row(s) not taken` : ''}.
            {sp.bad ? ` ${sp.bad}` : ''}
          </Alert>
        </div>
      ) : null}
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      <nav
        className="ep-tabs-links"
        aria-label="Set-up sections"
        style={{ marginBottom: 'var(--sp-3)' }}
      >
        {(
          [
            ...KINDS.map((k) => [k, SETUP_TITLE[k][0]] as [Tab, string]),
            ['form', 'Check-up form and card'],
            ['messages', 'Message templates'],
          ] as Array<[Tab, string]>
        ).map(([k, label]) => (
          <a key={k} href={`?tab=${k}`} aria-current={tab === k ? 'page' : undefined}>
            {label}
          </a>
        ))}
      </nav>
      {tab === 'form' ? <CheckupFormSetup initial={setup} /> : null}
      {tab === 'messages' ? (
        <MessageTemplates
          templates={setup.templates}
          search="clinic"
          builtInEmail="Built-in design"
        />
      ) : null}
      {isList && list && title ? (
        <>
          {adding ? (
            <Card
              title={editing ? `Edit ${editing.name}` : `Add a ${title[1]}`}
              style={{ marginBottom: 'var(--sp-4)' }}
            >
              <form action={saveClinicEntry} className="ep-hd__form">
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="id" value={editing?.id ?? ''} />
                <div className="ep-hd__row">
                  <label className="ep-field" htmlFor="ce-name">
                    <span className="ep-field__label">Name</span>
                    <input
                      id="ce-name"
                      name="name"
                      className="ep-input"
                      required
                      minLength={2}
                      maxLength={120}
                      defaultValue={editing?.name ?? ''}
                    />
                  </label>
                  {person ? (
                    <>
                      <label className="ep-field" htmlFor="ce-qual">
                        <span className="ep-field__label">Qualification</span>
                        <input
                          id="ce-qual"
                          name="qualification"
                          className="ep-input"
                          maxLength={120}
                          defaultValue={editing?.qualification ?? ''}
                        />
                      </label>
                      <label className="ep-field" htmlFor="ce-reg">
                        <span className="ep-field__label">Registration no.</span>
                        <input
                          id="ce-reg"
                          name="regNo"
                          className="ep-input"
                          maxLength={60}
                          defaultValue={editing?.regNo ?? ''}
                        />
                      </label>
                      <label className="ep-field" htmlFor="ce-mob">
                        <span className="ep-field__label">Mobile</span>
                        <input
                          id="ce-mob"
                          name="mobile"
                          className="ep-input"
                          inputMode="numeric"
                          pattern="[6-9][0-9]{9}"
                          maxLength={10}
                          defaultValue={editing?.mobile ?? ''}
                        />
                      </label>
                      <SelectField
                        id="ce-emp"
                        name="employeeId"
                        label="Employee record (if on the staff)"
                        defaultValue={editing?.employeeId ?? ''}
                        options={[
                          { value: '', label: 'Not an employee / visiting' },
                          ...setup.staff.map((s) => ({ value: s.id, label: s.name })),
                        ]}
                      />
                    </>
                  ) : null}
                  {medicine ? (
                    <>
                      <SelectField
                        id="ce-form"
                        name="form"
                        label="Form"
                        defaultValue={editing?.form ?? 'Tablet'}
                        options={[...new Set([...MEDICINE_FORMS, editing?.form ?? 'Tablet'])].map(
                          (f) => ({ value: f, label: f }),
                        )}
                      />
                      <label className="ep-field" htmlFor="ce-strength">
                        <span className="ep-field__label">Strength (500 mg, 5 ml)</span>
                        <input
                          id="ce-strength"
                          name="strength"
                          className="ep-input"
                          maxLength={40}
                          defaultValue={editing?.strength ?? ''}
                        />
                      </label>
                      <label className="ep-field" htmlFor="ce-unit">
                        <span className="ep-field__label">Counted in (tablet, ml, piece)</span>
                        <input
                          id="ce-unit"
                          name="unit"
                          className="ep-input"
                          required
                          maxLength={20}
                          defaultValue={editing?.unit ?? 'tablet'}
                        />
                      </label>
                      <label className="ep-field" htmlFor="ce-low">
                        <span className="ep-field__label">Low-stock mark</span>
                        <input
                          id="ce-low"
                          name="lowStockAt"
                          type="number"
                          className="ep-input"
                          min={0}
                          max={100000}
                          defaultValue={editing?.lowStockAt ?? 10}
                        />
                      </label>
                    </>
                  ) : null}
                  {!person && !medicine ? (
                    <label className="ep-field" htmlFor="ce-note">
                      <span className="ep-field__label">Note</span>
                      <input
                        id="ce-note"
                        name="note"
                        className="ep-input"
                        maxLength={300}
                        defaultValue={editing?.note ?? ''}
                      />
                    </label>
                  ) : null}
                  <label className="ep-check" htmlFor="ce-active">
                    <input
                      id="ce-active"
                      name="active"
                      type="checkbox"
                      defaultChecked={editing ? editing.active : true}
                    />{' '}
                    In use
                  </label>
                </div>
                <div className="ep-gate__act">
                  <Button type="submit">{editing ? 'Save' : 'Add'}</Button>
                  <a className="ep-btn ep-btn--secondary" href={`?${qs({ page: String(page) })}`}>
                    Cancel
                  </a>
                </div>
              </form>
            </Card>
          ) : null}
          <div className="ep-filter-band">
            <form method="get" className="ep-dlog__filters">
              <input type="hidden" name="tab" value={tab} />
              <InputField
                id="cs-q"
                name="q"
                type="search"
                label={`Search ${title[0].toLowerCase()}`}
                defaultValue={q}
                maxLength={80}
              />
              <SelectField
                id="cs-status"
                name="status"
                label="Status"
                defaultValue={status}
                options={[
                  { value: '', label: 'All' },
                  { value: 'active', label: 'In use' },
                  { value: 'inactive', label: 'Not in use' },
                ]}
              />
              <SelectField
                id="cs-size"
                name="size"
                label="Rows per page"
                defaultValue={size}
                options={['10', '25', '50'].map((v) => ({ value: v, label: v }))}
              />
              <Button type="submit">Show</Button>
              {q || status ? (
                <a className="ep-btn ep-btn--secondary" href={`?tab=${tab}`}>
                  Clear
                </a>
              ) : null}
            </form>
          </div>
          <Card
            title={`${title[0]} · ${String(list.page.total)}`}
            actions={
              <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                <a className="ep-btn ep-btn--primary ep-btn--sm" href={`?${qs({ add: '1' })}`}>
                  Add
                </a>
                <a className="ep-btn ep-btn--secondary ep-btn--sm" href={exportHref('xlsx')}>
                  Excel
                </a>
                <a className="ep-btn ep-btn--secondary ep-btn--sm" href={exportHref('pdf')}>
                  PDF
                </a>
              </span>
            }
          >
            <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={title[0]}>
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">{title[0]}</caption>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Name</th>
                    {person ? <th scope="col">Qualification · registration</th> : null}
                    {person ? <th scope="col">Mobile</th> : null}
                    {medicine ? <th scope="col">Form</th> : null}
                    {medicine ? <th scope="col">Counted in</th> : null}
                    {medicine ? (
                      <th scope="col" className="ep-num">
                        In stock
                      </th>
                    ) : null}
                    {medicine ? (
                      <th scope="col" className="ep-num">
                        Low-stock mark
                      </th>
                    ) : null}
                    {!person && !medicine ? <th scope="col">Note</th> : null}
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="ep-sr-only">Edit</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.length === 0 ? (
                    <tr>
                      <td colSpan={8}>
                        {q || status
                          ? 'Nothing matches these filters.'
                          : 'Nothing here yet. Use Add, or upload an Excel below.'}
                      </td>
                    </tr>
                  ) : null}
                  {list.data.map((x, i) => (
                    <tr key={x.id}>
                      <td>{(page - 1) * list.page.size + i + 1}</td>
                      <th scope="row">
                        {x.name}
                        {x.strength ? ` ${x.strength}` : ''}
                        {x.employee ? <div className="ep-field__help">{x.employee}</div> : null}
                      </th>
                      {person ? (
                        <td>{[x.qualification, x.regNo].filter(Boolean).join(' · ') || '—'}</td>
                      ) : null}
                      {person ? <td>{x.mobile ?? '—'}</td> : null}
                      {medicine ? <td>{x.form}</td> : null}
                      {medicine ? <td>{x.unit}</td> : null}
                      {medicine ? <td className="ep-num">{x.stock}</td> : null}
                      {medicine ? <td className="ep-num">{x.lowStockAt}</td> : null}
                      {!person && !medicine ? <td>{x.note ?? '—'}</td> : null}
                      <td>
                        <Badge tone={x.active ? 'success' : 'neutral'}>
                          {x.active ? 'In use' : 'Not in use'}
                        </Badge>
                      </td>
                      <td>
                        <a
                          className="ep-btn ep-btn--secondary ep-btn--sm"
                          href={`?${qs({ page: String(page), edit: x.id })}`}
                          aria-label={`Edit ${x.name}`}
                        >
                          Edit
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pages > 1 ? (
              <nav
                aria-label="Pages"
                style={{
                  display: 'flex',
                  gap: 'var(--sp-3)',
                  alignItems: 'center',
                  marginTop: 'var(--sp-3)',
                }}
              >
                {page > 1 ? (
                  <a
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    href={`?${qs({ page: String(page - 1) })}`}
                  >
                    ← Previous
                  </a>
                ) : null}
                <span className="ep-field__help">
                  Page {page} of {pages}
                </span>
                {page < pages ? (
                  <a
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    href={`?${qs({ page: String(page + 1) })}`}
                  >
                    Next →
                  </a>
                ) : null}
              </nav>
            ) : null}
          </Card>
          <Card
            title={`Upload ${title[0].toLowerCase()} from Excel`}
            style={{ marginTop: 'var(--sp-4)' }}
          >
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              Download the sample, fill a row for each {title[1]}, and upload it. A name that is
              already on the list is updated, not added twice. Rows that cannot be read are listed
              after the upload.
            </p>
            <form action={importClinicSetup} className="ep-gate__act">
              <input type="hidden" name="kind" value={kind} />
              <label className="ep-field" htmlFor="cu-file">
                <span className="ep-field__label">Excel file (.xlsx)</span>
                <input
                  id="cu-file"
                  name="file"
                  type="file"
                  className="ep-input"
                  required
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                />
              </label>
              <Button type="submit">Upload</Button>
              <a className="ep-btn ep-btn--secondary" href={`/api/clinic/sample?kind=${kind}`}>
                Download the sample
              </a>
            </form>
          </Card>
        </>
      ) : null}
    </>
  );
}
