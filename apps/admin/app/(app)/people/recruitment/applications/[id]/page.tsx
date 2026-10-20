import { Badge, Breadcrumbs, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch } from '@/lib/api';
import {
  APP_EVENT,
  APP_STATUS,
  APP_TONE,
  RESULT_WORD,
  dmy,
  type ApplicationView,
  type JoinPreview,
} from '@/lib/recruitment';
import {
  joinCandidate,
  recordStage,
  rejectApplication,
  resumeApplication,
} from '@/lib/recruitment-actions';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
/** An ISO time as the value of a datetime-local input, in India time. */
const localValue = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 330 * 60_000);
  return d.toISOString().slice(0, 16);
};

/**
 * One application (docs/design/34-recruitment.md, part 3): the stages of its vacancy with what happened at
 * each, the stage the candidate is at (schedule it, then record marks and the result), the form as
 * submitted with the documents, and the steps.
 */
export default async function ApplicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const a = await apiFetch<ApplicationView>(`/people/recruitment/applications/${id}`).catch(
    (e: unknown) => {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) notFound();
      throw e;
    },
  );
  const current = a.stages.find((s) => s.current);
  const join = a.can.join
    ? await apiFetch<JoinPreview>(`/people/recruitment/applications/${id}/join`).catch(() => null)
    : null;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee management', href: '/people/employees' },
          { label: 'Candidates', href: `/people/recruitment/candidates?vacancy=${a.vacancy.id}` },
          { label: a.name },
        ]}
      />
      <PageHeader
        kicker={`Application ${a.number}`}
        title={a.name}
        description={`${a.vacancy.title} (${a.vacancy.code}) · applied ${dmy(a.submittedAt)}${a.source === 'office' ? ' · added by the office' : ''}`}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            <span className="ep-field__help">Application PDF</span>
            <FileLinks
              href={`/api/recruitment-application-pdf/${a.id}`}
              label={`application ${a.number} (PDF)`}
            />
            <a className="ep-btn ep-btn--ghost" href={`/people/recruitment/${a.vacancy.id}`}>
              The vacancy
            </a>
          </span>
        }
      />
      <Notice params={sp} />
      {a.employeeMatch.length ? (
        <p className="ep-alert ep-alert--warning" role="status">
          Same mobile or email as an employee:{' '}
          {a.employeeMatch.map((m, i) => (
            <span key={m.id}>
              {i ? ', ' : ''}
              <a href={`/people/employees/${m.id}`}>
                {m.name} ({m.code})
              </a>
            </span>
          ))}
          . Check before going on (a rejoining, or the same person applying twice).
        </p>
      ) : null}

      {a.employee ? (
        <p className="ep-alert ep-alert--success" role="status">
          Joined the staff as{' '}
          <a href={`/people/employees/${a.employee.id}`}>
            {a.employee.name} ({a.employee.code})
          </a>
          {a.joinedAt ? ` on ${dmy(a.joinedAt)}` : ''}.
        </p>
      ) : null}
      {join ? (
        <section className="ep-card ep-acr-card" aria-labelledby="ap-join-h">
          <h2 id="ap-join-h" className="ep-card__title">
            Move to the employee master
          </h2>
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            Made through the employee master’s own onboarding and its checks. Carries over:{' '}
            {join.copies.fields.join(', ')}; {join.copies.education} qualifications,{' '}
            {join.copies.experience} jobs, {join.copies.training} trainings. Stays on this
            application: {join.stays.join('; ')}.
          </p>
          {join.matches.length ? (
            <p className="ep-alert ep-alert--warning" role="status">
              Already on the staff with the same details:{' '}
              {join.matches.map((m, i) => (
                <span key={m.id}>
                  {i ? '; ' : ''}
                  <a href={`/people/employees/${m.id}`}>
                    {m.name} ({m.code})
                  </a>{' '}
                  ({m.why.join(', ')})
                </span>
              ))}
              . Go on only if this is a different person or a rejoining.
            </p>
          ) : null}
          <form action={joinCandidate}>
            <input type="hidden" name="id" value={a.id} />
            <div className="ep-acr-filter">
              <label className="ep-field" htmlFor="jn-code" style={{ margin: 0 }}>
                <span className="ep-field__label">Employee code</span>
                <input
                  id="jn-code"
                  name="employeeCode"
                  className="ep-input"
                  maxLength={30}
                  placeholder={join.nextCode}
                />
                <span className="ep-field__help">Empty: {join.nextCode}</span>
              </label>
              <label className="ep-field" htmlFor="jn-on" style={{ margin: 0 }}>
                <span className="ep-field__label">Date of joining *</span>
                <input
                  id="jn-on"
                  name="joinedOn"
                  type="date"
                  className="ep-input"
                  required
                  defaultValue={today}
                />
              </label>
              {(
                [
                  ['department', 'Department *', join.lists.departments, join.defaults.department],
                  [
                    'designation',
                    'Designation *',
                    join.lists.designations,
                    join.defaults.designation,
                  ],
                  [
                    'employeeType',
                    'Employee type *',
                    join.lists.employeeTypes,
                    join.defaults.employeeType,
                  ],
                  ['natureOfAppointment', 'Nature of appointment', join.lists.natures, null],
                ] as const
              ).map(([name, label, options, value]) => (
                <label key={name} className="ep-field" htmlFor={`jn-${name}`} style={{ margin: 0 }}>
                  <span className="ep-field__label">{label}</span>
                  <select
                    id={`jn-${name}`}
                    name={name}
                    className="ep-select"
                    defaultValue={value ?? ''}
                    required={label.endsWith('*')}
                  >
                    <option value="">—</option>
                    {options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {join.documents.length ? (
              <div className="ep-table-wrap" style={{ marginTop: 'var(--sp-3)' }}>
                <table className="ep-table ep-table--dense">
                  <caption className="ep-field__label" style={{ textAlign: 'left' }}>
                    Documents to copy to the employee record
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Uploaded as</th>
                      <th scope="col">View</th>
                      <th scope="col">Becomes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {join.documents.map((d) => (
                      <tr key={d.id}>
                        <td>{d.label}</td>
                        <td>
                          <FileLinks
                            href={`/api/recruitment-file/${a.id}/${d.fileId}`}
                            label={d.label}
                            viewOnly
                          />
                        </td>
                        <td>
                          <select
                            name={`doc.${d.id}`}
                            className="ep-select"
                            aria-label={`${d.label} becomes`}
                            defaultValue={d.suggestedTypeId ?? ''}
                          >
                            <option value="">Do not copy</option>
                            {join.documentTypes.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <div style={{ display: 'grid', gap: 'var(--sp-2)', margin: 'var(--sp-3) 0' }}>
              <label className="ep-check" htmlFor="jn-login">
                <input
                  id="jn-login"
                  type="checkbox"
                  name="createLogin"
                  value="yes"
                  defaultChecked
                />{' '}
                Make a staff login (they sign in with a code to their mobile or email)
              </label>
              {join.matches.length ? (
                <label className="ep-check" htmlFor="jn-confirm">
                  <input id="jn-confirm" type="checkbox" name="confirmMatch" value="yes" required />{' '}
                  I have checked: this is a different person, or a rejoining that needs a new record
                </label>
              ) : null}
            </div>
            <button type="submit" className="ep-btn ep-btn--primary">
              Make the employee record
            </button>
          </form>
        </section>
      ) : null}
      <section className="ep-card ep-acr-card" aria-labelledby="ap-stages-h">
        <h2 id="ap-stages-h" className="ep-card__title">
          <Badge tone={APP_TONE[a.status] as 'neutral'}>{APP_STATUS[a.status]}</Badge>{' '}
          <span className="ep-field__help">
            {current ? `At ${current.name}` : a.decisionNote ? a.decisionNote : ''}
          </span>
        </h2>
        <ol className="ep-stepbar" aria-label="Screening stages">
          {a.stages.map((s, i) => (
            <li key={s.id}>
              <span className="ep-stepbar__item" aria-current={s.current ? 'step' : undefined}>
                <span className="ep-stepbar__n" aria-hidden="true">
                  {i + 1}
                </span>
                <span>
                  <span className="ep-stepbar__label">{s.name}</span>
                  <br />
                  <span className="ep-field__help">
                    {s.result
                      ? `${RESULT_WORD[s.result]}${s.marks !== null ? ` · ${String(s.marks)}${s.maxMarks ? `/${String(s.maxMarks)}` : ''}` : ''}`
                      : s.scheduledAt
                        ? when(s.scheduledAt)
                        : s.current
                          ? 'Now'
                          : 'Not yet'}
                  </span>
                </span>
              </span>
            </li>
          ))}
        </ol>
        {a.stages
          .filter((s) => s.result || s.scheduledAt || s.remarks)
          .map((s) => (
            <div key={s.id} className="ep-acr-note" style={{ marginBottom: 'var(--sp-2)' }}>
              <strong>{s.name}</strong>
              {s.scheduledAt ? ` · ${when(s.scheduledAt)}` : ''}
              {s.venue ? ` · ${s.venue}` : ''}
              {s.panel ? ` · panel: ${s.panel}` : ''}
              {s.result ? ` · ${RESULT_WORD[s.result]}` : ''}
              {s.marks !== null
                ? ` · marks ${String(s.marks)}${s.maxMarks ? ` of ${String(s.maxMarks)}` : ''}`
                : ''}
              {s.remarks ? <div className="ep-field__help">{s.remarks}</div> : null}
              {s.recordedBy && s.recordedAt ? (
                <div className="ep-field__help">
                  Recorded by {s.recordedBy}, {when(s.recordedAt)}
                </div>
              ) : null}
            </div>
          ))}
        {a.can.record && current ? (
          <form action={recordStage} style={{ marginTop: 'var(--sp-3)' }}>
            <input type="hidden" name="id" value={a.id} />
            <input type="hidden" name="stageId" value={current.id} />
            <h3 className="ep-field__label">{current.name}: schedule, or record how it went</h3>
            <div className="ep-acr-filter">
              <label className="ep-field" htmlFor="ap-when" style={{ margin: 0 }}>
                <span className="ep-field__label">Date and time</span>
                <input
                  id="ap-when"
                  name="scheduledAt"
                  type="datetime-local"
                  className="ep-input"
                  defaultValue={localValue(current.scheduledAt)}
                />
              </label>
              <label className="ep-field" htmlFor="ap-venue" style={{ margin: 0 }}>
                <span className="ep-field__label">Venue</span>
                <input
                  id="ap-venue"
                  name="venue"
                  className="ep-input"
                  maxLength={200}
                  defaultValue={current.venue ?? ''}
                />
              </label>
              <label className="ep-field" htmlFor="ap-panel" style={{ margin: 0 }}>
                <span className="ep-field__label">Panel</span>
                <input
                  id="ap-panel"
                  name="panel"
                  className="ep-input"
                  maxLength={300}
                  defaultValue={current.panel ?? ''}
                />
              </label>
              {current.maxMarks ? (
                <label className="ep-field" htmlFor="ap-marks" style={{ margin: 0 }}>
                  <span className="ep-field__label">Marks (out of {current.maxMarks})</span>
                  <input
                    id="ap-marks"
                    name="marks"
                    type="number"
                    min={0}
                    max={current.maxMarks}
                    step="0.5"
                    className="ep-input"
                    defaultValue={current.marks ?? ''}
                  />
                </label>
              ) : null}
              <label className="ep-field" htmlFor="ap-result" style={{ margin: 0 }}>
                <span className="ep-field__label">Result</span>
                <select id="ap-result" name="result" className="ep-select" defaultValue="">
                  <option value="">Not yet (save the schedule)</option>
                  <option value="pass">
                    {a.stages[a.stages.length - 1]?.id === current.id
                      ? 'Passed: select'
                      : 'Passed: to the next stage'}
                  </option>
                  <option value="hold">On hold</option>
                  <option value="fail">Not through: do not take forward</option>
                </select>
              </label>
            </div>
            <label className="ep-field" htmlFor="ap-remarks">
              <span className="ep-field__label">Remarks</span>
              <textarea
                id="ap-remarks"
                name="remarks"
                className="ep-input"
                rows={2}
                maxLength={1000}
              />
            </label>
            <button type="submit" className="ep-btn ep-btn--primary">
              Save
            </button>
          </form>
        ) : null}
        <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
          {a.can.resume ? (
            <form action={resumeApplication}>
              <input type="hidden" name="id" value={a.id} />
              <button type="submit" className="ep-btn ep-btn--secondary">
                Take up again
              </button>
            </form>
          ) : null}
          {a.can.reject ? (
            <ConfirmAction
              action={rejectApplication}
              fields={{ id: a.id }}
              label="Do not take forward"
              variant="ghost"
              title="Do not take this application forward?"
              confirmLabel="Do not take forward"
              reason={{ label: 'Why (kept on the application)' }}
            >
              The candidate is told when the school sends this notice (Recruitment set-up →
              Notices).
            </ConfirmAction>
          ) : null}
        </div>
      </section>

      <div className="ep-grid-2">
        {a.sections.map((s) => (
          <section key={s.title} className="ep-card ep-acr-card" aria-label={s.title}>
            <h2 className="ep-card__title">{s.title}</h2>
            <dl className="ep-hero__facts">
              {s.fields.map((f) => (
                <div key={f.key}>
                  <dt>{f.label}</dt>
                  <dd>{f.type === 'date' ? dmy(f.value) : f.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      {a.rows.map((r) => (
        <section key={r.kind} className="ep-card ep-acr-card" aria-label={r.title}>
          <h2 className="ep-card__title">{r.title}</h2>
          <div className="ep-table-wrap">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">{r.title}</caption>
              <thead>
                <tr>
                  {r.columns.map((c) => (
                    <th key={c.key} scope="col">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.rows.map((row, i) => (
                  <tr key={i}>
                    {r.columns.map((c) => (
                      <td key={c.key}>
                        {row[c.key]
                          ? /^\d{4}-\d{2}-\d{2}$/.test(row[c.key]!)
                            ? dmy(row[c.key])
                            : row[c.key]
                          : '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <div className="ep-grid-2">
        <section className="ep-card ep-acr-card" aria-labelledby="ap-docs-h">
          <h2 id="ap-docs-h" className="ep-card__title">
            Photos and documents
          </h2>
          {a.documents.length ? (
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'grid',
                gap: 'var(--sp-2)',
              }}
            >
              {a.documents.map((d) => (
                <li
                  key={d.id}
                  style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}
                >
                  <span style={{ minWidth: '12rem' }}>{d.label}</span>
                  <FileLinks href={`/api/recruitment-file/${a.id}/${d.fileId}`} label={d.label} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="ep-field__help" style={{ margin: 0 }}>
              None uploaded{a.source === 'office' ? ' (added by the office)' : ''}.
            </p>
          )}
          {a.activities.length ? (
            <>
              <h3 className="ep-field__label">Interests</h3>
              <p>{a.activities.join(', ')}</p>
            </>
          ) : null}
        </section>
        <section className="ep-card ep-acr-card" aria-labelledby="ap-steps-h">
          <h2 id="ap-steps-h" className="ep-card__title">
            Steps
          </h2>
          <ol>
            {a.events.map((e, i) => (
              <li key={i}>
                <strong>{APP_EVENT[e.what] ?? e.what}</strong> · {when(e.at)}
                {e.by_name ? ` · ${e.by_name}` : ''}
                {e.note ? <div className="ep-field__help">{e.note}</div> : null}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}
