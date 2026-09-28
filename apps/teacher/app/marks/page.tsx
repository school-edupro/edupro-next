import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { saveMarks } from './actions';

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
  }>;
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
  };
  section: { id: string; code: string };
  rows: Array<{
    studentId: string;
    name: string;
    admissionNo: string;
    rollNo: number | null;
    marks: string | null;
    absent: boolean;
    exempt: boolean;
  }>;
}
const ERRORS: Record<string, string> = {
  'exams.entry_locked': 'Entry for this subject is locked; ask the coordinator to reopen it.',
  'exams.marks_out_of_range': 'A mark is above the maximum for this subject.',
  'exams.not_assigned': 'You are not assigned to this section or subject.',
  'exams.student_not_in_section': 'A student in the sheet is no longer in this section; reload.',
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
  let exams: Exam[];
  try {
    exams = await bff.api.fetch<{ data: Exam[] }>('/exams').then((r) => r.data);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title="Marks" />
          <Card>You are not allowed to enter marks in this school.</Card>
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
  const options = sections.flatMap((s) =>
    s.subjects.map((sub) => ({
      value: `${s.classSectionId}|${sub.subjectId}`,
      label: `${s.code} · ${sub.name}${sub.entryLocked ? ' (locked)' : ''} · ${sub.entered} entered`,
      classSectionId: s.classSectionId,
      subjectId: sub.subjectId,
    })),
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
  const locked = !!sheet && (sheet.exam.marksLocked || sheet.examSubject.entryLocked);
  const entered = sheet
    ? sheet.rows.filter((r) => r.marks !== null || r.absent || r.exempt).length
    : 0;
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <PageHeader
        kicker="Marks"
        title={exam ? `${exam.name} (${exam.code})` : 'Marks'}
        description={
          sheet
            ? `${sheet.section.code} · ${sheet.examSubject.name} out of ${sheet.examSubject.maxMarks}${sheet.examSubject.passMarks ? ` (pass ${sheet.examSubject.passMarks})` : ''} · ${entered} of ${sheet.rows.length} entered`
            : exams.length
              ? 'Choose the section and subject.'
              : 'No exam is set up for this year yet.'
        }
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            Home
          </a>
        }
      />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          Marks saved{sp.detail ? ` (${sp.detail})` : ''}.
        </div>
      ) : null}
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {ERRORS[sp.error] ?? sp.error}
          {sp.detail ? ` — ${sp.detail}` : ''}
        </div>
      ) : null}
      <Card style={{ marginBottom: 'var(--sp-3)' }}>
        <form
          method="get"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <label className="ep-field" style={{ minWidth: 220 }}>
            <span className="ep-field__label">Exam</span>
            <select className="ep-input" name="exam" defaultValue={exam?.id ?? ''}>
              {exams.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.code})
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" style={{ minWidth: 280 }}>
            <span className="ep-field__label">Section · subject</span>
            <select className="ep-input" name="pick" defaultValue={chosen?.value ?? ''}>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="secondary">
            Open sheet
          </Button>
        </form>
        <p className="ep-field__help" style={{ marginTop: 'var(--sp-2)' }}>
          Leave a mark empty to skip a pupil; tick AB for absent or EX for exempt. Marks are checked
          against the maximum and the lock before they are saved.
        </p>
      </Card>
      {loadError ? <Card>{loadError}</Card> : null}
      {sheet && exam && chosen ? (
        <Card
          title={`${sheet.section.code} · ${sheet.examSubject.name}`}
          actions={
            locked ? (
              <Badge tone="warning">Locked</Badge>
            ) : (
              <Badge tone="neutral">{sheet.rows.length} pupils</Badge>
            )
          }
        >
          <form action={saveMarks}>
            <input type="hidden" name="examId" value={exam.id} />
            <input type="hidden" name="classSectionId" value={chosen.classSectionId} />
            <input type="hidden" name="subjectId" value={chosen.subjectId} />
            <input type="hidden" name="pick" value={chosen.value} />
            <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Pupil</th>
                  <th>Marks / {sheet.examSubject.maxMarks}</th>
                  <th>AB</th>
                  <th>EX</th>
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
                    <td>
                      <input
                        className="ep-input"
                        type="number"
                        inputMode="decimal"
                        name={`marks-${r.studentId}`}
                        aria-label={`Marks · ${r.name}`}
                        min={0}
                        max={Number(sheet!.examSubject.maxMarks)}
                        step="0.5"
                        defaultValue={r.marks ?? ''}
                        disabled={locked}
                        style={{ width: 110 }}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        name={`absent-${r.studentId}`}
                        aria-label={`Absent · ${r.name}`}
                        defaultChecked={r.absent}
                        disabled={locked}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        name={`exempt-${r.studentId}`}
                        aria-label={`Exempt · ${r.name}`}
                        defaultChecked={r.exempt}
                        disabled={locked}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!locked ? (
              <div
                style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--sp-3)' }}
              >
                <Button type="submit">Save marks</Button>
              </div>
            ) : (
              <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
                This sheet is locked; the coordinator can reopen it.
              </p>
            )}
          </form>
        </Card>
      ) : null}
    </main>
  );
}
