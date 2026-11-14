import { Badge, Breadcrumbs, Button, Card, PageHeader, SelectField } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { issueCertificate } from '@/lib/certificate-actions';
import {
  FIELD_PREFIX,
  fitPaper,
  type CertificateEmployeeHit,
  type CertificatePreview,
  type CertificateStudentHit,
  type CertificateType,
} from '@/lib/certificates';

const STATE: Record<'STUDENT' | 'STAFF', Record<string, string>> = {
  STUDENT: {
    active: 'a student on the rolls',
    leaving: 'the withdrawal complete (or the student has left)',
    any: 'any student, on the rolls or past',
  },
  STAFF: {
    active: 'an employee in service',
    leaving: 'an employee who has left',
    any: 'any employee, in service or past',
  },
};
const MULTIPLE: Record<string, string> = {
  ONE: 'one a person (cancel it, or print a duplicate)',
  YEAR: 'one a person a year',
  ANY: 'as many as needed',
};

/** What a type checks before it is issued, in words. */
const rulesText = (t: CertificateType) =>
  [
    STATE[t.audience][t.rules.state ?? 'any'],
    t.rules.fees ? 'no fees due' : null,
    t.rules.library ? 'library books and dues cleared' : null,
    t.rules.hostel ? 'no hostel bed held' : null,
    t.rules.transport ? 'school transport ended' : null,
    t.rules.classes?.length ? `classes ${t.rules.classes.join(', ')} only` : null,
    MULTIPLE[t.multiple],
  ]
    .filter(Boolean)
    .join('; ');

/**
 * Issue a certificate (docs/design/87): choose the type and the student (or, for a staff certificate, the employee),
 * see the checks and what it prints, choose the layout when the type has more than one, fill the fields it asks for
 * (filled from the record where it holds them), then issue. A failed check stops it; the principal (the override
 * right) may issue it anyway with a reason, which is recorded.
 */
export default async function IssueCertificatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('certificate.register.issue')) notFound();
  const types = await apiFetch<{ rows: CertificateType[] }>('/certificates/types').then((r) =>
    r.rows.filter((t) => t.active),
  );
  const type = types.find((t) => t.code === sp.type) ?? null;
  const staff = type?.audience === 'STAFF';
  const id = (v?: string) => (v && /^\d{1,18}$/.test(v) ? v : '');
  const studentId = staff ? '' : id(sp.student);
  const employeeId = staff ? id(sp.employee) : '';
  const personId = staff ? employeeId : studentId;
  const sq = (sp.sq ?? '').trim().slice(0, 80);
  const hits: Array<CertificateStudentHit | (CertificateEmployeeHit & { admissionNo?: string })> =
    sq.length >= 2
      ? staff
        ? await apiFetch<{ rows: CertificateEmployeeHit[] }>(
            `/certificates/employees?q=${encodeURIComponent(sq)}`,
          ).then((r) => r.rows)
        : await apiFetch<{ rows: CertificateStudentHit[] }>(
            `/certificates/students?q=${encodeURIComponent(sq)}`,
          ).then((r) => r.rows)
      : [];
  // the fields typed so far travel in the address (Update the preview) and go to the API as they are
  const fields: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(sp)) {
    const key = k.slice(FIELD_PREFIX.length);
    if (k.startsWith(FIELD_PREFIX) && typeof v === 'string' && /^[a-zA-Z]{2,30}$/.test(key)) {
      const spec = type?.fields.find((f) => f.key === key);
      fields[key] = spec?.kind === 'number' && /^\d{1,4}$/.test(v.trim()) ? Number(v.trim()) : v;
    }
  }
  const purpose = (sp.purpose ?? '').slice(0, 200);
  const issuedOn = /^\d{4}-\d{2}-\d{2}$/.test(sp.issuedOn ?? '') ? sp.issuedOn! : '';
  const variant = id(sp.variant);
  // answering a request (phase C): it travels with the form and the issue marks it issued
  const requestId = id(sp.request ?? sp.requestId);
  let preview: CertificatePreview | null = null;
  let previewError: string | null = null;
  if (type && personId)
    try {
      preview = await apiFetch<CertificatePreview>('/certificates/preview', {
        method: 'POST',
        body: JSON.stringify({
          typeCode: type.code,
          ...(staff ? { employeeId } : { studentId }),
          ...(variant ? { variant } : {}),
          purpose: purpose || undefined,
          issuedOn: issuedOn || undefined,
          fields,
        }),
      });
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      previewError = e.problem.detail ?? e.problem.type;
    }
  const link = (over: Record<string, string>) => {
    const u = new URLSearchParams();
    if (type) u.set('type', type.code);
    for (const [k, v] of Object.entries(over)) if (v) u.set(k, v);
    return `/certificates/issue?${u.toString()}`;
  };
  const failed = preview?.checks.filter((x) => !x.ok) ?? [];
  const blocked = !!preview && (preview.held || (failed.length > 0 && !preview.can.override));
  const asksPurpose = type ? type.code !== 'TC' : false;
  const who = staff ? 'employee' : 'student';
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Certificate register', href: '/certificates' }, { label: 'Issue' }]}
      />
      <PageHeader
        kicker="Certificates"
        title="Issue a certificate"
        description="Choose the type and the person, look at the checks and the paper, then issue. The number is the type's next for the year and is never given again."
      />
      <Notice params={sp} />
      {requestId ? (
        <div className="ep-alert ep-alert--info" role="status">
          Answering <a href={`/certificates/requests/${requestId}`}>request {requestId}</a>: issuing
          it marks the request issued and tells the requester in the app.
        </div>
      ) : null}
      <div className="ep-cert-issue">
        <Card>
          <h2 className="ep-card__title">1. Type and {staff ? 'employee' : 'student'}</h2>
          <form
            method="get"
            action="/certificates/issue"
            style={{ display: 'grid', gap: 'var(--sp-3)' }}
          >
            <SelectField
              id="type"
              name="type"
              label="Certificate"
              defaultValue={type?.code ?? ''}
              options={[
                { value: '', label: 'Choose…' },
                ...types.map((t) => ({
                  value: t.code,
                  label: `${t.name}${t.audience === 'STAFF' ? ' (staff)' : ''}`,
                })),
              ]}
            />
            {studentId ? <input type="hidden" name="student" value={studentId} /> : null}
            {employeeId ? <input type="hidden" name="employee" value={employeeId} /> : null}
            <label className="ep-field" htmlFor="sq" style={{ margin: 0 }}>
              <span className="ep-field__label">
                Find the {who} ({staff ? 'name or employee code' : 'name or admission no.'})
              </span>
              <input
                id="sq"
                name="sq"
                className="ep-input"
                defaultValue={sq}
                minLength={2}
                maxLength={80}
                autoComplete="off"
              />
            </label>
            <div>
              <Button type="submit" variant="secondary">
                Find
              </Button>
            </div>
          </form>
          {type ? (
            <p className="ep-field__help">
              <strong>{type.name}</strong> checks: {rulesText(type)}.
              {type.restricted ? ' Issued only by the roles set on the type.' : ''}
            </p>
          ) : null}
          {sq.length >= 2 ? (
            hits.length ? (
              <ul
                className="ep-cert-hits"
                aria-label={staff ? 'Employees found' : 'Students found'}
              >
                {hits.map((h) => {
                  const no = 'code' in h ? h.code : h.admissionNo;
                  const detail = 'code' in h ? h.designation : h.className;
                  return (
                    <li key={h.id}>
                      <a
                        href={link(staff ? { employee: h.id } : { student: h.id })}
                        aria-current={h.id === personId ? 'true' : undefined}
                      >
                        <strong>{h.name}</strong> · {no}
                        {detail ? ` · ${detail}` : ''}
                      </a>{' '}
                      {h.left ? <Badge tone="neutral">Left</Badge> : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="ep-field__help">
                No {who} matches “{sq}”.
              </p>
            )
          ) : null}
        </Card>
        {!type || !personId ? (
          <Card>
            <p className="ep-field__help" style={{ margin: 0 }}>
              {!type
                ? 'Choose the certificate, then find the person.'
                : `Find the ${who} and choose them from the list.`}
            </p>
          </Card>
        ) : previewError ? (
          <div className="ep-alert ep-alert--danger" role="alert">
            {previewError}
          </div>
        ) : preview ? (
          <>
            <Card>
              <h2 className="ep-card__title">
                2. Checks for {preview.person.name} · {preview.person.no}
              </h2>
              <ul className="ep-cert-checks">
                {preview.checks.map((x) => (
                  <li key={x.key}>
                    <Badge tone={x.ok ? 'success' : 'danger'}>{x.ok ? 'Clear' : 'Not clear'}</Badge>{' '}
                    <strong>{x.label}</strong>: {x.detail}
                  </li>
                ))}
              </ul>
              {preview.held ? (
                <div className="ep-alert ep-alert--warning" role="status">
                  {preview.person.name} already holds this certificate.{' '}
                  <a
                    href={`/certificates?type=${type.code}&q=${encodeURIComponent(preview.person.no)}`}
                  >
                    Open it
                  </a>{' '}
                  to print a duplicate or cancel it.
                </div>
              ) : failed.length && !preview.can.override ? (
                <div className="ep-alert ep-alert--warning" role="status">
                  A check is not clear: only the principal may issue it anyway. Clear it first, or
                  ask the principal.
                </div>
              ) : null}
            </Card>
            <Card>
              <h2 className="ep-card__title">3. What it prints</h2>
              <form action={issueCertificate} className="ep-cert-form">
                <input type="hidden" name="type" value={type.code} />
                {requestId ? <input type="hidden" name="requestId" value={requestId} /> : null}
                {staff ? (
                  <input type="hidden" name="employee" value={employeeId} />
                ) : (
                  <input type="hidden" name="student" value={studentId} />
                )}
                <div className="ep-cert-fields">
                  {preview.variants.length ? (
                    <SelectField
                      id="variant"
                      name="variant"
                      label="Layout"
                      defaultValue={preview.variant ?? ''}
                      options={preview.variants.map((v) => ({
                        value: v.templateId ?? '',
                        label: v.label,
                      }))}
                    />
                  ) : null}
                  {asksPurpose ? (
                    <label className="ep-field" htmlFor="purpose">
                      <span className="ep-field__label">Purpose (printed)</span>
                      <input
                        id="purpose"
                        name="purpose"
                        className="ep-input"
                        defaultValue={purpose}
                        maxLength={200}
                        placeholder="e.g. opening a bank account"
                      />
                    </label>
                  ) : null}
                  <label className="ep-field" htmlFor="issuedOn">
                    <span className="ep-field__label">Date of issue</span>
                    <input
                      id="issuedOn"
                      name="issuedOn"
                      type="date"
                      className="ep-input"
                      defaultValue={issuedOn}
                    />
                    <span className="ep-field__help">Today when left empty</span>
                  </label>
                  {preview.fields.map((f) => {
                    const fid = `${FIELD_PREFIX}${f.key}`;
                    const value = preview.values[f.key];
                    const v = value === undefined || value === null ? '' : String(value);
                    return f.kind === 'list' ? (
                      <SelectField
                        key={f.key}
                        id={fid}
                        name={fid}
                        label={`${f.label}${f.required ? ' *' : ''}`}
                        defaultValue={v}
                        options={[
                          ...(f.required ? [] : [{ value: '', label: '—' }]),
                          ...(f.options ?? []).map((o) => ({ value: o, label: o })),
                        ]}
                      />
                    ) : (
                      <label key={f.key} className="ep-field" htmlFor={fid}>
                        <span className="ep-field__label">
                          {f.label}
                          {f.required ? ' *' : ''}
                        </span>
                        {f.kind === 'number' ? (
                          <input type="hidden" name={`num_${f.key}`} value="1" />
                        ) : null}
                        <input
                          id={fid}
                          name={fid}
                          className="ep-input"
                          type={
                            f.kind === 'date' ? 'date' : f.kind === 'number' ? 'number' : 'text'
                          }
                          min={f.kind === 'number' ? 0 : undefined}
                          max={f.kind === 'number' ? 9999 : undefined}
                          maxLength={f.kind === 'text' ? 500 : undefined}
                          defaultValue={v}
                          required={f.required}
                        />
                        {f.hint ? <span className="ep-field__help">{f.hint}</span> : null}
                      </label>
                    );
                  })}
                </div>
                {preview.problems.length ? (
                  <div className="ep-alert ep-alert--warning" role="status">
                    {preview.problems.join('; ')}
                  </div>
                ) : null}
                {failed.length && preview.can.override && !preview.held ? (
                  <label className="ep-field" htmlFor="overrideReason">
                    <span className="ep-field__label">
                      Why it is issued although{' '}
                      {failed.map((x) => x.label.toLowerCase()).join(', ')}{' '}
                      {failed.length === 1 ? 'is' : 'are'} not clear *
                    </span>
                    <textarea
                      id="overrideReason"
                      name="overrideReason"
                      className="ep-input"
                      rows={2}
                      minLength={10}
                      maxLength={300}
                      required
                    />
                    <span className="ep-field__help">
                      Recorded on the certificate with your name; it shows in the register.
                    </span>
                  </label>
                ) : null}
                <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                  <Button type="submit" disabled={blocked}>
                    Issue {type.name.toLowerCase()}
                  </Button>
                  <button
                    type="submit"
                    className="ep-btn ep-btn--secondary"
                    formAction="/certificates/issue"
                    formMethod="get"
                    formNoValidate
                  >
                    Update the preview
                  </button>
                </div>
              </form>
            </Card>
            <Card>
              <h2 className="ep-card__title">Preview</h2>
              <p className="ep-field__help" style={{ marginTop: 0 }}>
                The number shows as “(next)” until it is issued.
              </p>
              {preview.html ? (
                <iframe
                  title={`Preview of the ${type.name.toLowerCase()}`}
                  className="ep-cert-preview"
                  sandbox=""
                  srcDoc={fitPaper(preview.html)}
                />
              ) : (
                <p className="ep-field__help">This type has no template yet.</p>
              )}
            </Card>
          </>
        ) : null}
      </div>
    </>
  );
}
