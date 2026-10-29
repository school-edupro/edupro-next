import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { entryStep, saveMarks, savePartMarks } from './actions';

interface Exam {
  id: string;
  code: string;
  name: string;
  startsOn: string | null;
  marksLocked: boolean;
}
interface EntrySection {
  classSectionId: string;
  code: string;
  register: boolean;
  subjects: Array<{
    examSubjectId: string;
    subjectId: string;
    code: string;
    name: string;
    maxMarks: string;
    passMarks: string | null;
    entryLocked: boolean;
    entered: number;
    parts?: Part[];
  }>;
}
interface Part {
  id: string;
  name: string;
  maxMarks: string;
  mine: boolean;
}
interface Sheet {
  exam: { id: string; code: string; name: string; marksLocked: boolean };
  examSubject: {
    id: string;
    code: string;
    name: string;
    maxMarks: string;
    passMarks: string | null;
    entryLocked: boolean;
    parts?: Part[];
    /** maximum 0: a grade of the scale instead of marks (docs/design/65) */
    gradeOnly?: boolean;
  };
  section: { id: string; code: string };
  codes?: Array<{ code: string; name: string }>;
  grades?: string[];
  /** open → submitted → verified (docs/design/65, part 2) */
  status?: { status: 'open' | 'submitted' | 'verified'; remark: string | null };
  rows: Array<{
    studentId: string;
    name: string;
    admissionNo: string;
    rollNo: number | null;
    parts?: Record<string, { marks: string | null; absent: boolean }>;
    marks: string | null;
    absent: boolean;
    exempt: boolean;
    code?: string | null;
    grade?: string | null;
    /** null: the pupil does not take the subject */
    taken?: string | null;
  }>;
}
const ERRORS: Record<string, string> = {
  'exams.entered_in_parts': 'This subject is entered in parts; choose the part.',
  'exams.entry_locked': 'Entry for this subject is locked; ask the coordinator to reopen it.',
  'exams.marks_out_of_range': 'A mark is above the maximum for this subject.',
  'exams.not_assigned': 'You are not assigned to this section or subject.',
  'exams.student_not_in_section': 'A student in the sheet is no longer in this section; reload.',
  'exams.subject_not_taken': 'A pupil does not take this subject; leave the row empty.',
  'exams.unknown_code': 'That is not a marks code of the school.',
  'exams.grade_not_allowed': "That grade is not on the subject's scale.",
  'exams.entry_submitted':
    'The marks are submitted or verified; they change only after they are sent back.',
  'exams.marks_missing': 'Some pupils have no marks or code yet.',
  'scope-denied': 'You are not allowed to enter marks for this section.',
  'validation-failed': 'Some values were not accepted.',
};

/** Sprint 15: mark entry for the sections and subjects the teacher holds; locked sheets are read-only. */
export default async function MarksPage({
  searchParams,
}: {
  searchParams: Promise<{
    exam?: string;
    pick?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let exams: Exam[];
  try {
    exams = await bff.api.fetch<{ data: Exam[] }>('/exams').then((r) => r.data);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title={t(lang, 'Marks')} />
          <Card>{t(lang, 'You are not allowed to enter marks in this school.')}</Card>
        </main>
      );
    throw error;
  }
  const exam = exams.find((e) => e.id === sp.exam) ?? exams[0];
  let sections: EntrySection[] = [];
  if (exam)
    sections = await bff.api
      .fetch<{ data: EntrySection[] }>(`/exams/${exam.id}/entry/sections`)
      .then((r) => r.data);
  // a subject entered in parts (Theory / Practical, or Physics / Chemistry / Biology under Science) is
  // offered part by part: the parts this teacher enters
  const options = sections.flatMap((s) =>
    s.subjects.flatMap((sub) =>
      (sub.parts ?? []).length
        ? (sub.parts ?? [])
            .filter((p) => p.mine)
            .map((p) => ({
              value: `${s.classSectionId}|${sub.subjectId}|${p.id}`,
              label: `${s.code} · ${sub.name} · ${p.name} (${String(Number(p.maxMarks))})${sub.entryLocked ? ` (${t(lang, 'locked')})` : ''}`,
              classSectionId: s.classSectionId,
              subjectId: sub.subjectId,
              partId: p.id as string | null,
            }))
        : [
            {
              value: `${s.classSectionId}|${sub.subjectId}`,
              label: `${s.code} · ${sub.name}${sub.entryLocked ? ` (${t(lang, 'locked')})` : ''} · ${sub.entered} ${t(lang, 'entered')}`,
              classSectionId: s.classSectionId,
              subjectId: sub.subjectId,
              partId: null as string | null,
            },
          ],
    ),
  );
  const chosen = options.find((o) => o.value === sp.pick) ?? options[0];
  let sheet: Sheet | null = null;
  let loadError: string | null = null;
  if (exam && chosen) {
    try {
      sheet = await bff.api.fetch<Sheet>(
        `/exams/${exam.id}/marks?classSectionId=${chosen.classSectionId}&subjectId=${chosen.subjectId}`,
      );
    } catch (error) {
      if (error instanceof ApiError) loadError = ERRORS[error.problem.type] ?? error.problem.type;
      else throw error;
    }
  }
  const stage = sheet?.status?.status ?? 'open';
  const locked =
    !!sheet && (sheet.exam.marksLocked || sheet.examSubject.entryLocked || stage !== 'open');
  const part = chosen?.partId
    ? ((sheet?.examSubject.parts ?? []).find((p) => p.id === chosen.partId) ?? null)
    : null;
  const others = part ? (sheet?.examSubject.parts ?? []).filter((p) => p.id !== part.id) : [];
  const takers = sheet ? sheet.rows.filter((r) => r.taken !== null) : [];
  const entered = takers.filter((r) => r.marks !== null || r.code || r.grade).length;
  const gradeOnly = !!sheet?.examSubject.gradeOnly && !part;
  const codes = (sheet?.codes ?? [{ code: 'AB', name: 'Absent' }]).filter(
    (c) => !part || c.code === 'AB',
  );
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Marks')}
        title={exam ? `${exam.name} (${exam.code})` : t(lang, 'Marks')}
        description={
          sheet
            ? `${sheet.section.code} · ${sheet.examSubject.name} ${gradeOnly ? t(lang, 'graded') : `${t(lang, 'out of')} ${sheet.examSubject.maxMarks}`}${sheet.examSubject.passMarks ? ` (${t(lang, 'pass')} ${sheet.examSubject.passMarks})` : ''} · ${entered} ${t(lang, 'of')} ${takers.length} ${t(lang, 'entered')}`
            : exams.length
              ? t(lang, 'Choose the section and subject.')
              : t(lang, 'No exam is set up for this year yet.')
        }
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail === 'submit'
            ? t(lang, 'Submitted for verification')
            : `${t(lang, 'Marks saved')}${sp.detail ? ` (${sp.detail})` : ''}`}
          .
        </div>
      ) : null}
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(lang, ERRORS[sp.error] ?? sp.error)}
          {sp.detail ? ` — ${sp.detail}` : ''}
        </div>
      ) : null}
      <Card style={{ marginBottom: 'var(--sp-3)' }}>
        <form
          method="get"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <label className="ep-field" style={{ minWidth: 220 }}>
            <span className="ep-field__label">{t(lang, 'Exam')}</span>
            <select className="ep-input" name="exam" defaultValue={exam?.id ?? ''}>
              {exams.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.code})
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" style={{ minWidth: 280 }}>
            <span className="ep-field__label">{t(lang, 'Section · subject')}</span>
            <select className="ep-input" name="pick" defaultValue={chosen?.value ?? ''}>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="secondary">
            {t(lang, 'Open sheet')}
          </Button>
        </form>
        <p className="ep-field__help" style={{ marginTop: 'var(--sp-2)' }}>
          {t(
            lang,
            'Leave a mark empty to skip a pupil; pick a code (AB absent, ML medical, EX exempt …) instead of marks. Marks are checked against the maximum and the lock before they are saved.',
          )}
        </p>
      </Card>
      {loadError ? <Card>{t(lang, loadError)}</Card> : null}
      {sheet && exam && chosen ? (
        <Card
          title={`${sheet.section.code} · ${sheet.examSubject.name}${part ? ` · ${part.name}` : ''}`}
          actions={
            locked ? (
              <Badge tone="warning">{t(lang, 'Locked')}</Badge>
            ) : (
              <Badge tone="neutral">
                {sheet.rows.length} {t(lang, 'pupils')}
              </Badge>
            )
          }
        >
          {part ? (
            <p className="ep-field__help">
              {sheet.examSubject.name} {t(lang, 'is entered in parts')}:{' '}
              {(sheet.examSubject.parts ?? [])
                .map((p) => `${p.name} ${String(Number(p.maxMarks))}`)
                .join(' + ')}{' '}
              = {String(Number(sheet.examSubject.maxMarks))}.{' '}
              {t(lang, 'The total is worked out from the parts.')}
            </p>
          ) : null}
          <form action={part ? savePartMarks : saveMarks}>
            {part ? <input type="hidden" name="partId" value={part.id} /> : null}
            <input type="hidden" name="examId" value={exam.id} />
            <input type="hidden" name="classSectionId" value={chosen.classSectionId} />
            <input type="hidden" name="subjectId" value={chosen.subjectId} />
            <input type="hidden" name="pick" value={chosen.value} />
            <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t(lang, 'Pupil')}</th>
                  <th>
                    {part
                      ? `${part.name} / ${String(Number(part.maxMarks))}`
                      : gradeOnly
                        ? t(lang, 'Grade')
                        : `${t(lang, 'Marks')} / ${sheet.examSubject.maxMarks}`}
                  </th>
                  <th>{t(lang, 'Code')}</th>
                  {part ? (
                    <th>
                      {t(lang, 'Total')} / {String(Number(sheet.examSubject.maxMarks))}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {sheet.rows.map((r) => (
                  <tr key={r.studentId}>
                    <td>{r.rollNo ?? ''}</td>
                    <td>
                      {r.name}
                      <div className="ep-kicker">{r.admissionNo}</div>
                    </td>
                    {r.taken === null ? (
                      <td colSpan={part ? 3 : 2}>
                        <span className="ep-field__help">
                          {t(lang, 'Does not take the subject')}
                        </span>
                      </td>
                    ) : (
                      <>
                        <td>
                          <input type="hidden" name="studentId" value={r.studentId} />
                          {gradeOnly ? (
                            <select
                              className="ep-input"
                              name={`grade-${r.studentId}`}
                              aria-label={`${t(lang, 'Grade')} · ${r.name}`}
                              defaultValue={r.grade ?? ''}
                              disabled={locked}
                            >
                              <option value="">-</option>
                              {(sheet.grades ?? []).map((g) => (
                                <option key={g} value={g}>
                                  {g}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              className="ep-input"
                              type="number"
                              inputMode="decimal"
                              name={`marks-${r.studentId}`}
                              aria-label={`${t(lang, 'Marks')} · ${r.name}`}
                              min={0}
                              max={Number(part ? part.maxMarks : sheet!.examSubject.maxMarks)}
                              step="0.5"
                              defaultValue={
                                part ? (r.parts?.[part.id]?.marks ?? '') : (r.marks ?? '')
                              }
                              disabled={locked}
                              style={{ width: 110 }}
                            />
                          )}
                        </td>
                        <td>
                          <select
                            className="ep-input"
                            name={`code-${r.studentId}`}
                            aria-label={`${t(lang, 'Code')} · ${r.name}`}
                            defaultValue={
                              part
                                ? r.parts?.[part.id]?.absent
                                  ? 'AB'
                                  : ''
                                : (r.code ?? (r.absent ? 'AB' : r.exempt ? 'EX' : ''))
                            }
                            disabled={locked}
                          >
                            <option value="">-</option>
                            {codes.map((c) => (
                              <option key={c.code} value={c.code}>
                                {c.code} · {c.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        {part ? (
                          <td>
                            {r.absent ? 'AB' : (r.marks ?? '—')}
                            <div className="ep-field__help">
                              {others
                                .map((o) => {
                                  const m = r.parts?.[o.id];
                                  return `${o.name} ${m ? (m.absent ? 'AB' : (m.marks ?? '—')) : '—'}`;
                                })
                                .join(' · ')}
                            </div>
                          </td>
                        ) : null}
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!locked ? (
              <div
                style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--sp-3)' }}
              >
                <Button type="submit">{t(lang, 'Save marks')}</Button>
              </div>
            ) : (
              <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
                {t(lang, 'This sheet is locked; the coordinator can reopen it.')}
              </p>
            )}
          </form>
          <div
            style={{
              display: 'flex',
              gap: 'var(--sp-3)',
              alignItems: 'center',
              flexWrap: 'wrap',
              marginTop: 'var(--sp-3)',
            }}
          >
            <Badge
              tone={
                stage === 'verified' ? 'success' : stage === 'submitted' ? 'warning' : 'neutral'
              }
            >
              {t(
                lang,
                stage === 'verified' ? 'Verified' : stage === 'submitted' ? 'Submitted' : 'Open',
              )}
            </Badge>
            {sheet.status?.remark ? (
              <span className="ep-field__help" style={{ margin: 0 }}>
                {sheet.status.remark}
              </span>
            ) : null}
            {stage === 'open' &&
            !sheet.exam.marksLocked &&
            !sheet.examSubject.entryLocked &&
            entered === takers.length &&
            takers.length > 0 ? (
              <form action={entryStep}>
                <input type="hidden" name="examId" value={exam.id} />
                <input type="hidden" name="classSectionId" value={chosen.classSectionId} />
                <input type="hidden" name="subjectId" value={chosen.subjectId} />
                <input type="hidden" name="action" value="submit" />
                <input
                  type="hidden"
                  name="back"
                  value={`/marks?exam=${exam.id}&pick=${encodeURIComponent(chosen.value)}`}
                />
                <Button type="submit" variant="secondary">
                  {t(lang, 'Submit for verification')}
                </Button>
              </form>
            ) : stage === 'open' ? (
              <span className="ep-field__help" style={{ margin: 0 }}>
                {t(lang, 'Submit once every pupil has marks or a code.')}
              </span>
            ) : null}
          </div>
        </Card>
      ) : null}
    </main>
  );
}
