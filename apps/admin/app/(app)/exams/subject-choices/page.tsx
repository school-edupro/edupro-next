import { Breadcrumbs, Button, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { ExcelUpload } from '@/components/exams/ExcelUpload';
import { Notice } from '@/components/Notice';
import {
  fillSubjectChoices,
  saveSubjectChoices,
  uploadSubjectChoices,
} from '@/lib/exam-entry-actions';
import { apiFetch, getMe } from '@/lib/api';

interface Choices {
  section: { id: string; code: string; classId: string };
  subjects: Array<{ id: string; code: string; name: string; elective: boolean }>;
  rows: Array<{
    studentId: string;
    name: string;
    admissionNo: string;
    rollNo: number | null;
    stream: string | null;
    subjects: Array<{ subjectId: string; kind: string }>;
  }>;
  withChoices: number;
}

const KINDS = [
  ['', '-'],
  ['compulsory', 'C'],
  ['optional', 'O'],
  ['additional', 'A'],
] as const;

/**
 * Each student's subjects for the year (docs/design/65): C compulsory, O optional, A additional (shown on
 * the card, kept out of the total). A student without choices takes every subject; marks open only for a
 * student's own subjects once choices are recorded.
 */
export default async function SubjectChoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ sectionId?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('exams.marks.view')) notFound();
  const canManage = me.permissions.includes('exams.master.manage');
  const sections = await apiFetch<{ data: Array<{ id: string; code: string; students: number }> }>(
    '/exams/subject-choices/sections',
  )
    .then((r) => r.data)
    .catch(() => []);
  const sectionId = sections.find((s) => s.id === sp.sectionId)?.id ?? sections[0]?.id ?? '';
  const data = sectionId
    ? await apiFetch<Choices>(`/exams/subject-choices?classSectionId=${sectionId}`)
    : null;
  return (
    <>
      <Breadcrumbs items={[{ label: 'Exams', href: '/exams' }, { label: 'Subject choices' }]} />
      <PageHeader
        kicker="Exams"
        title="Subject choices"
        description="Each student's subjects for the year: C compulsory, O optional, A additional (the sixth subject, AI, IFM: shown on the card, kept out of the total). A student with no choices takes every subject."
      />
      <Notice params={sp} />
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <form
          method="get"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <label className="ep-field" style={{ minWidth: 240 }}>
            <span className="ep-field__label">Section</span>
            <select className="ep-select" name="sectionId" defaultValue={sectionId}>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} ({s.students})
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="secondary">
            Show
          </Button>
        </form>
      </Card>
      {data ? (
        <div className="ep-rp">
          <Card
            elevated
            title={`${data.section.code} · ${String(data.withChoices)} of ${String(data.rows.length)} with choices`}
          >
            {!data.subjects.length ? (
              <p style={{ marginTop: 0 }}>
                The class has no subjects yet: set them under Academics → Subjects, or add them to
                an exam.
              </p>
            ) : (
              <form action={saveSubjectChoices}>
                <input type="hidden" name="classSectionId" value={data.section.id} />
                {data.subjects.map((x) => (
                  <input key={x.id} type="hidden" name="subjectId" value={x.id} />
                ))}
                <div
                  className="ep-table-wrap"
                  tabIndex={0}
                  role="region"
                  aria-label="Subject choices"
                >
                  <table className="ep-table ep-table--dense">
                    <caption className="ep-sr-only">Subject choices</caption>
                    <thead>
                      <tr>
                        <th scope="col">Student</th>
                        <th scope="col">Stream</th>
                        {data.subjects.map((x) => (
                          <th key={x.id} scope="col" title={x.name}>
                            {x.code}
                            {x.elective ? ' *' : ''}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((r) => (
                        <tr key={r.studentId}>
                          <td>
                            <input type="hidden" name="studentId" value={r.studentId} />
                            {r.name}
                            <span className="ep-kicker" style={{ display: 'block' }}>
                              {r.admissionNo}
                              {r.subjects.length ? '' : ' · every subject'}
                            </span>
                          </td>
                          <td>
                            <input
                              className="ep-input"
                              name={`stream-${r.studentId}`}
                              aria-label={`Stream · ${r.name}`}
                              maxLength={40}
                              defaultValue={r.stream ?? ''}
                              disabled={!canManage}
                              style={{ width: 110 }}
                            />
                          </td>
                          {data.subjects.map((x) => (
                            <td key={x.id}>
                              <select
                                className="ep-select"
                                name={`k-${r.studentId}-${x.id}`}
                                aria-label={`${x.name} · ${r.name}`}
                                defaultValue={
                                  r.subjects.find((v) => v.subjectId === x.id)?.kind ?? ''
                                }
                                disabled={!canManage}
                              >
                                {KINDS.map(([v, l]) => (
                                  <option key={v} value={v}>
                                    {l}
                                  </option>
                                ))}
                              </select>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="ep-field__help">
                  * elective in the class. Leave every subject of a student at “-” to clear the
                  choices (the student then takes every subject).
                </p>
                {canManage ? (
                  <div className="ep-form-actions">
                    <Button type="submit">Save the choices</Button>
                  </div>
                ) : null}
              </form>
            )}
          </Card>
          <Card elevated title="Quick ways">
            {canManage ? (
              <form action={fillSubjectChoices} style={{ marginBottom: 'var(--sp-4)' }}>
                <input type="hidden" name="classSectionId" value={data.section.id} />
                <p style={{ marginTop: 0 }}>
                  Give every student without choices the class&rsquo;s compulsory subjects; then
                  change only those who take optional or additional ones.
                </p>
                <Button type="submit" variant="secondary">
                  Fill the class&rsquo;s subjects
                </Button>
              </form>
            ) : null}
            <p>
              <a
                className="ep-btn ep-btn--secondary ep-btn--sm"
                href={`/api/subject-choices/excel?classSectionId=${data.section.id}`}
              >
                Download as Excel
              </a>
            </p>
            {canManage ? (
              <ExcelUpload
                label="Upload the filled sheet"
                upload={uploadSubjectChoices.bind(null, data.section.id)}
              />
            ) : null}
          </Card>
        </div>
      ) : (
        <Card>
          <p style={{ margin: 0 }}>No section in the working year.</p>
        </Card>
      )}
    </>
  );
}
