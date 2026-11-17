import { Badge, Breadcrumbs, Button, Card, PageHeader, SelectField } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { IssuePicker } from '@/components/certificates/IssuePicker';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import {
  correctCertificate,
  issueCertificate,
  reissueCertificate,
} from '@/lib/certificate-actions';
import {
  FIELD_PREFIX,
  PERSON_PREFIX,
  fitPaper,
  personFrom,
  type CertificateDetail,
  type CertificatePreview,
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
  // the fields typed so far travel in the address (Update the preview) and go to the API as they are
  const fields: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(sp)) {
    const key = k.slice(FIELD_PREFIX.length);
    if (k.startsWith(FIELD_PREFIX) && typeof v === 'string' && /^[a-zA-Z]{2,30}$/.test(key)) {
      const spec = type?.fields.find((f) => f.key === key);
      fields[key] = spec?.kind === 'number' && /^\d{1,4}$/.test(v.trim()) ? Number(v.trim()) : v;
    }
  }
  // the person's details as typed in their boxes (per_<path>): printed on this certificate only
  const person = personFrom(Object.entries(sp));
  const purpose = (sp.purpose ?? '').slice(0, 200);
  const issuedOn = /^\d{4}-\d{2}-\d{2}$/.test(sp.issuedOn ?? '') ? sp.issuedOn! : '';
  const variant = id(sp.variant);
  // answering a request (phase C): it travels with the form and the issue marks it issued
  const requestId = id(sp.request ?? sp.requestId);
  // re-issue with changes (16 Nov 2026): the certificate being corrected; the type and person stay its own
  // or a correction keeping the number (the school's set-up says so): revision n+1 of the same certificate
  const correctId = id(sp.correct);
  const reissueId = correctId ? '' : id(sp.reissue);
  const editId = correctId || reissueId;
  const original = editId
    ? await apiFetch<CertificateDetail>(`/certificates/${editId}`).catch(() => null)
    : null;
  const reissueBlocked = !original
    ? editId
      ? 'That certificate was not found'
      : null
    : correctId
      ? original.copyNo
        ? 'Correct the original certificate; duplicates printed after it carry the correction'
        : original.status !== 'issued'
          ? 'A cancelled certificate is not corrected'
          : !original.correctionsKeepNumber
            ? 'This school gives a corrected certificate a new number: use Re-issue with changes'
            : null
      : original.copyNo
        ? 'Re-issue the original certificate; its duplicates go with it'
        : original.reissuedAs
          ? `Already re-issued as ${original.reissuedAs.number}`
          : null;
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
          person,
          ...(original && !reissueBlocked ? { reissueOf: original.id } : {}),
        }),
      });
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      previewError = e.problem.detail ?? e.problem.type;
    }
  const failed = preview?.checks.filter((x) => !x.ok) ?? [];
  const correcting = !!correctId && !!original && !reissueBlocked;
  // a correction: the certificate was issued; its checks are shown, not a bar
  const blocked =
    !correcting && !!preview && (preview.held || (failed.length > 0 && !preview.can.override));
  // a check not clear keeps What it prints and the preview back for everyone (17 Nov 2026); whoever may issue past a
  // check opens them with "Issue it anyway" (?anyway=1), to give the reason
  const canAnyway = !!preview && !preview.held && failed.length > 0 && preview.can.override;
  const anyway = sp.anyway === '1' && canAnyway;
  const notClear = !correcting && !!preview && (preview.held || failed.length > 0);
  const holdBack = notClear && !anyway;
  const asksPurpose = type ? type.code !== 'TC' : false;
  const who = staff ? 'employee' : 'student';
  const reissuing = !!original && !reissueBlocked && !correcting;
  const editing = reissuing || correcting;
  // this page as it is, for coming back after a refusal or a fresh sign-in
  const here = `/certificates/issue?${new URLSearchParams(
    Object.entries(sp).filter(
      (e): e is [string, string] =>
        typeof e[1] === 'string' && !['ok', 'error', 'detail'].includes(e[0]),
    ),
  ).toString()}`;
  // the same page with What it prints opened past a check, or kept back again
  const keepBackHref = `/certificates/issue?${new URLSearchParams(
    Object.entries(sp).filter(
      (e): e is [string, string] =>
        typeof e[1] === 'string' && !['ok', 'error', 'detail', 'anyway'].includes(e[0]),
    ),
  ).toString()}`;
  const anywayHref = `${keepBackHref}&anyway=1#what-it-prints`;
  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Certificate register', href: '/certificates' }, { label: 'Issue' }]}
      />
      <PageHeader
        kicker="Certificates"
        title={
          correcting
            ? `Correct ${original!.number}`
            : reissuing
              ? `Re-issue ${original!.number} with changes`
              : 'Issue a certificate'
        }
        description={
          correcting
            ? `Correct what is wrong — the purpose, the details typed at issue, the date or the layout; the person's details, the signatory and the layout print as they are now. It keeps its number and becomes revision ${String(original!.revision + 1)}; the earlier paper stays in its change log.`
            : reissuing
              ? 'Correct what is wrong — the purpose, the details typed at issue, the date or the layout — look at the paper, then re-issue. It gets a new number; the earlier one is cancelled in the same step.'
              : "Choose the type and the person, look at the checks and the paper, then issue. The number is the type's next for the year and is never given again."
        }
      />
      <Notice params={sp} />
      {reissueBlocked ? (
        <div className="ep-alert ep-alert--danger" role="alert">
          {reissueBlocked}.{' '}
          {original ? <a href={`/certificates/${original.id}`}>Back to {original.number}</a> : null}
        </div>
      ) : correcting ? (
        <div className="ep-alert ep-alert--info" role="status">
          Correcting <a href={`/certificates/${original!.id}`}>{original!.number}</a>: the same
          number, revision {String(original!.revision + 1)}. Its paper prints &ldquo;Revision{' '}
          {String(original!.revision + 1)} · corrected on …&rdquo; and its QR check says so.
        </div>
      ) : reissuing ? (
        <div className="ep-alert ep-alert--info" role="status">
          Re-issuing <a href={`/certificates/${original!.id}`}>{original!.number}</a>
          {original!.status === 'issued'
            ? ': it is cancelled when the new one is issued, and each points to the other.'
            : ' (cancelled): the new one points to it.'}
        </div>
      ) : null}
      {requestId ? (
        <div className="ep-alert ep-alert--info" role="status">
          Answering <a href={`/certificates/requests/${requestId}`}>request {requestId}</a>: issuing
          it marks the request issued and tells the requester in the app.
        </div>
      ) : null}
      <div className="ep-cert-issue">
        <Card>
          <h2 className="ep-card__title">1. Certificate and {staff ? 'employee' : 'student'}</h2>
          {editing ? (
            <p style={{ margin: 0 }}>
              <strong>{type?.name ?? original!.typeName}</strong> · {original!.studentName} ·{' '}
              {original!.admissionNo}
              <span className="ep-field__help" style={{ display: 'block' }}>
                The certificate and the person stay as they were; to change them, cancel it and
                issue a new one.
              </span>
            </p>
          ) : (
            <IssuePicker
              key={type?.code ?? ''}
              types={types.map((t) => ({
                code: t.code,
                name: t.name,
                staff: t.audience === 'STAFF',
              }))}
              type={type?.code ?? ''}
              person={
                preview && personId
                  ? {
                      id: personId,
                      name: preview.person.name,
                      no: preview.person.no,
                      detail: null,
                      left: false,
                    }
                  : null
              }
              keep={requestId ? { request: requestId } : {}}
            />
          )}
          {type ? (
            <p className="ep-field__help">
              <strong>{type.name}</strong> checks: {rulesText(type)}.
              {type.restricted ? ' Issued only by the roles set on the type.' : ''}
            </p>
          ) : null}
        </Card>
        {reissueBlocked ? null : !type || !personId ? (
          <Card>
            <p className="ep-field__help" style={{ margin: 0 }}>
              {!type
                ? 'Choose the certificate, then the person.'
                : `Choose the ${who} from the list.`}
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
              ) : failed.length && !correcting ? (
                <div className="ep-alert ep-alert--warning" role="status">
                  <div>
                    <p style={{ margin: 0 }}>
                      <strong>Not clear yet.</strong>{' '}
                      {anyway
                        ? 'You are issuing it although a check is not clear: give the reason below; it is kept on the certificate with your name.'
                        : canAnyway
                          ? 'What it prints and the preview show once the checks above are clear. You may issue it anyway, with a reason.'
                          : 'What it prints and the preview show once the checks above are clear — or the principal may issue it anyway, with a reason.'}
                    </p>
                    {type.code === 'TC' && !staff ? (
                      <p style={{ margin: 'var(--sp-2) 0 0' }}>
                        {preview.withdrawal ? (
                          <>
                            Next:{' '}
                            <a href={`/people/withdrawals/${preview.withdrawal.id}`}>
                              open the withdrawal
                            </a>{' '}
                            — its departments clear the fees, library, hostel and transport, and it
                            takes the student off the rolls when it is complete.
                          </>
                        ) : (
                          <>
                            Next:{' '}
                            <a href={`/people/students/${studentId}?tab=status`}>
                              start the withdrawal on the student&apos;s page
                            </a>{' '}
                            (Status) — the TC is issued once it is complete.
                          </>
                        )}
                      </p>
                    ) : null}
                    {canAnyway ? (
                      <p style={{ margin: 'var(--sp-3) 0 0' }}>
                        {anyway ? (
                          <a className="ep-btn ep-btn--ghost ep-btn--sm" href={keepBackHref}>
                            Keep it back until the checks are clear
                          </a>
                        ) : (
                          <a className="ep-btn ep-btn--secondary ep-btn--sm" href={anywayHref}>
                            Issue it anyway, with a reason
                          </a>
                        )}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </Card>
            {holdBack ? null : (
              <>
                <Card>
                  <h2 className="ep-card__title" id="what-it-prints">
                    3. What it prints
                  </h2>
                  <form
                    action={
                      correcting
                        ? correctCertificate
                        : reissuing
                          ? reissueCertificate
                          : issueCertificate
                    }
                    className="ep-cert-form"
                  >
                    <input type="hidden" name="type" value={type.code} />
                    {anyway ? <input type="hidden" name="anyway" value="1" /> : null}
                    {editing ? (
                      <>
                        <input type="hidden" name="id" value={original!.id} />
                        <input
                          type="hidden"
                          name={correcting ? 'correct' : 'reissue'}
                          value={original!.id}
                        />
                        <input type="hidden" name="changes" value="1" />
                        <input type="hidden" name="returnTo" value={here} />
                      </>
                    ) : null}
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
                      {preview.personDetails?.length ? (
                        <div className="ep-cert-person" style={{ gridColumn: '1 / -1' }}>
                          <h3 className="ep-ctype__sub">
                            From the {staff ? "employee's" : "student's"} record
                          </h3>
                          <p className="ep-field__help" style={{ margin: 0 }}>
                            What this layout prints about the {who}, filled from the record. Change
                            any of them for this certificate: the record stays as it is, and the
                            certificate keeps both.
                            {staff ? '' : ' The admission number prints from the record.'}
                          </p>
                        </div>
                      ) : null}
                      {(preview.personDetails ?? []).map((d) => {
                        const pid = `${PERSON_PREFIX}${d.path}`;
                        return (
                          <label key={d.path} className="ep-field" htmlFor={pid}>
                            <span className="ep-field__label">{d.label}</span>
                            <input
                              id={pid}
                              name={pid}
                              className="ep-input"
                              type={d.kind === 'date' ? 'date' : 'text'}
                              maxLength={d.kind === 'text' ? 300 : undefined}
                              defaultValue={d.value}
                              required={d.path === 'student.name' || d.path === 'employee.name'}
                            />
                            {d.changed ? (
                              <span className="ep-field__help ep-cert-person__changed">
                                Changed for this certificate · the record:{' '}
                                {d.record ? <strong>{d.record}</strong> : 'none'}
                              </span>
                            ) : d.path === 'student.dobWords' ? (
                              <span className="ep-field__help">
                                Follows the date of birth unless typed
                              </span>
                            ) : null}
                          </label>
                        );
                      })}
                      {preview.personDetails?.length && preview.fields.length ? (
                        <h3 className="ep-ctype__sub" style={{ gridColumn: '1 / -1', margin: 0 }}>
                          {type.name}: the details for this certificate
                        </h3>
                      ) : null}
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
                    {editing ? (
                      <label className="ep-field" htmlFor="reason">
                        <span className="ep-field__label">
                          {correcting ? 'Why it is corrected *' : 'Why it is re-issued *'}
                        </span>
                        <textarea
                          id="reason"
                          name="reason"
                          className="ep-input"
                          rows={2}
                          minLength={3}
                          maxLength={250}
                          required
                          placeholder="e.g. the purpose was typed wrong"
                        />
                        <span className="ep-field__help">
                          {correcting
                            ? `Recorded in the change log of ${original!.number}, with what changed.`
                            : `Recorded on ${original!.number} as the reason it was cancelled.`}
                        </span>
                      </label>
                    ) : null}
                    <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                      <Button type="submit" disabled={blocked}>
                        {correcting
                          ? `Save as revision ${String(original!.revision + 1)}`
                          : reissuing
                            ? 'Re-issue with these changes'
                            : `Issue ${type.name.toLowerCase()}`}
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
            )}
          </>
        ) : null}
      </div>
    </>
  );
}
