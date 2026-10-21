import { Badge, Breadcrumbs } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch } from '@/lib/api';
import {
  APP_EVENT,
  APP_STATUS,
  APP_TONE,
  CORRECTION_STEPS,
  RESULT_WORD,
  dmy,
  type ApplicationView,
  type JoinPreview,
} from '@/lib/recruitment';
import {
  cancelCorrection,
  joinCandidate,
  moveStage,
  recordStage,
  rejectApplication,
  resumeApplication,
  sendBackApplication,
  undoDecision,
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
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
const STAGE_TONE = {
  pass: 'success',
  fail: 'danger',
  hold: 'warning',
  skipped: 'neutral',
} as const;
/** A date (YYYY-MM-DD) some days on. */
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The lists given (qualifications, jobs, trainings, children, references), a table each. */
function listCards(lists: ApplicationView['rows']) {
  return lists.map((r) => (
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
  ));
}

const TABS = [
  ['screening', 'Screening'],
  ['application', 'Application'],
  ['education', 'Education and experience'],
  ['documents', 'Documents'],
  ['history', 'History'],
] as const;
type Tab = (typeof TABS)[number][0];

/**
 * One application (docs/design/34-recruitment.md, parts 3, 4 and 8), laid out as the employee page: the
 * candidate at the top (photo, status, the post, the facts that matter, contact, the PDF), the stages as a
 * stepper, then tabs: screening (the stage at hand, putting a mistake right, sending it back for
 * correction, moving to the employee master), the application as submitted, education and experience, the
 * documents and the history.
 */
export default async function ApplicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; ok?: string; error?: string; detail?: string }>;
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
  const tab: Tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as Tab) : 'screening';
  const current = a.stages.find((s) => s.current);
  const curIdx = a.stages.findIndex((s) => s.current);
  /** the last stage with a result, where an application no longer moving stopped */
  const stoppedAt = [...a.stages].reverse().find((s) => s.result && s.result !== 'skipped');
  const join =
    a.can.join && tab === 'screening'
      ? await apiFetch<JoinPreview>(`/people/recruitment/applications/${id}/join`).catch(() => null)
      : null;
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const field = (key: string) => {
    for (const s of a.sections) {
      const f = s.fields.find((x) => x.key === key);
      if (f) return f.value;
    }
    return null;
  };
  const dob = field('dob');
  const age = dob
    ? Math.floor((Date.parse(today) - Date.parse(dob)) / (365.25 * 86_400_000))
    : null;
  const education = a.rows.find((r) => r.kind === 'education')?.rows ?? [];
  const years = field('total_exp_years');
  const months = field('total_exp_months');
  const facts: Array<[string, string | null]> = [
    [
      'Stage',
      a.status === 'returned'
        ? 'With the candidate'
        : current
          ? current.name
          : stoppedAt
            ? `${stoppedAt.name} (${RESULT_WORD[stoppedAt.result!].toLowerCase()})`
            : APP_STATUS[a.status],
    ],
    ['Date of birth', dob ? `${dmy(dob)}${age !== null ? ` (${String(age)} yrs)` : ''}` : null],
    ['Gender', field('gender')],
    ['Highest qualification', education[0]?.qualification ?? null],
    [
      'Experience',
      years || months
        ? [years ? `${years} yrs` : null, months ? `${months} months` : null]
            .filter(Boolean)
            .join(' ')
        : null,
    ],
    ['Present pay (a month)', field('current_total') ? `₹${field('current_total')!}` : null],
    ['Can join', field('notice_period')],
    ['Marital status', field('marital_status')],
  ];
  const mobile = field('mobile');
  const email = field('email');
  const r = a.corrections;
  const counts: Partial<Record<Tab, number>> = {
    education: a.rows
      .filter((x) => x.kind !== 'children' && x.kind !== 'references')
      .reduce((n, x) => n + x.rows.length, 0),
    documents: a.documents.length,
    history: a.events.length,
  };
  const overdue = a.correction && a.status === 'returned' ? a.correction.dueOn < today : false;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Employee management', href: '/people/employees' },
          { label: 'Candidates', href: `/people/recruitment/candidates?vacancy=${a.vacancy.id}` },
          { label: a.name },
        ]}
      />
      <Notice params={sp} />
      <section className="ep-hero" aria-label="Candidate summary">
        <div className="ep-hero__photo">
          {a.photoFileId ? (
            <img
              src={`/api/recruitment-file/${a.id}/${a.photoFileId}`}
              alt={`Photo of ${a.name}`}
            />
          ) : (
            <span className="ep-hero__initials" aria-hidden="true">
              {initials(a.name)}
            </span>
          )}
        </div>
        <div className="ep-hero__main">
          <div className="ep-hero__title">
            <h1>{a.name}</h1>
            <Badge tone={APP_TONE[a.status] as 'neutral'}>{APP_STATUS[a.status]}</Badge>
            <Badge tone="neutral">{a.source === 'office' ? 'Walk-in' : 'Online'}</Badge>
            {a.correction?.resentAt && a.status !== 'returned' && !a.correction.cancelledAt ? (
              <Badge tone="info">Corrected {dmy(a.correction.resentAt)}</Badge>
            ) : null}
          </div>
          <p className="ep-hero__line">
            Application <strong>{a.number}</strong> ·{' '}
            <a href={`/people/recruitment/${a.vacancy.id}`}>{a.vacancy.title}</a> ({a.vacancy.code})
            · applied {dmy(a.submittedAt)}
          </p>
          <dl className="ep-hero__facts">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v ?? '—'}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="ep-hero__side">
          <dl className="ep-hero__facts ep-app-contact" aria-label="Contact">
            <div>
              <dt>Mobile</dt>
              <dd>{mobile ? <a href={`tel:${mobile}`}>{mobile}</a> : '—'}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{email ? <a href={`mailto:${email}`}>{email}</a> : '—'}</dd>
            </div>
            <div>
              <dt>Received</dt>
              <dd>
                {when(a.submittedAt)}
                {a.source === 'office' ? ' (by the office)' : ''}
              </dd>
            </div>
          </dl>
          <div className="ep-hero__actions" style={{ alignItems: 'center' }}>
            <span className="ep-field__help">Application PDF</span>
            <FileLinks
              href={`/api/recruitment-application-pdf/${a.id}`}
              label={`application ${a.number} (PDF)`}
            />
          </div>
          <div className="ep-hero__actions">
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/people/recruitment/${a.vacancy.id}`}
            >
              The vacancy
            </a>
            <a
              className="ep-btn ep-btn--ghost ep-btn--sm"
              href={`/people/recruitment/candidates?vacancy=${a.vacancy.id}`}
            >
              All candidates
            </a>
          </div>
        </div>
      </section>

      {a.employeeMatch.length ? (
        <p className="ep-alert ep-alert--warning" role="status">
          <span>
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
          </span>
        </p>
      ) : null}
      {a.employee ? (
        <p className="ep-alert ep-alert--success" role="status">
          <span>
            Joined the staff as{' '}
            <a href={`/people/employees/${a.employee.id}`}>
              {a.employee.name} ({a.employee.code})
            </a>
            {a.joinedAt ? ` on ${dmy(a.joinedAt)}` : ''}.
          </span>
        </p>
      ) : null}
      {a.status === 'returned' && a.correction ? (
        <div
          className={`ep-alert ep-alert--${overdue ? 'danger' : 'warning'} ep-app-correction`}
          role="status"
        >
          <div>
            <strong>
              With the candidate for correction{overdue ? ': the date has passed' : ''}
            </strong>
            <p style={{ margin: 'var(--sp-1) 0 0' }}>
              {a.correction.partsText} · “{a.correction.remark}” · correct by{' '}
              {dmy(a.correction.dueOn)} · asked by {a.correction.byName ?? 'the office'} on{' '}
              {dmy(a.correction.at)}
            </p>
          </div>
          {r.cancelCorrection ? (
            <ConfirmAction
              action={cancelCorrection}
              fields={{ id: a.id, act: 'cancel' }}
              label="Take the request back"
              variant="secondary"
              title="Take back the request for a correction?"
              confirmLabel="Take it back"
            >
              The application goes on as it was, at the stage it was at. The candidate can no longer
              send a correction.
            </ConfirmAction>
          ) : null}
        </div>
      ) : a.correction?.resentAt && !a.correction.cancelledAt ? (
        <p className="ep-alert ep-alert--info" role="status">
          <span>
            Corrected by the candidate on {dmy(a.correction.resentAt)}:{' '}
            {a.correction.changed?.length
              ? `changed ${a.correction.changed.join(', ')}`
              : 'no change'}
            .
          </span>
        </p>
      ) : null}

      <ol className="ep-stepbar ep-app-stages" aria-label="Screening stages">
        {a.stages.map((s, i) => (
          <li key={s.id}>
            <span
              className={`ep-stepbar__item ep-app-stage ep-app-stage--${s.result ?? (s.current ? 'now' : 'next')}`}
              aria-current={s.current ? 'step' : undefined}
            >
              <span className="ep-stepbar__n" aria-hidden="true">
                {s.result === 'pass' ? '✓' : i + 1}
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

      <nav
        className="ep-tabs"
        aria-label="Application sections"
        style={{ marginBottom: 'var(--sp-4)' }}
      >
        <div className="ep-tabs__list">
          {TABS.map(([k, label]) => (
            <a
              key={k}
              className="ep-tabs__tab"
              href={`/people/recruitment/applications/${a.id}${k === 'screening' ? '' : `?tab=${k}`}`}
              aria-current={tab === k ? 'page' : undefined}
            >
              {label}
              {counts[k] ? (
                <span className="ep-badge ep-badge--neutral" style={{ marginLeft: 'var(--sp-1)' }}>
                  {counts[k]}
                </span>
              ) : null}
            </a>
          ))}
        </div>
      </nav>

      {tab === 'screening' ? (
        <>
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
                      [
                        'department',
                        'Department *',
                        join.lists.departments,
                        join.defaults.department,
                      ],
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
                    <label
                      key={name}
                      className="ep-field"
                      htmlFor={`jn-${name}`}
                      style={{ margin: 0 }}
                    >
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
                      <input
                        id="jn-confirm"
                        type="checkbox"
                        name="confirmMatch"
                        value="yes"
                        required
                      />{' '}
                      I have checked: this is a different person, or a rejoining that needs a new
                      record
                    </label>
                  ) : null}
                </div>
                <button type="submit" className="ep-btn ep-btn--primary">
                  Make the employee record
                </button>
              </form>
            </section>
          ) : null}
          <div className="ep-app-layout">
            <div>
              <section className="ep-card ep-acr-card" aria-labelledby="ap-now-h">
                <h2 id="ap-now-h" className="ep-card__title">
                  {current ? `Now: ${current.name}` : 'Screening'}
                </h2>
                {!current ? (
                  <p className="ep-field__help" style={{ marginTop: 0 }}>
                    {a.status === 'returned'
                      ? 'Screening waits until the candidate sends the correction, or the request is taken back.'
                      : a.status === 'selected'
                        ? 'Selected. Move the candidate to the employee master when they join.'
                        : a.status === 'joined'
                          ? 'Joined the staff.'
                          : a.status === 'rejected'
                            ? `Not taken forward${stoppedAt ? ` at ${stoppedAt.name}` : ''}${a.decisionNote ? `: ${a.decisionNote}` : ''}. Undo it under “Put a mistake right” if this was a mistake.`
                            : a.status === 'withdrawn'
                              ? 'Withdrawn by the candidate.'
                              : APP_STATUS[a.status]}
                  </p>
                ) : null}
                {a.can.record && current ? (
                  <form action={recordStage} style={{ marginTop: 'var(--sp-3)' }}>
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="stageId" value={current.id} />
                    <h3 className="ep-field__label">
                      {current.name}: schedule, or record how it went
                    </h3>
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
                {a.can.resume || a.can.reject ? (
                  <div className="ep-hero__actions" style={{ marginTop: 'var(--sp-3)' }}>
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
                        fields={{ id: a.id, act: 'reject' }}
                        label="Do not take forward"
                        variant="ghost"
                        title="Do not take this application forward?"
                        confirmLabel="Do not take forward"
                        reason={{ label: 'Why (kept on the application)' }}
                      >
                        The candidate is told when the school sends this notice (Recruitment set-up
                        → Notices). A mistake can be undone afterwards.
                      </ConfirmAction>
                    ) : null}
                  </div>
                ) : null}
              </section>
              {a.stages.some((s) => s.result || s.scheduledAt || s.remarks) ? (
                <section className="ep-card ep-acr-card" aria-labelledby="ap-notes-h">
                  <h2 id="ap-notes-h" className="ep-card__title">
                    What each stage found
                  </h2>
                  {a.stages
                    .filter((s) => s.result || s.scheduledAt || s.remarks)
                    .map((s) => (
                      <div key={s.id} className="ep-acr-note">
                        <div className="ep-hero__title" style={{ gap: 'var(--sp-2)' }}>
                          <strong>{s.name}</strong>
                          {s.result ? (
                            <Badge tone={STAGE_TONE[s.result]}>{RESULT_WORD[s.result]}</Badge>
                          ) : null}
                        </div>
                        <div className="ep-field__help">
                          {[
                            s.scheduledAt ? when(s.scheduledAt) : null,
                            s.venue,
                            s.panel ? `panel: ${s.panel}` : null,
                            s.marks !== null
                              ? `marks ${String(s.marks)}${s.maxMarks ? ` of ${String(s.maxMarks)}` : ''}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                        {s.remarks ? (
                          <p style={{ margin: 'var(--sp-1) 0 0' }}>{s.remarks}</p>
                        ) : null}
                        {s.recordedBy && s.recordedAt ? (
                          <div className="ep-field__help">
                            Recorded by {s.recordedBy}, {when(s.recordedAt)}
                          </div>
                        ) : null}
                      </div>
                    ))}
                </section>
              ) : null}
            </div>

            <div>
              <section className="ep-card ep-acr-card" aria-labelledby="ap-fix-h">
                <h2 id="ap-fix-h" className="ep-card__title">
                  Put a mistake right
                </h2>
                {r.last ? (
                  <div className="ep-acr-note" style={{ marginTop: 0 }}>
                    <div className="ep-field__help">Last decision</div>
                    <strong>{r.last.label}</strong>
                    <div className="ep-field__help">
                      {when(r.last.at)}
                      {r.last.by ? ` · ${r.last.by}` : ''}
                    </div>
                    {r.undo ? (
                      <div style={{ marginTop: 'var(--sp-2)' }}>
                        <ConfirmAction
                          action={undoDecision}
                          fields={{ id: a.id, act: 'undo' }}
                          label="Undo this decision"
                          variant="secondary"
                          title="Undo the last decision?"
                          confirmLabel="Undo"
                          reason={{ label: 'Why (kept in the history)' }}
                        >
                          The application goes back to where it was before “{r.last.label}”. The
                          decision stays in the history, marked undone.
                        </ConfirmAction>
                      </div>
                    ) : (
                      <p className="ep-field__help" style={{ margin: 'var(--sp-2) 0 0' }}>
                        Undo is open to the people named in Recruitment set-up, within {r.undoHours}{' '}
                        hours of the decision for the one who made it.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="ep-field__help" style={{ marginTop: 0 }}>
                    No decision yet to undo.
                  </p>
                )}
                {r.move ? (
                  <form action={moveStage} style={{ marginTop: 'var(--sp-4)' }}>
                    <input type="hidden" name="id" value={a.id} />
                    <h3 className="ep-field__label" style={{ marginTop: 0 }}>
                      Change the stage
                    </h3>
                    <p className="ep-field__help" style={{ marginTop: 0 }}>
                      Forward skips the stages between (marked “skipped”); back opens the stage
                      again.
                    </p>
                    <label className="ep-field" htmlFor="mv-stage">
                      <span className="ep-field__label">Move to *</span>
                      <select
                        id="mv-stage"
                        name="stageId"
                        className="ep-select"
                        required
                        defaultValue=""
                      >
                        <option value="">Choose a stage</option>
                        {a.stages.map((s, i) =>
                          s.current ? null : (
                            <option key={s.id} value={s.id}>
                              {s.name}
                              {curIdx < 0
                                ? ''
                                : i > curIdx
                                  ? i - curIdx > 1
                                    ? ` (ahead, skips ${String(i - curIdx - 1)})`
                                    : ' (next)'
                                  : ' (back)'}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <label className="ep-field" htmlFor="mv-reason">
                      <span className="ep-field__label">Why *</span>
                      <textarea
                        id="mv-reason"
                        name="reason"
                        className="ep-input"
                        rows={2}
                        minLength={3}
                        maxLength={500}
                        required
                      />
                    </label>
                    <button type="submit" className="ep-btn ep-btn--secondary">
                      Move
                    </button>
                  </form>
                ) : null}
              </section>

              {r.sendBack ? (
                <section className="ep-card ep-acr-card" aria-labelledby="ap-back-h">
                  <h2 id="ap-back-h" className="ep-card__title">
                    {a.status === 'returned' ? 'Change the request' : 'Send back for correction'}
                  </h2>
                  <p className="ep-field__help" style={{ marginTop: 0 }}>
                    The candidate gets an email with your remark and a link; they can change only
                    the parts you tick. Screening waits until it comes back.
                  </p>
                  <form action={sendBackApplication}>
                    <input type="hidden" name="id" value={a.id} />
                    <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
                      <legend className="ep-field__label">Parts to correct *</legend>
                      <div className="ep-app-parts">
                        {CORRECTION_STEPS.map(([k, label]) => (
                          <label key={k} className="ep-check" htmlFor={`sb-${k}`}>
                            <input id={`sb-${k}`} type="checkbox" name="steps" value={k} /> {label}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <label className="ep-field" htmlFor="sb-remark">
                      <span className="ep-field__label">What to correct * (goes in the email)</span>
                      <textarea
                        id="sb-remark"
                        name="remark"
                        className="ep-input"
                        rows={3}
                        minLength={3}
                        maxLength={1000}
                        required
                        placeholder="For example: the B.Ed. marksheet is not readable; upload a clear copy."
                      />
                    </label>
                    <label className="ep-field" htmlFor="sb-due">
                      <span className="ep-field__label">Correct by *</span>
                      <input
                        id="sb-due"
                        name="dueOn"
                        type="date"
                        className="ep-input"
                        required
                        min={addDays(today, 1)}
                        max={addDays(today, 60)}
                        defaultValue={addDays(today, r.correctionDays)}
                      />
                      <span className="ep-field__help">
                        A reminder goes a day before. Default: {r.correctionDays} days (Recruitment
                        set-up).
                      </span>
                    </label>
                    <button type="submit" className="ep-btn ep-btn--primary">
                      Send back with an email
                    </button>
                  </form>
                </section>
              ) : null}
            </div>
          </div>
        </>
      ) : null}

      {tab === 'application' ? (
        <>
          <div className="ep-grid-2">
            {a.sections.map((s) => (
              <section key={s.title} className="ep-card ep-acr-card" aria-label={s.title}>
                <h2 className="ep-card__title">{s.title}</h2>
                <dl className="ep-facts">
                  {s.fields.map((f) => (
                    <div key={f.key}>
                      <dt>{f.label}</dt>
                      <dd>{f.type === 'date' ? dmy(f.value) : f.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
            {a.activities.length ? (
              <section className="ep-card ep-acr-card" aria-labelledby="ap-int-h">
                <h2 id="ap-int-h" className="ep-card__title">
                  Interests
                </h2>
                <p style={{ margin: 0 }}>{a.activities.join(', ')}</p>
              </section>
            ) : null}
          </div>
          {listCards(a.rows.filter((x) => x.kind === 'children' || x.kind === 'references'))}
        </>
      ) : null}

      {tab === 'education'
        ? (() => {
            const lists = a.rows.filter((x) => x.kind !== 'children' && x.kind !== 'references');
            return lists.length ? (
              listCards(lists)
            ) : (
              <p className="ep-field__help">No qualifications, jobs or trainings given.</p>
            );
          })()
        : null}

      {tab === 'documents' ? (
        <section className="ep-card ep-acr-card" aria-labelledby="ap-docs-h">
          <h2 id="ap-docs-h" className="ep-card__title">
            Photos and documents
          </h2>
          <div className="ep-table-wrap">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Photos and documents</caption>
              <thead>
                <tr>
                  <th scope="col">Document</th>
                  <th scope="col">Type</th>
                  <th scope="col">View or download</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>The application (as submitted)</td>
                  <td>PDF</td>
                  <td>
                    <FileLinks
                      href={`/api/recruitment-application-pdf/${a.id}`}
                      label={`application ${a.number} (PDF)`}
                    />
                  </td>
                </tr>
                {a.documents.map((d) => (
                  <tr key={d.id}>
                    <td>{d.label}</td>
                    <td>{d.contentType === 'application/pdf' ? 'PDF' : 'Image'}</td>
                    <td>
                      <FileLinks
                        href={`/api/recruitment-file/${a.id}/${d.fileId}`}
                        label={d.label}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!a.documents.length ? (
            <p className="ep-field__help" style={{ marginBottom: 0 }}>
              No documents uploaded{a.source === 'office' ? ' (added by the office)' : ''}.
            </p>
          ) : null}
        </section>
      ) : null}

      {tab === 'history' ? (
        <section className="ep-card ep-acr-card" aria-labelledby="ap-hist-h">
          <h2 id="ap-hist-h" className="ep-card__title">
            History
          </h2>
          <ol className="ep-app-history">
            {[...a.events].reverse().map((e, i) => (
              <li key={i} className={e.revoked ? 'ep-app-history--revoked' : undefined}>
                <div className="ep-hero__title" style={{ gap: 'var(--sp-2)' }}>
                  <strong>{APP_EVENT[e.what] ?? e.what}</strong>
                  {e.revoked ? <Badge tone="neutral">Undone</Badge> : null}
                </div>
                <div className="ep-field__help">
                  {when(e.at)}
                  {e.by_name ? ` · ${e.by_name}` : ''}
                </div>
                {e.note ? <p style={{ margin: 'var(--sp-1) 0 0' }}>{e.note}</p> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </>
  );
}
