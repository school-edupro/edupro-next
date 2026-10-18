'use client';
import { useMemo, useState, type ReactNode } from 'react';

/**
 * One employee ACR as the API gives it (people/acr/reports/:id, docs/design/32-employee-acr.md), shown and
 * filled in the admin app and the staff app: the school's facts, the self-appraisal, each level, the result,
 * and the steps. What may be filled comes from `report.can`.
 */
export type AcrAnswer = number | string;
export interface AcrQuestionView {
  id: string;
  part: 'self' | 'rate';
  section: string;
  text: string;
  kind: 'scale' | 'text';
  weight: number;
  required: boolean;
}
export interface AcrLevelView {
  seq: number;
  label: string;
  action: 'rate' | 'review';
  status: 'waiting' | 'pending' | 'done';
  hidden?: boolean;
  people?: Array<{ id: string; name: string }>;
  answers?: Record<string, AcrAnswer>;
  remarks?: string | null;
  scorePct?: number | null;
  grade?: string | null;
  gradeReason?: string | null;
  agreement?: 'agree' | 'partly' | 'disagree' | null;
  filledBy?: string | null;
  filledAt?: string | null;
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
  questions: { self: AcrQuestionView[]; rate: AcrQuestionView[] };
  self: {
    answers: Record<string, AcrAnswer>;
    pct: number | null;
    submittedAt: string | null;
    facts: AcrFacts | null;
    office: {
      cl?: number | null;
      el?: number | null;
      other?: number | null;
      absent?: number | null;
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
}
export interface AcrLevelBody {
  answers: Record<string, AcrAnswer>;
  remarks: string | null;
  grade?: string | null;
  gradeReason?: string | null;
  agreement?: 'agree' | 'partly' | 'disagree' | null;
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

function bySection(qs: AcrQuestionView[]) {
  const out: Array<{ section: string; items: AcrQuestionView[] }> = [];
  for (const q of qs) {
    const g = out.find((x) => x.section === q.section);
    if (g) g.items.push(q);
    else out.push({ section: q.section, items: [q] });
  }
  return out;
}

/** A form of questions: ratings as a row of choices, written answers as text areas. */
function QuestionForm({
  idPrefix,
  questions,
  scale,
  answers,
  onChange,
  editable,
}: {
  idPrefix: string;
  questions: AcrQuestionView[];
  scale: string[];
  answers: Record<string, AcrAnswer>;
  onChange: (id: string, v: AcrAnswer) => void;
  editable: boolean;
}) {
  const top = scale.length;
  return (
    <>
      {bySection(questions).map((g) => (
        <fieldset key={g.section} className="ep-acr-sec">
          <legend className="ep-acr-sec__title">{g.section}</legend>
          {g.items.map((q) => {
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
      ))}
    </>
  );
}

function Facts({ f, office }: { f: AcrFacts | null; office: AcrReportView['self']['office'] }) {
  if (!f) return null;
  const leave = [
    ['CL', office.cl],
    ['EL', office.el],
    ['Other leave', office.other],
    ['Total absence', office.absent],
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
}: {
  report: AcrReportView;
  actions: AcrActions;
  /** after a step went through (the app reloads the ACR) */
  onDone?: () => void;
  /** the app's own controls (the admin's: people of a level, office figures, decide) */
  extra?: ReactNode;
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
  });
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

      <section className="ep-card ep-acr-card" aria-labelledby="acr-self-h">
        <h2 id="acr-self-h" className="ep-card__title">
          Self-appraisal
          {r.self.pct !== null ? (
            <span className="ep-field__help"> · self-rating {r.self.pct}%</span>
          ) : null}
        </h2>
        {r.self.submittedAt ? (
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            Submitted {when(r.self.submittedAt)}
          </p>
        ) : null}
        <QuestionForm
          idPrefix="self"
          questions={r.questions.self}
          scale={r.scale}
          answers={self}
          editable={r.can.self}
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
      </section>

      {r.levels.map((l) => {
        const editing = r.can.level?.seq === l.seq;
        return (
          <section
            key={l.seq}
            className="ep-card ep-acr-card"
            aria-labelledby={`acr-l${String(l.seq)}-h`}
          >
            <h2 id={`acr-l${String(l.seq)}-h`} className="ep-card__title">
              {l.seq}. {l.label}{' '}
              <span className="ep-field__help">
                · {l.action === 'rate' ? 'rates' : 'reviews'} ·{' '}
                {l.status === 'done'
                  ? 'filled'
                  : l.status === 'pending'
                    ? 'at this level now'
                    : 'not yet'}
              </span>
            </h2>
            {l.hidden ? (
              <p className="ep-field__help">Shown once the ACR is complete.</p>
            ) : (
              <>
                <p className="ep-field__help" style={{ marginTop: 0 }}>
                  {l.people?.length
                    ? l.people.map((p) => p.name).join(', ')
                    : 'Nobody set for this level yet'}
                  {l.filledBy ? ` · filled by ${l.filledBy}, ${when(l.filledAt)}` : ''}
                </p>
                {l.action === 'rate' && (l.status === 'done' || editing) ? (
                  <QuestionForm
                    idPrefix={`l${String(l.seq)}`}
                    questions={r.questions.rate}
                    scale={r.scale}
                    answers={editing ? lv.answers : (l.answers ?? {})}
                    editable={editing}
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
                            Or send it back to {l.seq === 1 ? 'the employee' : 'the level before'}:
                            why
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
