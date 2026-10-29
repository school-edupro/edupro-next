import { Badge, Breadcrumbs, Button, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import {
  EntryStatusActions,
  EntryStatusBadge,
  type EntryStatus,
} from '@/components/exams/EntryStatusActions';
import { ExcelUpload } from '@/components/exams/ExcelUpload';
import { Notice } from '@/components/Notice';
import { saveExamMarks, saveExamPartMarks, uploadExamMarks } from '@/lib/exam-entry-actions';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { Exam } from '@/lib/types';

interface Part {
  id: string;
  name: string;
  maxMarks: string;
  mine: boolean;
}
interface EntrySection {
  classSectionId: string;
  code: string;
  subjects: Array<{
    subjectId: string;
    code: string;
    name: string;
    maxMarks: string;
    entryLocked: boolean;
    entered: number;
    parts?: Part[];
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
    gradeOnly: boolean;
    parts: Part[];
  };
  section: { id: string; code: string };
  codes: Array<{ code: string; name: string }>;
  grades: string[];
  status: EntryStatus;
  rows: Array<{
    studentId: string;
    name: string;
    admissionNo: string;
    rollNo: number | null;
    parts: Record<string, { marks: string | null; absent: boolean }>;
    marks: string | null;
    code: string | null;
    grade: string | null;
    taken: string | null;
  }>;
}

const KIND: Record<string, string> = { optional: 'Optional', additional: 'Additional' };
const n = (v: string) => String(Number(v));

/**
 * Marks entry in the admin app (docs/design/65): any section and subject of the exam, a mark (or a
 * grade for a grade-only subject) or a marks code per student, part by part for a subject in parts;
 * students who do not take the subject are shown but not entered; Excel download and upload.
 */
export default async function ExamMarksPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ pick?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('exams.marks.view')) notFound();
  const exam = await apiFetch<Exam>(`/exams/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const sections = await apiFetch<{ data: EntrySection[] }>(`/exams/${id}/entry/sections`)
    .then((r) => r.data)
    .catch(() => [] as EntrySection[]);
  const options = sections.flatMap((s) =>
    s.subjects.flatMap((sub) =>
      (sub.parts ?? []).length
        ? (sub.parts ?? []).map((p) => ({
            value: `${s.classSectionId}|${sub.subjectId}|${p.id}`,
            label: `${s.code} · ${sub.name} · ${p.name} (${n(p.maxMarks)})`,
            classSectionId: s.classSectionId,
            subjectId: sub.subjectId,
            partId: p.id as string | null,
          }))
        : [
            {
              value: `${s.classSectionId}|${sub.subjectId}`,
              label: `${s.code} · ${sub.name}${Number(sub.maxMarks) === 0 ? ' (grade)' : ''} · ${String(sub.entered)} entered${sub.entryLocked ? ' · locked' : ''}`,
              classSectionId: s.classSectionId,
              subjectId: sub.subjectId,
              partId: null as string | null,
            },
          ],
    ),
  );
  const chosen = options.find((o) => o.value === sp.pick) ?? options[0];
  const sheet = chosen
    ? await apiFetch<Sheet>(
        `/exams/${id}/marks?classSectionId=${chosen.classSectionId}&subjectId=${chosen.subjectId}`,
      )
    : null;
  const canEnter = me.permissions.includes('exams.marks.enter');
  // submitted or verified marks are closed too (docs/design/65, part 2)
  const locked =
    !!sheet &&
    (sheet.exam.marksLocked || sheet.examSubject.entryLocked || sheet.status.status !== 'open');
  const verifier = chosen
    ? await apiFetch<{
        data: Array<{ classSectionId: string; subjectId: string; canVerify: boolean }>;
      }>(`/exams/${id}/entry-status`)
        .then(
          (x) =>
            x.data.find(
              (y) => y.classSectionId === chosen.classSectionId && y.subjectId === chosen.subjectId,
            )?.canVerify ?? false,
        )
        .catch(() => false)
    : false;
  const part = chosen?.partId
    ? (sheet?.examSubject.parts.find((p) => p.id === chosen.partId) ?? null)
    : null;
  const es = sheet?.examSubject;
  const max = part ? part.maxMarks : (es?.maxMarks ?? '0');
  const taken = sheet?.rows.filter((r) => r.taken) ?? [];
  const entered = taken.filter((r) =>
    part ? r.parts[part.id] : r.marks !== null || r.code || r.grade,
  ).length;
  const backTo = `/exams/${id}/marks?pick=${encodeURIComponent(chosen?.value ?? '')}`;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Exams', href: '/exams' },
          { label: exam.name, href: `/exams/${exam.id}` },
          { label: 'Marks entry' },
        ]}
      />
      <PageHeader
        kicker={`Exams · ${exam.code}`}
        title={`Marks entry · ${exam.name}`}
        description={
          sheet && es
            ? `${sheet.section.code} · ${es.name}${part ? ` · ${part.name}` : ''} · ${es.gradeOnly ? 'graded' : `out of ${n(max)}`}${es.passMarks && !part ? ` (pass ${n(es.passMarks)})` : ''} · ${String(entered)} of ${String(taken.length)} entered`
            : 'Choose the section and subject.'
        }
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/exams/subject-choices">
              Subject choices
            </a>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/exams/${exam.id}`}>
              The exam
            </a>
          </span>
        }
      />
      <Notice params={sp} />
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <form
          method="get"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <label className="ep-field" style={{ minWidth: 320 }}>
            <span className="ep-field__label">Section · subject</span>
            <select className="ep-select" name="pick" defaultValue={chosen?.value ?? ''}>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="secondary">
            Open the sheet
          </Button>
        </form>
        <p className="ep-field__help" style={{ marginBottom: 0 }}>
          Write the marks, or pick a code instead:{' '}
          {sheet?.codes.map((c) => `${c.code} ${c.name}`).join(', ')}. A grade-only subject takes a
          grade of its scale. Empty rows are skipped.
        </p>
      </Card>
      {!options.length ? (
        <Card>
          <p style={{ margin: 0 }}>
            The exam has no class with subjects yet: add the subjects on the exam page.
          </p>
        </Card>
      ) : null}
      {sheet && es && chosen ? (
        <div className="ep-rp">
          <Card
            elevated
            title={`${sheet.section.code} · ${es.name}${part ? ` · ${part.name}` : ''}`}
            actions={
              sheet.exam.marksLocked || es.entryLocked ? (
                <Badge tone="warning">Locked</Badge>
              ) : (
                <Badge tone="neutral">{taken.length} students</Badge>
              )
            }
          >
            <div
              style={{
                display: 'flex',
                gap: 'var(--sp-3)',
                alignItems: 'center',
                flexWrap: 'wrap',
                marginBottom: 'var(--sp-3)',
              }}
            >
              <EntryStatusBadge s={sheet.status} />
              <EntryStatusActions
                examId={exam.id}
                classSectionId={chosen.classSectionId}
                subjectId={chosen.subjectId}
                status={sheet.status.status}
                back={backTo}
                missing={
                  taken.length -
                  (part
                    ? taken.filter((r) => r.marks !== null || r.code || r.grade).length
                    : entered)
                }
                canSubmit={canEnter && !sheet.exam.marksLocked && !es.entryLocked}
                canVerify={verifier}
                canReopen={me.permissions.includes('exams.marks.unlock')}
              />
            </div>
            <form action={part ? saveExamPartMarks : saveExamMarks}>
              <input type="hidden" name="examId" value={exam.id} />
              <input type="hidden" name="classSectionId" value={chosen.classSectionId} />
              <input type="hidden" name="subjectId" value={chosen.subjectId} />
              {part ? <input type="hidden" name="partId" value={part.id} /> : null}
              <input type="hidden" name="back" value={backTo} />
              <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Marks">
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">Marks</caption>
                  <thead>
                    <tr>
                      <th scope="col">Roll</th>
                      <th scope="col">Student</th>
                      <th scope="col">{es.gradeOnly ? 'Grade' : `Marks / ${n(max)}`}</th>
                      <th scope="col">Code</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.rows.map((r) => {
                      const pm = part ? r.parts[part.id] : undefined;
                      const code = part ? (pm?.absent ? 'AB' : '') : (r.code ?? '');
                      return (
                        <tr key={r.studentId}>
                          <td>{r.rollNo ?? ''}</td>
                          <td>
                            {r.name}
                            <span className="ep-kicker" style={{ display: 'block' }}>
                              {r.admissionNo}
                              {r.taken && KIND[r.taken] ? ` · ${KIND[r.taken]}` : ''}
                            </span>
                          </td>
                          {!r.taken ? (
                            <td colSpan={2}>
                              <span className="ep-field__help" style={{ margin: 0 }}>
                                Does not take {es.name}
                              </span>
                            </td>
                          ) : (
                            <>
                              <td>
                                <input type="hidden" name="studentId" value={r.studentId} />
                                {es.gradeOnly ? (
                                  <select
                                    className="ep-select"
                                    name={`g-${r.studentId}`}
                                    aria-label={`Grade · ${r.name}`}
                                    defaultValue={r.grade ?? ''}
                                    disabled={locked || !canEnter}
                                  >
                                    <option value="">-</option>
                                    {sheet.grades.map((g) => (
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
                                    name={`v-${r.studentId}`}
                                    aria-label={`Marks · ${r.name}`}
                                    min={0}
                                    max={Number(max)}
                                    step="0.5"
                                    defaultValue={part ? (pm?.marks ?? '') : (r.marks ?? '')}
                                    disabled={locked || !canEnter}
                                    style={{ width: 110 }}
                                  />
                                )}
                              </td>
                              <td>
                                <select
                                  className="ep-select"
                                  name={`c-${r.studentId}`}
                                  aria-label={`Code · ${r.name}`}
                                  defaultValue={code}
                                  disabled={locked || !canEnter}
                                >
                                  <option value="">-</option>
                                  {(part
                                    ? sheet.codes.filter((c) => c.code === 'AB')
                                    : sheet.codes
                                  ).map((c) => (
                                    <option key={c.code} value={c.code}>
                                      {c.code} · {c.name}
                                    </option>
                                  ))}
                                </select>
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {canEnter && !locked ? (
                <div className="ep-form-actions" style={{ marginTop: 'var(--sp-3)' }}>
                  <Button type="submit">Save marks</Button>
                </div>
              ) : (
                <p className="ep-field__help">
                  {sheet.status.status !== 'open'
                    ? 'The marks are submitted or verified: the verifier sends them back (or one with the unlock right reopens them) before they change.'
                    : locked
                      ? 'Entry is locked for this subject; open it on the exam page.'
                      : 'You may view these marks only: they are entered by the teachers or the exam office (the marks entry right); admins open and lock entry.'}
                </p>
              )}
            </form>
          </Card>
          <Card elevated title="Excel">
            <p style={{ marginTop: 0 }}>
              Download the sheet with the students who take {es.name}, fill the marks or codes, and
              upload it here: every row is checked before anything is saved.
            </p>
            <p>
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/api/exam-marks/excel?examId=${exam.id}&classSectionId=${chosen.classSectionId}&subjectId=${chosen.subjectId}`}
              >
                Download the marks sheet
              </a>
            </p>
            {canEnter && !locked ? (
              <ExcelUpload
                label="Upload the filled sheet"
                upload={uploadExamMarks.bind(
                  null,
                  exam.id,
                  chosen.classSectionId,
                  chosen.subjectId,
                )}
              />
            ) : null}
          </Card>
        </div>
      ) : null}
    </>
  );
}
