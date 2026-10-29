import { Badge, Breadcrumbs, Button, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import { countExamAttendance, saveExamAttendance } from '@/lib/remark-actions';
import type { Exam } from '@/lib/types';

interface Register {
  exam: { marksLocked: boolean };
  section: { id: string; code: string };
  rows: Array<{
    studentId: string;
    name: string;
    admissionNo: string;
    rollNo: number | null;
    daysPresent: number | null;
    daysTotal: number | null;
  }>;
}

/**
 * Exam attendance of a section (docs/design/65): counted from daily attendance between two dates, and
 * corrected here by the office or the class teacher. It prints on the report card.
 */
export default async function ExamAttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ section?: string; ok?: string; error?: string; detail?: string }>;
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
  const sections = await apiFetch<{ data: Array<{ classSectionId: string; section: string }> }>(
    `/exams/${id}/entry-status`,
  )
    .then((r) => [...new Map(r.data.map((x) => [x.classSectionId, x.section])).entries()])
    .catch(() => [] as Array<[string, string]>);
  const sectionId = sections.find(([sid]) => sid === sp.section)?.[0] ?? sections[0]?.[0];
  const reg = sectionId
    ? await apiFetch<Register>(`/exams/${id}/register?classSectionId=${sectionId}`)
    : null;
  const klass = exam.classes.find((k) =>
    reg ? reg.section.code.startsWith(`${k.classCode}-`) : false,
  );
  const locked = !!reg && (reg.exam.marksLocked || Boolean(klass?.locks?.attendance));
  const canEnter = me.permissions.includes('exams.attendance.enter');
  const open = canEnter && !locked;
  const back = `/exams/${id}/attendance${sectionId ? `?section=${sectionId}` : ''}`;
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Exams', href: '/exams' },
          { label: exam.name, href: `/exams/${exam.id}` },
          { label: 'Exam attendance' },
        ]}
      />
      <PageHeader
        kicker={`Exams · ${exam.code}`}
        title={`Exam attendance · ${exam.name}`}
        description="Count it from daily attendance (late, half day, on duty, stay back and short leave count as present), then correct any student. It prints on the report card."
      />
      <Notice params={sp} />
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <form
          method="get"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <label className="ep-field" style={{ minWidth: 200 }}>
            <span className="ep-field__label">Section</span>
            <select className="ep-select" name="section" defaultValue={sectionId}>
              {sections.map(([sid, code]) => (
                <option key={sid} value={sid}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="secondary">
            Open
          </Button>
        </form>
      </Card>
      {reg ? (
        <>
          {open ? (
            <Card
              elevated
              title="Count from daily attendance"
              style={{ marginBottom: 'var(--sp-4)' }}
            >
              <form
                action={countExamAttendance}
                style={{
                  display: 'flex',
                  gap: 'var(--sp-3)',
                  alignItems: 'flex-end',
                  flexWrap: 'wrap',
                }}
              >
                <input type="hidden" name="examId" value={exam.id} />
                <input type="hidden" name="classSectionId" value={reg.section.id} />
                <input type="hidden" name="back" value={back} />
                <label className="ep-field">
                  <span className="ep-field__label">From (empty: the start of the session)</span>
                  <input className="ep-input" type="date" name="from" />
                </label>
                <label className="ep-field">
                  <span className="ep-field__label">To (empty: the exam&rsquo;s last day)</span>
                  <input className="ep-input" type="date" name="to" />
                </label>
                <label className="ep-check" htmlFor="att-overwrite">
                  <input
                    id="att-overwrite"
                    className="ep-check__input"
                    type="checkbox"
                    name="overwrite"
                  />
                  <span className="ep-check__box" aria-hidden="true" /> Replace what is entered
                </label>
                <Button type="submit" variant="secondary">
                  Count
                </Button>
              </form>
            </Card>
          ) : null}
          <Card
            elevated
            title={reg.section.code}
            actions={
              locked ? (
                <Badge tone="warning">Locked</Badge>
              ) : (
                <Badge tone="neutral">{reg.rows.length} students</Badge>
              )
            }
          >
            <form action={saveExamAttendance}>
              <input type="hidden" name="examId" value={exam.id} />
              <input type="hidden" name="classSectionId" value={reg.section.id} />
              <input type="hidden" name="back" value={back} />
              <div
                className="ep-table-wrap"
                tabIndex={0}
                role="region"
                aria-label="Exam attendance"
              >
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">Exam attendance</caption>
                  <thead>
                    <tr>
                      <th scope="col">Roll</th>
                      <th scope="col">Student</th>
                      <th scope="col">Days present</th>
                      <th scope="col">Working days</th>
                      <th scope="col" className="is-numeric">
                        %
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {reg.rows.map((r) => (
                      <tr key={r.studentId}>
                        <td>{r.rollNo ?? ''}</td>
                        <td>
                          <input type="hidden" name="studentId" value={r.studentId} />
                          {r.name}
                          <span className="ep-kicker" style={{ display: 'block' }}>
                            {r.admissionNo}
                          </span>
                        </td>
                        <td>
                          <input
                            className="ep-input"
                            type="number"
                            min={0}
                            max={400}
                            name={`p-${r.studentId}`}
                            aria-label={`Days present · ${r.name}`}
                            defaultValue={r.daysPresent ?? ''}
                            disabled={!open}
                            style={{ width: 110 }}
                          />
                        </td>
                        <td>
                          <input
                            className="ep-input"
                            type="number"
                            min={1}
                            max={400}
                            name={`t-${r.studentId}`}
                            aria-label={`Working days · ${r.name}`}
                            defaultValue={r.daysTotal ?? ''}
                            disabled={!open}
                            style={{ width: 110 }}
                          />
                        </td>
                        <td className="is-numeric">
                          {r.daysPresent !== null && r.daysTotal
                            ? `${String(Math.round((r.daysPresent * 1000) / r.daysTotal) / 10)}`
                            : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {open ? (
                <div className="ep-form-actions" style={{ marginTop: 'var(--sp-3)' }}>
                  <Button type="submit">Save exam attendance</Button>
                </div>
              ) : (
                <p className="ep-field__help">
                  {locked
                    ? 'Attendance is locked for the class in this exam; open it on the exam page.'
                    : 'You may view this only (the exam attendance right).'}
                </p>
              )}
            </form>
          </Card>
        </>
      ) : null}
    </>
  );
}
