'use client';
import { useMemo, useState, type ReactNode } from 'react';

/**
 * One employee ACR as the API gives it (people/acr/reports/:id, docs/design/32-employee-acr.md), shown and
 * filled in the admin app and the staff app: the school's facts, the self-appraisal, each level, the result,
 * and the steps. What may be filled comes from `report.can`.
 */
/** a rating, a written answer, yes / no, or the ids of the files attached (0194) */
export type AcrAnswer = number | string | string[];
export interface AcrQuestionView {
  id: string;
  text: string;
  /** scale: a rating on the scale; text: written; yesno: yes or no (0191); file: attachments (0194) */
  kind: 'scale' | 'text' | 'yesno' | 'file';
  weight: number;
  required: boolean;
}
/** A form the ACR was made with (0191): its sections, each with help, weight and questions. */
export interface AcrFormView {
  id: string;
  name: string;
  sections: Array<{
    id: string;
    title: string;
    help: string | null;
    weight: number;
    questions: AcrQuestionView[];
  }>;
}
export interface AcrSectionScore {
  id: string;
  title: string;
  weight: number;
  pct: number | null;
}
export interface AcrLevelView {
  seq: number;
  label: string;
  action: 'rate' | 'review';
  status: 'waiting' | 'pending' | 'done' | 'skipped';
  /** 0190: why the level is skipped (the same person as the level before) */
  skippedNote?: string | null;
  /** what to do at this level (0196): the set-up's text, or a plain default */
  instructions?: string;
  /** the last level that stands: the final approval, where the standard remarks are ticked (0195) */
  final?: boolean;
  remarkIds?: string[];
  /** the standard remark lines ticked, as text */
  remarkTexts?: string[];
  hidden?: boolean;
  /** the latest send-back, when this level must act on it */
  returned?: AcrReturned | null;
  /** the questionnaire this level answers (in `forms`), none for the grade and remarks only */
  formId?: string | null;
  /** the section scores of a filled level */
  sections?: AcrSectionScore[];
  people?: Array<{ id: string; name: string; code?: string }>;
  answers?: Record<string, AcrAnswer>;
  remarks?: string | null;
  scorePct?: number | null;
  grade?: string | null;
  gradeReason?: string | null;
  agreement?: 'agree' | 'partly' | 'disagree' | null;
  filledBy?: string | null;
  filledAt?: string | null;
}
/** A send-back: when, by whom, why. */
export interface AcrReturned {
  at: string;
  by: string | null;
  reason: string | null;
}
export interface AcrFacts {
  period: { from: string | null; to: string | null };
  attendance: { daysPresent: number; lateArrivals: number; lateAfter: string } | null;
  results: Array<{
    section: string;
    subjects: string | null;
    exam: string;
    students: number;
    averagePct: number;
    passPct: number;
    distinctions: number;
  }>;
  profile: {
    education: string[];
    experienceRows: number;
    documentsOnFile: number;
    requiredDocumentsMissing: number;
  };
  activityLog: { daysSubmitted: number; late: number; returned: number } | null;
}
/** The employee's record as the sheet shows it (20 Oct 2026). */
export interface AcrRecords {
  particulars: {
    joinedOn: string | null;
    designationAtJoining: string | null;
    designation: string | null;
    department: string | null;
    employeeType: string | null;
    regularisedOn: string | null;
    promotedOn: string | null;
    upgradedOn: string | null;
    payBand: string | null;
  };
  education: Array<{
    qualification: string | null;
    specialisation: string | null;
    institution: string | null;
    passingYear: number | null;
    score: string | null;
    mode: string | null;
  }>;
  experience: Array<{
    organisation: string | null;
    designation: string | null;
    fromOn: string | null;
    toOn: string | null;
    reason: string | null;
  }>;
  training: Array<{
    trainedOn: string | null;
    topic: string | null;
    venue: string | null;
    duration: string | null;
    organisation: string | null;
  }>;
  documents: Array<{
    id: string;
    type: string;
    fileId: string;
    issuedOn: string | null;
    expiresOn: string | null;
    verified: boolean;
  }>;
}
export interface AcrReportView {
  id: string;
  employee: {
    id: string;
    name: string;
    code: string;
    designation: string | null;
    department: string | null;
    joined_on: string | null;
  };
  staffGroup: 'teaching' | 'non_teaching';
  status: 'self' | 'review' | 'disclosed' | 'represented' | 'closed';
  currentLevel: number | null;
  cycle: { id: string; status: string; selfFrom: string; selfTo: string };
  scale: string[];
  bands: Array<{ minPct: number; label: string; adverse: boolean }>;
  /** the school's guidelines for the self-appraisal (ACR set-up), shown above it */
  guidelines: string;
  /** the employee's record (20 Oct 2026) */
  records: AcrRecords;
  /** Principal's remarks (0195): the standard lines per grade the final level picks from */
  remarkLines: Array<{ id: string; grade: string; text: string }>;
  /** the forms this ACR was made with, by id: the self form and the levels' questionnaires one may see */
  forms: Record<string, AcrFormView>;
  self: {
    /** the latest send-back to the employee, while the self-appraisal is theirs again */
    returned?: AcrReturned | null;
    formId: string | null;
    sections: AcrSectionScore[];
    answers: Record<string, AcrAnswer>;
    pct: number | null;
    submittedAt: string | null;
    facts: AcrFacts | null;
    office: {
      cl?: number | null;
      el?: number | null;
      other?: number | null;
      absent?: number | null;
      hpl?: number | null;
      lateSlips?: number | null;
      note?: string | null;
    };
  };
  levels: AcrLevelView[];
  result: {
    scorePct: number | null;
    grade: string | null;
    adverse: boolean;
    disclosedAt: string | null;
    objectBy: string | null;
    acknowledgedAt: string | null;
    representation: string | null;
    representedAt: string | null;
    decision: 'upheld' | 'revised' | null;
    decisionNote: string | null;
    decidedAt: string | null;
  } | null;
  events: Array<{ at: string; what: string; note: string | null; by_name: string | null }>;
  can: {
    self: boolean;
    level: { seq: number; action: 'rate' | 'review' } | null;
    sendBack: boolean;
    acknowledge: boolean;
    represent: boolean;
    decide: boolean;
    manage: boolean;
  };
}
export type AcrResult = { ok: true } | { ok: false; error: string };
export interface AcrActions {
  saveSelf?: (answers: Record<string, AcrAnswer>) => Promise<AcrResult>;
  submitSelf?: (answers: Record<string, AcrAnswer>) => Promise<AcrResult>;
  saveLevel?: (seq: number, body: AcrLevelBody) => Promise<AcrResult>;
  submitLevel?: (seq: number, body: AcrLevelBody) => Promise<AcrResult>;
  sendBack?: (reason: string) => Promise<AcrResult>;
  acknowledge?: () => Promise<AcrResult>;
  represent?: (text: string) => Promise<AcrResult>;
  /** an attachment question (0194): the app uploads the picked file as the person and gives its id */
  uploadFile?: (fd: FormData) => Promise<{ ok: true; id: string } | { ok: false; error: string }>;
}
export interface AcrLevelBody {
  answers: Record<string, AcrAnswer>;
  remarks: string | null;
  grade?: string | null;
  gradeReason?: string | null;
  agreement?: 'agree' | 'partly' | 'disagree' | null;
  /** the standard remark lines ticked at the final level (0195) */
  remarkIds?: string[];
}

const STATUS: Record<AcrReportView['status'], string> = {
  self: 'Self-appraisal',
  review: 'With the levels',
  disclosed: 'Shown to the employee',
  represented: 'Objection waiting',
  closed: 'Final',
};
const AGREE: Record<string, string> = {
  agree: 'Agrees with the level before',
  partly: 'Partly agrees with the level before',
  disagree: 'Disagrees with the level before',
};
const EVENT: Record<string, string> = {
  started: 'ACR started',
  self_submitted: 'Self-appraisal submitted',
  level_done: 'Level filled',
  returned: 'Sent back one level',
  returned_to_employee: 'Sent back to the employee',
  reviewers_changed: 'People of a level changed',
  disclosed: 'Shown to the employee',
  acknowledged: 'Acknowledged by the employee',
  represented: 'Objection from the employee',
  grade_upheld: 'Objection decided: grade kept',
  grade_revised: 'Objection decided: grade revised',
};
const who = (p: Array<{ name: string; code?: string }> | undefined) =>
  p?.length ? p.map((x) => (x.code ? `${x.name} (${x.code})` : x.name)).join(', ') : '';
const Returned = ({ r, to }: { r: AcrReturned; to: string }) => (
  <div className="ep-alert ep-alert--warning" role="status" style={{ marginBottom: 'var(--sp-3)' }}>
    <strong>Sent back to {to}</strong>
    {r.by ? ` by ${r.by}` : ''}, {when(r.at)}
    {r.reason ? `: ${r.reason}` : ''}
  </div>
);
const dmy = (d: string | null | undefined) =>
  d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '—';
const when = (d: string | null | undefined) =>
  d
    ? new Date(d).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

/** A form's sections: ratings as a row of choices, yes / no, written answers as text areas. */
function QuestionForm({
  idPrefix,
  form,
  scale,
  answers,
  onChange,
  editable,
  scores,
  fileHref,
  uploadFile,
}: {
  idPrefix: string;
  form: AcrFormView | undefined;
  scale: string[];
  answers: Record<string, AcrAnswer>;
  onChange: (id: string, v: AcrAnswer) => void;
  editable: boolean;
  /** section scores to show beside the titles (filled forms) */
  scores?: AcrSectionScore[];
  /** where an attached file opens; none: attachments are counted, not linked */
  fileHref?: (fileId: string) => string;
  uploadFile?: AcrActions['uploadFile'];
}) {
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const top = scale.length;
  if (!form) return <p className="ep-field__help">No questions: the grade and remarks only.</p>;
  return (
    <>
      {form.sections.map((g) => {
        const sc = scores?.find((x) => x.id === g.id);
        return (
          <fieldset key={g.id} className="ep-acr-sec">
            <legend className="ep-acr-sec__title">
              {g.title}
              {sc && sc.pct !== null ? <span className="ep-field__help"> · {sc.pct}%</span> : null}
              {g.weight !== 1 ? <span className="ep-field__help"> · weight {g.weight}</span> : null}
            </legend>
            {g.help ? (
              <p className="ep-field__help" style={{ marginTop: 0 }}>
                {g.help}
              </p>
            ) : null}
            {g.questions.map((q) => {
              const a = answers[q.id];
              const name = `${idPrefix}-${q.id}`;
              if (q.kind === 'text')
                return (
                  <label key={q.id} className="ep-field" htmlFor={name}>
                    <span className="ep-field__label">
                      {q.text}
                      {q.required && editable ? ' *' : ''}
                    </span>
                    {editable ? (
                      <textarea
                        id={name}
                        className="ep-input"
                        rows={3}
                        maxLength={4000}
                        value={typeof a === 'string' ? a : ''}
                        onChange={(e) => onChange(q.id, e.target.value)}
                      />
                    ) : (
                      <p className="ep-acr-answer">{typeof a === 'string' && a ? a : '—'}</p>
                    )}
                  </label>
                );
              if (q.kind === 'file') {
                const ids = Array.isArray(a) ? a : [];
                const pick = async (file: File | undefined) => {
                  if (!file || !uploadFile) return;
                  setBusy(true);
                  setFileErr(null);
                  const fd = new FormData();
                  fd.set('file', file);
                  const r = await uploadFile(fd);
                  setBusy(false);
                  if (r.ok) onChange(q.id, [...ids, r.id]);
                  else setFileErr(r.error);
                };
                return (
                  <div key={q.id} className="ep-field" role="group" aria-labelledby={`${name}-q`}>
                    <span id={`${name}-q`} className="ep-field__label">
                      {q.text}
                      {q.required && editable ? ' *' : ''}
                    </span>
                    <div className="ep-acr-files">
                      {ids.map((f, i) => (
                        <span key={f} className="ep-acr-files__item">
                          {fileHref ? (
                            <a
                              href={fileHref(f)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ep-filelinks__btn"
                              aria-label={`View attachment ${String(i + 1)}`}
                              title={`View attachment ${String(i + 1)}`}
                            >
                              {VIEW_ICON}
                            </a>
                          ) : (
                            <span className="ep-field__help">Attachment {i + 1}</span>
                          )}
                          {editable ? (
                            <button
                              type="button"
                              className="ep-btn ep-btn--ghost ep-btn--sm"
                              aria-label={`Remove attachment ${String(i + 1)}`}
                              onClick={() =>
                                onChange(
                                  q.id,
                                  ids.filter((x) => x !== f),
                                )
                              }
                            >
                              ×
                            </button>
                          ) : null}
                        </span>
                      ))}
                      {!ids.length && !editable ? <span className="ep-field__help">—</span> : null}
                      {editable && uploadFile && ids.length < 3 ? (
                        <>
                          <label className="ep-btn ep-btn--ghost ep-btn--sm" htmlFor={name}>
                            {busy ? 'Uploading…' : 'Attach a file'}
                          </label>
                          <input
                            id={name}
                            type="file"
                            accept="image/png,image/jpeg,image/webp,application/pdf"
                            className="ep-sr-only"
                            disabled={busy}
                            onChange={(e) => {
                              void pick(e.target.files?.[0]);
                              e.target.value = '';
                            }}
                          />
                        </>
                      ) : null}
                    </div>
                    {editable ? (
                      <span className="ep-field__help">
                        Up to three images or PDFs, 5 MB each. {fileErr ?? ''}
                      </span>
                    ) : null}
                  </div>
                );
              }
              if (q.kind === 'yesno')
                return (
                  <div
                    key={q.id}
                    className="ep-acr-rate"
                    role="group"
                    aria-labelledby={`${name}-q`}
                  >
                    <span id={`${name}-q`} className="ep-acr-rate__q">
                      {q.text}
                      {q.required && editable ? ' *' : ''}
                    </span>
                    {editable ? (
                      <span className="ep-acr-rate__opts">
                        {(['yes', 'no'] as const).map((v) => (
                          <label key={v} className="ep-acr-opt">
                            <input
                              type="radio"
                              name={name}
                              checked={a === v}
                              onChange={() => onChange(q.id, v)}
                            />
                            <span>{v === 'yes' ? 'Yes' : 'No'}</span>
                          </label>
                        ))}
                      </span>
                    ) : (
                      <span className="ep-acr-rate__val">
                        {a === 'yes' ? 'Yes' : a === 'no' ? 'No' : '—'}
                      </span>
                    )}
                  </div>
                );
              return (
                <div key={q.id} className="ep-acr-rate" role="group" aria-labelledby={`${name}-q`}>
                  <span id={`${name}-q`} className="ep-acr-rate__q">
                    {q.text}
                    {q.required && editable ? ' *' : ''}
                    {q.weight !== 1 ? <span className="ep-field__help"> (×{q.weight})</span> : null}
                  </span>
                  {editable ? (
                    <span className="ep-acr-rate__opts">
                      {scale.map((label, i) => {
                        const v = top - i;
                        return (
                          <label key={v} className="ep-acr-opt" title={label}>
                            <input
                              type="radio"
                              name={name}
                              checked={a === v}
                              onChange={() => onChange(q.id, v)}
                            />
                            <span>
                              {v}
                              <span className="ep-sr-only"> {label}</span>
                            </span>
                          </label>
                        );
                      })}
                    </span>
                  ) : (
                    <span className="ep-acr-rate__val">
                      {typeof a === 'number' ? `${String(a)} · ${scale[top - a] ?? ''}` : '—'}
                    </span>
                  )}
                </div>
              );
            })}
          </fieldset>
        );
      })}
    </>
  );
}

const VIEW_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
  </svg>
);

/** The employee's record (20 Oct 2026): particulars, education, experience, training, documents. */
function Records({ rec, fileHref }: { rec: AcrRecords; fileHref?: (fileId: string) => string }) {
  const p = rec.particulars;
  const d = (x: string | null) => (x ? dmy(x) : null);
  const facts: Array<[string, string | null]> = [
    ['Date of joining', d(p.joinedOn)],
    ['Designation at joining', p.designationAtJoining],
    ['Present designation', p.designation],
    ['Department', p.department],
    ['Employee type', p.employeeType],
    ['Date of regularisation', d(p.regularisedOn)],
    ['Last promotion', d(p.promotedOn)],
    ['Last upgradation', d(p.upgradedOn)],
    ['Pay band / grade', p.payBand],
  ];
  const table = (title: string, head: string[], rows: Array<Array<string | null>>) =>
    rows.length ? (
      <div className="ep-table-wrap" style={{ marginTop: 'var(--sp-3)' }}>
        <table className="ep-table ep-table--dense">
          <caption className="ep-field__label" style={{ textAlign: 'left' }}>
            {title}
          </caption>
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>{cell ?? '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
        {title}: none on record.
      </p>
    );
  return (
    <section className="ep-card ep-acr-card" aria-labelledby="acr-record-h">
      <h2 id="acr-record-h" className="ep-card__title">
        The employee’s record
      </h2>
      <h3 className="ep-field__label">Personal particulars</h3>
      <dl className="ep-hero__facts">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v ?? '—'}</dd>
          </div>
        ))}
      </dl>
      {table(
        'Educational details',
        ['Qualification', 'Specialisation', 'Institution', 'Year', 'Score', 'Mode'],
        rec.education.map((e) => [
          e.qualification,
          e.specialisation,
          e.institution,
          e.passingYear === null ? null : String(e.passingYear),
          e.score,
          e.mode,
        ]),
      )}
      {table(
        'Experience details',
        ['Organisation', 'Designation', 'From', 'To', 'Reason for leaving'],
        rec.experience.map((e) => [
          e.organisation,
          e.designation,
          d(e.fromOn),
          d(e.toOn),
          e.reason,
        ]),
      )}
      {table(
        'Training details',
        ['Date', 'Topic', 'Venue', 'Duration', 'Organisation'],
        rec.training.map((t) => [d(t.trainedOn), t.topic, t.venue, t.duration, t.organisation]),
      )}
      {rec.documents.length ? (
        <div className="ep-table-wrap" style={{ marginTop: 'var(--sp-3)' }}>
          <table className="ep-table ep-table--dense">
            <caption className="ep-field__label" style={{ textAlign: 'left' }}>
              Documents on file
            </caption>
            <thead>
              <tr>
                <th scope="col">Document</th>
                <th scope="col">Issued</th>
                <th scope="col">Expires</th>
                <th scope="col">Checked</th>
                {fileHref ? (
                  <th scope="col">
                    <span className="ep-sr-only">View</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rec.documents.map((doc) => (
                <tr key={doc.id}>
                  <td>{doc.type}</td>
                  <td>{d(doc.issuedOn) ?? '—'}</td>
                  <td>{d(doc.expiresOn) ?? '—'}</td>
                  <td>{doc.verified ? 'Yes' : '—'}</td>
                  {fileHref ? (
                    <td>
                      <span className="ep-filelinks">
                        <a
                          href={fileHref(doc.fileId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ep-filelinks__btn"
                          aria-label={`View ${doc.type}`}
                          title={`View ${doc.type}`}
                        >
                          {VIEW_ICON}
                        </a>
                      </span>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
          Documents on file: none.
        </p>
      )}
    </section>
  );
}

function Facts({ f, office }: { f: AcrFacts | null; office: AcrReportView['self']['office'] }) {
  if (!f) return null;
  const leave = [
    ['CL', office.cl],
    ['EL', office.el],
    ['Half-pay leave', office.hpl],
    ['Other leave (EOL/LWP)', office.other],
    ['Total absence', office.absent],
    ['Late arrival slips', office.lateSlips],
  ].filter(([, v]) => v !== null && v !== undefined);
  return (
    <section className="ep-card ep-acr-card" aria-labelledby="acr-facts-h">
      <h2 id="acr-facts-h" className="ep-card__title">
        From the school’s records
      </h2>
      <p className="ep-field__help" style={{ marginTop: 0 }}>
        {dmy(f.period.from)} to {dmy(f.period.to)} · filled in by itself; kept as it was on
        submission.
      </p>
      <div className="ep-acr-facts">
        <div>
          <h3 className="ep-field__label">Attendance</h3>
          {f.attendance ? (
            <p>
              {f.attendance.daysPresent} days present · {f.attendance.lateArrivals} late (after{' '}
              {f.attendance.lateAfter})
            </p>
          ) : (
            <p className="ep-field__help">No staff punches this year.</p>
          )}
          {leave.length ? (
            <p>
              {leave.map(([k, v]) => `${String(k)} ${String(v)}`).join(' · ')}
              {office.note ? ` · ${office.note}` : ''}
            </p>
          ) : (
            <p className="ep-field__help">Leave taken: not entered by the office yet.</p>
          )}
        </div>
        <div>
          <h3 className="ep-field__label">Profile</h3>
          <p>
            {f.profile.education.length ? f.profile.education.join('; ') : 'No education on record'}
          </p>
          <p className="ep-field__help">
            {f.profile.experienceRows} earlier jobs · {f.profile.documentsOnFile} documents on file
            {f.profile.requiredDocumentsMissing
              ? ` · ${String(f.profile.requiredDocumentsMissing)} required missing`
              : ''}
          </p>
        </div>
        <div>
          <h3 className="ep-field__label">Daily activity log</h3>
          {f.activityLog ? (
            <p>
              {f.activityLog.daysSubmitted} days submitted · {f.activityLog.late} late ·{' '}
              {f.activityLog.returned} returned
            </p>
          ) : (
            <p className="ep-field__help">Not used this year.</p>
          )}
        </div>
      </div>
      {f.results.length ? (
        <div className="ep-table-wrap" style={{ marginTop: 'var(--sp-3)' }}>
          <table className="ep-table">
            <caption className="ep-field__label" style={{ textAlign: 'left' }}>
              Results of the sections taught (latest exam)
            </caption>
            <thead>
              <tr>
                <th scope="col">Section</th>
                <th scope="col">Subjects</th>
                <th scope="col">Exam</th>
                <th scope="col">Students</th>
                <th scope="col">Average %</th>
                <th scope="col">Pass %</th>
                <th scope="col">75%+</th>
              </tr>
            </thead>
            <tbody>
              {f.results.map((r) => (
                <tr key={r.section}>
                  <td>{r.section}</td>
                  <td>{r.subjects ?? '—'}</td>
                  <td>{r.exam}</td>
                  <td>{r.students}</td>
                  <td>{r.averagePct}</td>
                  <td>{r.passPct}</td>
                  <td>{r.distinctions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export function AcrSheet({
  report,
  actions,
  extra,
  onDone,
  fileHref,
}: {
  report: AcrReportView;
  actions: AcrActions;
  /** after a step went through (the app reloads the ACR) */
  onDone?: () => void;
  /** the app's own controls (the admin's: people of a level, office figures, decide) */
  extra?: ReactNode;
  /** where a document on the record opens (View); none: the documents are listed without a link */
  fileHref?: (fileId: string) => string;
}) {
  const r = report;
  const [self, setSelf] = useState<Record<string, AcrAnswer>>(r.self.answers);
  const mine = r.can.level ? r.levels.find((l) => l.seq === r.can.level!.seq) : undefined;
  const [lv, setLv] = useState<AcrLevelBody>({
    answers: mine?.answers ?? {},
    remarks: mine?.remarks ?? '',
    grade: mine?.grade ?? null,
    gradeReason: mine?.gradeReason ?? '',
    agreement: mine?.agreement ?? null,
    remarkIds: mine?.remarkIds ?? [],
  });
  // the ACR as steps (20 Oct 2026): the self-appraisal, then each level; the current one opens first
  const steps = useMemo(
    () => [
      {
        key: 'self',
        n: 1,
        label: 'Self-appraisal',
        who: r.employee.name,
        state: r.self.submittedAt ? 'done' : r.status === 'self' ? 'current' : 'waiting',
      },
      ...r.levels.map((l) => ({
        key: `l${String(l.seq)}`,
        n: l.seq + 1,
        label: l.label,
        who: who(l.people) || 'Nobody set',
        state:
          l.status === 'done'
            ? 'done'
            : l.status === 'pending'
              ? 'current'
              : l.status === 'skipped'
                ? 'skipped'
                : 'waiting',
      })),
    ],
    [r],
  );
  const [open, setOpen] = useState<string>(
    () =>
      steps.find((x) => x.state === 'current')?.key ??
      [...steps].reverse().find((x) => x.state === 'done')?.key ??
      'self',
  );
  const STATE_WORD = { done: 'Filled', current: 'Now', waiting: 'Not yet', skipped: 'Skipped' };
  const STATE_TONE = { done: 'success', current: 'info', waiting: 'neutral', skipped: 'warning' };
  const [back, setBack] = useState('');
  const [rep, setRep] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: (() => Promise<AcrResult>) | undefined, ok: string) => {
    if (!fn) return;
    setBusy(true);
    const res = await fn();
    setBusy(false);
    setMsg(res.ok ? { tone: 'success', text: ok } : { tone: 'danger', text: res.error });
    if (res.ok) onDone?.();
  };

  // the grade the ratings so far give, which a reviewer keeps or changes with a reason
  const before = useMemo(() => {
    if (!r.can.level || r.can.level.action !== 'review') return null;
    return (
      [...r.levels]
        .reverse()
        .find((l) => l.seq < r.can.level!.seq && l.status === 'done' && l.grade)?.grade ?? null
    );
  }, [r]);
  const grade = lv.grade ?? before;

  return (
    <div className="ep-acr">
      <section className="ep-card ep-acr-card ep-acr-head" aria-label="ACR">
        <div>
          <strong>{r.employee.name}</strong> · {r.employee.code}
          <div className="ep-field__help">
            {[
              r.employee.designation,
              r.employee.department,
              r.staffGroup === 'teaching' ? 'Teaching' : 'Non-teaching',
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        <div className="ep-acr-head__right">
          <span
            className={`ep-badge ep-badge--${r.status === 'closed' ? 'success' : r.status === 'represented' ? 'warning' : 'info'}`}
          >
            {STATUS[r.status]}
          </span>
          <span className="ep-field__help">
            Self-appraisal {dmy(r.cycle.selfFrom)} – {dmy(r.cycle.selfTo)}
          </span>
        </div>
      </section>

      {msg ? (
        <div className={`ep-alert ep-alert--${msg.tone}`} role="status">
          {msg.text}
        </div>
      ) : null}

      {r.result && r.status !== 'self' && r.status !== 'review' ? (
        <section className="ep-card ep-acr-card" aria-labelledby="acr-res-h">
          <h2 id="acr-res-h" className="ep-card__title">
            Result
          </h2>
          <div className="ep-acr-result">
            <div>
              <span className="ep-kpi__value">{r.result.grade ?? '—'}</span>
              <span className="ep-kpi__label">
                Grade{r.result.scorePct !== null ? ` · score ${String(r.result.scorePct)}%` : ''}
                {r.result.adverse ? ' · adverse' : ''}
              </span>
              {r.levels.some((l) => l.status === 'done' && l.scorePct !== null) ? (
                <span className="ep-field__help">
                  {r.levels
                    .filter(
                      (l) => l.status === 'done' && l.scorePct !== null && l.scorePct !== undefined,
                    )
                    .map((l) => `${l.label} ${String(l.scorePct)}%`)
                    .join(' · ')}
                  {' · the average'}
                </span>
              ) : null}
            </div>
            <div className="ep-field__help">
              {r.result.disclosedAt ? (
                <div>Shown to the employee {when(r.result.disclosedAt)}</div>
              ) : null}
              {r.result.acknowledgedAt ? (
                <div>Acknowledged {when(r.result.acknowledgedAt)}</div>
              ) : null}
              {r.status === 'disclosed' && r.result.objectBy ? (
                <div>
                  {r.result.adverse
                    ? `May object until ${dmy(r.result.objectBy)}`
                    : `Final on ${dmy(r.result.objectBy)} if not acknowledged`}
                </div>
              ) : null}
            </div>
          </div>
          {r.result.representation ? (
            <div className="ep-acr-note">
              <h3 className="ep-field__label">Objection ({when(r.result.representedAt)})</h3>
              <p>{r.result.representation}</p>
              {r.result.decision ? (
                <>
                  <h3 className="ep-field__label">
                    Decision: {r.result.decision === 'revised' ? 'grade revised' : 'grade kept'} (
                    {when(r.result.decidedAt)})
                  </h3>
                  <p>{r.result.decisionNote}</p>
                </>
              ) : null}
            </div>
          ) : null}
          {r.can.acknowledge || r.can.represent ? (
            <div className="ep-acr-actions">
              {r.can.acknowledge ? (
                <button
                  type="button"
                  className="ep-btn ep-btn--primary"
                  disabled={busy}
                  onClick={() => void run(actions.acknowledge, 'Acknowledged. Your ACR is final.')}
                >
                  I have seen my ACR
                </button>
              ) : null}
              {r.can.represent ? (
                <div className="ep-acr-object">
                  <label className="ep-field" htmlFor="acr-rep">
                    <span className="ep-field__label">
                      Object to the grade (until {dmy(r.result.objectBy)})
                    </span>
                    <textarea
                      id="acr-rep"
                      className="ep-input"
                      rows={4}
                      maxLength={4000}
                      value={rep}
                      onChange={(e) => setRep(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="ep-btn ep-btn--secondary"
                    disabled={busy || rep.trim().length < 20}
                    onClick={() =>
                      void run(
                        actions.represent ? () => actions.represent!(rep) : undefined,
                        'Your objection is sent.',
                      )
                    }
                  >
                    Send my objection
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <Facts f={r.self.facts} office={r.self.office} />

      <Records rec={r.records} fileHref={fileHref} />

      <ol className="ep-stepbar" aria-label="Steps of the ACR">
        {steps.map((st) => (
          <li key={st.key}>
            <button
              type="button"
              className="ep-stepbar__item"
              data-state={st.state}
              aria-current={open === st.key ? 'step' : undefined}
              onClick={() => setOpen(st.key)}
            >
              <span className="ep-stepbar__n" aria-hidden="true">
                {st.n}
              </span>
              <span>
                <span className="ep-stepbar__label">{st.label}</span>
                <br />
                <span className="ep-field__help">{st.who}</span>
              </span>
              <span
                className={`ep-badge ep-badge--${STATE_TONE[st.state as keyof typeof STATE_TONE]}`}
              >
                {STATE_WORD[st.state as keyof typeof STATE_WORD]}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <section className="ep-card ep-acr-card" aria-labelledby="acr-self-h">
        <h2 id="acr-self-h" className="ep-card__title">
          <button
            type="button"
            className="ep-acr-step__toggle"
            aria-expanded={open === 'self'}
            aria-controls="acr-self-panel"
            onClick={() => setOpen(open === 'self' ? '' : 'self')}
          >
            1. Self-appraisal
            {r.self.pct !== null ? (
              <span className="ep-field__help"> · self-rating {r.self.pct}%</span>
            ) : null}
          </button>
        </h2>
        <div id="acr-self-panel" hidden={open !== 'self'}>
          {r.guidelines ? (
            <div className="ep-acr-instructions">
              <strong>Guidelines to complete the performance report</strong>
              {'\n'}
              {r.guidelines}
            </div>
          ) : null}
          {r.self.submittedAt ? (
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              Submitted {when(r.self.submittedAt)}
            </p>
          ) : null}
          {r.self.returned ? <Returned r={r.self.returned} to="you" /> : null}
          <QuestionForm
            fileHref={fileHref}
            uploadFile={actions.uploadFile}
            idPrefix="self"
            form={r.self.formId ? r.forms[r.self.formId] : undefined}
            scale={r.scale}
            answers={self}
            editable={r.can.self}
            scores={r.self.submittedAt ? r.self.sections : undefined}
            onChange={(id, v) => setSelf((x) => ({ ...x, [id]: v }))}
          />
          {r.can.self ? (
            <div className="ep-acr-actions">
              <button
                type="button"
                className="ep-btn ep-btn--secondary"
                disabled={busy}
                onClick={() =>
                  void run(
                    actions.saveSelf ? () => actions.saveSelf!(self) : undefined,
                    'Saved. You can come back to it.',
                  )
                }
              >
                Save draft
              </button>
              <button
                type="button"
                className="ep-btn ep-btn--primary"
                disabled={busy}
                onClick={() =>
                  void run(
                    actions.submitSelf ? () => actions.submitSelf!(self) : undefined,
                    'Submitted to the first level.',
                  )
                }
              >
                Submit self-appraisal
              </button>
            </div>
          ) : null}
        </div>
      </section>

      {r.levels.map((l) => {
        const editing = r.can.level?.seq === l.seq;
        const key = `l${String(l.seq)}`;
        return (
          <section
            key={l.seq}
            className="ep-card ep-acr-card"
            aria-labelledby={`acr-l${String(l.seq)}-h`}
          >
            <h2 id={`acr-l${String(l.seq)}-h`} className="ep-card__title">
              <button
                type="button"
                className="ep-acr-step__toggle"
                aria-expanded={open === key}
                aria-controls={`acr-${key}-panel`}
                onClick={() => setOpen(open === key ? '' : key)}
              >
                {l.seq + 1}. {l.label}{' '}
                <span className="ep-field__help">
                  · {l.action === 'rate' ? 'rates' : 'reviews'} ·{' '}
                  {l.status === 'done'
                    ? 'filled'
                    : l.status === 'pending'
                      ? 'at this level now'
                      : l.status === 'skipped'
                        ? `skipped: ${l.skippedNote ?? 'the same person as the level before'}`
                        : 'not yet'}
                </span>
              </button>
            </h2>
            <div id={`acr-${key}-panel`} hidden={open !== key}>
              {!l.hidden && l.instructions && (editing || l.status !== 'done') ? (
                <p className="ep-acr-instructions">{l.instructions}</p>
              ) : null}
              {l.hidden ? (
                <>
                  <p className="ep-field__help" style={{ marginTop: 0 }}>
                    {who(l.people) || 'Nobody set for this level yet'}
                  </p>
                  <p className="ep-field__help">
                    Their answers are shown once the ACR is complete.
                  </p>
                </>
              ) : (
                <>
                  <p className="ep-field__help" style={{ marginTop: 0 }}>
                    {who(l.people) || 'Nobody set for this level yet'}
                    {l.filledBy ? ` · filled by ${l.filledBy}, ${when(l.filledAt)}` : ''}
                  </p>
                  {l.returned ? <Returned r={l.returned} to="this level" /> : null}
                  {l.formId && (l.status === 'done' || editing) ? (
                    <QuestionForm
                      fileHref={fileHref}
                      uploadFile={actions.uploadFile}
                      idPrefix={`l${String(l.seq)}`}
                      form={r.forms[l.formId]}
                      scale={r.scale}
                      answers={editing ? lv.answers : (l.answers ?? {})}
                      editable={editing}
                      scores={l.status === 'done' ? l.sections : undefined}
                      onChange={(id, v) =>
                        setLv((x) => ({ ...x, answers: { ...x.answers, [id]: v } }))
                      }
                    />
                  ) : null}
                  {l.status === 'done' && !editing ? (
                    <div className="ep-acr-note">
                      {l.scorePct !== null && l.scorePct !== undefined ? (
                        <p>
                          <strong>Score {l.scorePct}%</strong>
                          {l.grade ? ` · ${l.grade}` : ''}
                        </p>
                      ) : l.grade ? (
                        <p>
                          <strong>Grade {l.grade}</strong>
                        </p>
                      ) : null}
                      {l.gradeReason ? <p>Why this grade: {l.gradeReason}</p> : null}
                      {l.agreement ? <p>{AGREE[l.agreement]}</p> : null}
                      {l.remarkTexts?.length ? (
                        <ul>
                          {l.remarkTexts.map((t, i) => (
                            <li key={i}>{t}</li>
                          ))}
                        </ul>
                      ) : null}
                      {l.remarks ? <p>{l.remarks}</p> : null}
                    </div>
                  ) : null}
                  {editing ? (
                    <div className="ep-acr-level-form">
                      {l.action === 'review' ? (
                        <>
                          <label className="ep-field" htmlFor="acr-grade">
                            <span className="ep-field__label">Grade *</span>
                            <select
                              id="acr-grade"
                              className="ep-select"
                              value={grade ?? ''}
                              onChange={(e) =>
                                setLv((x) => ({ ...x, grade: e.target.value || null }))
                              }
                            >
                              <option value="">Choose…</option>
                              {r.bands.map((b) => (
                                <option key={b.label} value={b.label}>
                                  {b.label} (from {b.minPct}%)
                                </option>
                              ))}
                            </select>
                          </label>
                          {before && grade && grade !== before ? (
                            <label className="ep-field" htmlFor="acr-why">
                              <span className="ep-field__label">Why not {before}? *</span>
                              <input
                                id="acr-why"
                                className="ep-input"
                                maxLength={1000}
                                value={lv.gradeReason ?? ''}
                                onChange={(e) =>
                                  setLv((x) => ({ ...x, gradeReason: e.target.value }))
                                }
                              />
                            </label>
                          ) : null}
                          <fieldset className="ep-field" style={{ border: 0, padding: 0 }}>
                            <legend className="ep-field__label">The level before *</legend>
                            {(['agree', 'partly', 'disagree'] as const).map((k) => (
                              <label key={k} className="ep-check">
                                <input
                                  type="radio"
                                  name="acr-agree"
                                  checked={lv.agreement === k}
                                  onChange={() => setLv((x) => ({ ...x, agreement: k }))}
                                />{' '}
                                {k === 'agree'
                                  ? 'I agree'
                                  : k === 'partly'
                                    ? 'I partly agree'
                                    : 'I disagree'}
                              </label>
                            ))}
                          </fieldset>
                        </>
                      ) : null}
                      {l.final && r.remarkLines.length ? (
                        <fieldset className="ep-field" style={{ border: 0, padding: 0 }}>
                          <legend className="ep-field__label">Principal’s remarks</legend>
                          <p className="ep-field__help" style={{ marginTop: 0 }}>
                            Tick the standard lines that apply for the grade {grade ?? ''}; add your
                            own words below.
                          </p>
                          {r.remarkLines.filter((x) => x.grade === grade).length ? (
                            r.remarkLines
                              .filter((x) => x.grade === grade)
                              .map((x) => (
                                <label key={x.id} className="ep-check">
                                  <input
                                    type="checkbox"
                                    checked={(lv.remarkIds ?? []).includes(x.id)}
                                    onChange={(e) =>
                                      setLv((cur) => ({
                                        ...cur,
                                        remarkIds: e.target.checked
                                          ? [...(cur.remarkIds ?? []), x.id]
                                          : (cur.remarkIds ?? []).filter((id) => id !== x.id),
                                      }))
                                    }
                                  />{' '}
                                  {x.text}
                                </label>
                              ))
                          ) : (
                            <p className="ep-field__help">
                              No standard remarks for this grade in the set-up.
                            </p>
                          )}
                        </fieldset>
                      ) : null}
                      <label className="ep-field" htmlFor="acr-remarks">
                        <span className="ep-field__label">
                          Remarks{l.action === 'review' ? ' *' : ''}
                        </span>
                        <textarea
                          id="acr-remarks"
                          className="ep-input"
                          rows={4}
                          maxLength={4000}
                          value={lv.remarks ?? ''}
                          onChange={(e) => setLv((x) => ({ ...x, remarks: e.target.value }))}
                        />
                      </label>
                      <div className="ep-acr-actions">
                        <button
                          type="button"
                          className="ep-btn ep-btn--secondary"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              actions.saveLevel
                                ? () => actions.saveLevel!(l.seq, { ...lv, grade })
                                : undefined,
                              'Saved. You can come back to it.',
                            )
                          }
                        >
                          Save draft
                        </button>
                        <button
                          type="button"
                          className="ep-btn ep-btn--primary"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              actions.submitLevel
                                ? () => actions.submitLevel!(l.seq, { ...lv, grade })
                                : undefined,
                              'Submitted.',
                            )
                          }
                        >
                          Submit
                        </button>
                      </div>
                      {r.can.sendBack ? (
                        <div className="ep-acr-object">
                          <label className="ep-field" htmlFor="acr-back">
                            <span className="ep-field__label">
                              Or send it back to {l.seq === 1 ? 'the employee' : 'the level before'}
                              : why
                            </span>
                            <input
                              id="acr-back"
                              className="ep-input"
                              maxLength={1000}
                              value={back}
                              onChange={(e) => setBack(e.target.value)}
                            />
                          </label>
                          <button
                            type="button"
                            className="ep-btn ep-btn--ghost"
                            disabled={busy || back.trim().length < 5}
                            onClick={() =>
                              void run(
                                actions.sendBack ? () => actions.sendBack!(back) : undefined,
                                'Sent back.',
                              )
                            }
                          >
                            Send back
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </section>
        );
      })}

      {extra}

      {r.events.length ? (
        <section className="ep-card ep-acr-card" aria-labelledby="acr-ev-h">
          <h2 id="acr-ev-h" className="ep-card__title">
            Steps
          </h2>
          <ol className="ep-acr-events">
            {r.events.map((e, i) => (
              <li key={String(i)}>
                <span className="ep-field__help">{when(e.at)}</span> {EVENT[e.what] ?? e.what}
                {e.note ? ` · ${e.note}` : ''}
                {e.by_name ? <span className="ep-field__help"> · {e.by_name}</span> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
