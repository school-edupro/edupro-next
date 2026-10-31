import { Alert, Breadcrumbs, Button, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { AutoSubmit } from '@/components/AutoSubmit';
import { FileLinks } from '@/components/FileLinks';
import { Notice } from '@/components/Notice';
import {
  ChoicesSheet,
  type ChoiceGroup,
  type ChoiceStream,
  type ChoiceSubject,
} from '@/components/exams/ChoicesSheet';
import { ClassSubjectSetup } from '@/components/exams/ClassSubjectSetup';
import { ExcelUpload } from '@/components/exams/ExcelUpload';
import {
  fillSubjectChoices,
  lastYearChoices,
  uploadSubjectChoices,
} from '@/lib/exam-entry-actions';
import { apiFetch, getMe } from '@/lib/api';

interface Section {
  id: string;
  code: string;
  classId: string;
  classCode: string;
  className: string;
  students: number;
  canEdit: boolean;
}
interface Setup {
  fromExams: boolean;
  placed: boolean;
  subjects: Array<ChoiceSubject & { order: number | null }>;
  groups: ChoiceGroup[];
  streams: ChoiceStream[];
}
interface Choices extends Setup {
  section: { id: string; code: string; classId: string; className: string };
  rows: Array<{
    studentId: string;
    name: string;
    admissionNo: string;
    rollNo: number | null;
    stream: string | null;
    subjects: Array<{ subjectId: string; kind: string }>;
    marked: string[];
  }>;
  withChoices: number;
  canEdit: boolean;
  canSetUp: boolean;
}
interface Counts {
  class: { id: string; code: string; name: string };
  subjects: ChoiceSubject[];
  groups: ChoiceGroup[];
  sections: Array<{
    id: string;
    code: string;
    students: number;
    notSet: number;
    counts: Record<string, number>;
  }>;
  total: { students: number; notSet: number; counts: Record<string, number> };
}
type Tab = 'students' | 'setup' | 'counts';

/**
 * Each student's subjects for the year and the class's subject order (docs/design/65, 67). Students:
 * a column per choice group, the stream and the other electives, with bulk setting, counts and Excel.
 * Class set-up: the order printed on cards and the register, who takes each subject, choice groups
 * and streams. Counts: students per subject, section by section (Excel, PDF).
 */
export default async function SubjectChoicesPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    sectionId?: string;
    classId?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('exams.marks.view')) notFound();
  const tab: Tab = sp.tab === 'setup' || sp.tab === 'counts' ? sp.tab : 'students';
  const sections = await apiFetch<{ data: Section[] }>('/exams/subject-choices/sections')
    .then((r) => r.data)
    .catch(() => [] as Section[]);
  const classes = [
    ...new Map(sections.map((s) => [s.classId, { id: s.classId, name: s.className }])).values(),
  ];
  const section = sections.find((s) => s.id === sp.sectionId) ?? sections[0];
  const classId =
    classes.find((k) => k.id === sp.classId)?.id ?? section?.classId ?? classes[0]?.id ?? '';
  const base = (t: Tab) =>
    `/exams/subject-choices?tab=${t}${t === 'students' ? (section ? `&sectionId=${section.id}` : '') : classId ? `&classId=${classId}` : ''}`;
  const choices =
    tab === 'students' && section
      ? await apiFetch<Choices>(`/exams/subject-choices?classSectionId=${section.id}`)
      : null;
  const setup =
    tab === 'setup' && classId
      ? await apiFetch<Setup>(`/exams/subject-choices/setup?classId=${classId}`)
      : null;
  const counts =
    tab === 'counts' && classId
      ? await apiFetch<Counts>(`/exams/subject-choices/counts?classId=${classId}`)
      : null;
  const canSetUp = me.permissions.includes('exams.master.manage');

  const picker =
    tab === 'students' ? (
      <label className="ep-field" style={{ minWidth: '15rem' }}>
        <span className="ep-field__label">Section</span>
        <select className="ep-select" name="sectionId" defaultValue={section?.id ?? ''}>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} ({s.students})
            </option>
          ))}
        </select>
      </label>
    ) : (
      <label className="ep-field" style={{ minWidth: '15rem' }}>
        <span className="ep-field__label">Class</span>
        <select className="ep-select" name="classId" defaultValue={classId}>
          {classes.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
        </select>
      </label>
    );

  return (
    <>
      <Breadcrumbs items={[{ label: 'Exams', href: '/exams' }, { label: 'Subject choices' }]} />
      <PageHeader
        kicker="Exams"
        title="Subject choices"
        description="Each student's subjects for the year, and the order the class's subjects print in on report cards and the mark register."
      />
      <Notice params={sp} />
      <nav aria-label="Subject choices" style={{ marginBottom: 'var(--sp-3)' }}>
        <ul className="ep-xchips">
          {(
            [
              ['students', 'Students'],
              ['setup', 'Class set-up (order, groups, streams)'],
              ['counts', 'Counts'],
            ] as Array<[Tab, string]>
          ).map(([t, label]) => (
            <li key={t} style={{ padding: 0, border: 0, background: 'none' }}>
              <a href={base(t)} aria-current={t === tab ? 'page' : undefined}>
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {!sections.length ? (
        <Card>
          <p style={{ margin: 0 }}>No section in the working year.</p>
        </Card>
      ) : (
        <>
          <Card style={{ marginBottom: 'var(--sp-4)' }}>
            <form
              method="get"
              style={{
                display: 'flex',
                gap: 'var(--sp-3)',
                alignItems: 'flex-end',
                flexWrap: 'wrap',
              }}
            >
              <input type="hidden" name="tab" value={tab} />
              {picker}
              <AutoSubmit />
              <noscript>
                <Button type="submit" variant="secondary">
                  Show
                </Button>
              </noscript>
            </form>
          </Card>

          {choices ? (
            <div className="ep-rp">
              <Card
                elevated
                title={`${choices.section.code} · ${String(choices.withChoices)} of ${String(choices.rows.length)} with choices`}
              >
                {choices.fromExams ? (
                  <Alert tone="info">
                    {choices.section.className} has no subjects mapped this year: its exams&rsquo;
                    subjects are shown; tick each student&rsquo;s. Set the class&rsquo;s subjects
                    under{' '}
                    <a href="/masters/academics?tab=class_subjects">
                      Masters → Class and subject mapping
                    </a>{' '}
                    to use groups, streams and the class&rsquo;s order.
                  </Alert>
                ) : !choices.placed && canSetUp ? (
                  <Alert tone="info">
                    The class&rsquo;s subjects print in the subject master&rsquo;s order until you
                    set its own under <a href={base('setup')}>Class set-up</a>.
                  </Alert>
                ) : null}
                {!choices.subjects.length ? (
                  <p>
                    The class has no subjects yet: map them under Masters → Class and subject
                    mapping, or add them to an exam.
                  </p>
                ) : (
                  <ChoicesSheet
                    classSectionId={choices.section.id}
                    subjects={choices.subjects}
                    groups={choices.groups}
                    streams={choices.streams}
                    canEdit={choices.canEdit}
                    rows={choices.rows.map((r) => ({
                      studentId: r.studentId,
                      name: r.name,
                      admissionNo: r.admissionNo,
                      rollNo: r.rollNo,
                      stream: r.stream,
                      subjectIds: r.subjects.map((x) => x.subjectId),
                      marked: r.marked,
                    }))}
                  />
                )}
              </Card>
              <Card elevated title="Quick ways">
                {choices.canEdit ? (
                  <>
                    <form action={lastYearChoices} style={{ marginBottom: 'var(--sp-4)' }}>
                      <input type="hidden" name="classSectionId" value={choices.section.id} />
                      <p style={{ marginTop: 0 }}>
                        Students without choices take their last year&rsquo;s subjects and stream
                        (class XII from XI).
                      </p>
                      <Button type="submit" variant="secondary" size="sm">
                        Bring last year&rsquo;s choices
                      </Button>
                    </form>
                    {choices.subjects.some((x) => x.take === 'all') ? (
                      <form action={fillSubjectChoices} style={{ marginBottom: 'var(--sp-4)' }}>
                        <input type="hidden" name="classSectionId" value={choices.section.id} />
                        <p style={{ marginTop: 0 }}>
                          Students without choices take only the compulsory subjects.
                        </p>
                        <Button type="submit" variant="secondary" size="sm">
                          Give them the compulsory subjects
                        </Button>
                      </form>
                    ) : null}
                  </>
                ) : (
                  <p style={{ marginTop: 0 }}>
                    The office or the section&rsquo;s class teacher sets the choices.
                  </p>
                )}
                <p>
                  <a
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    href={`/api/subject-choices/excel?classSectionId=${choices.section.id}`}
                  >
                    Download as Excel
                  </a>
                </p>
                {choices.canEdit ? (
                  <ExcelUpload
                    label="Upload the filled sheet"
                    upload={uploadSubjectChoices.bind(null, choices.section.id)}
                  />
                ) : null}
              </Card>
            </div>
          ) : null}

          {setup ? (
            <Card elevated>
              {setup.fromExams ? (
                <p style={{ margin: 0 }}>
                  The class has no subjects mapped this year. Set them under{' '}
                  <a href="/masters/academics?tab=class_subjects">
                    Masters → Class and subject mapping
                  </a>
                  , then put them in order here.
                </p>
              ) : (
                <>
                  {!setup.placed ? (
                    <Alert tone="info">
                      Not set yet: the subjects print in the subject master&rsquo;s order (shown
                      below). Save to keep this class&rsquo;s own order.
                    </Alert>
                  ) : null}
                  <ClassSubjectSetup
                    key={classId}
                    classId={classId}
                    subjects={setup.subjects}
                    groups={setup.groups}
                    streams={setup.streams}
                    canEdit={canSetUp}
                  />
                </>
              )}
            </Card>
          ) : null}

          {counts ? (
            <Card
              elevated
              title={`${counts.class.name} · students taking each subject`}
              actions={
                <span style={{ display: 'inline-flex', gap: 'var(--sp-3)', alignItems: 'center' }}>
                  <FileLinks
                    href={`/api/subject-counts/${counts.class.id}/pdf`}
                    label={`Subject counts of ${counts.class.name} (PDF)`}
                  />
                  <a
                    className="ep-btn ep-btn--secondary ep-btn--sm"
                    href={`/api/subject-counts/${counts.class.id}/xlsx`}
                  >
                    Excel
                  </a>
                </span>
              }
            >
              <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Subject counts">
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">Students taking each subject, by section</caption>
                  <thead>
                    <tr>
                      <th scope="col">Subject</th>
                      <th scope="col">Taken by</th>
                      {counts.sections.map((s) => (
                        <th key={s.id} scope="col" className="ep-num">
                          {s.code}
                        </th>
                      ))}
                      <th scope="col" className="ep-num">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {counts.subjects.map((x) => (
                      <tr key={x.id}>
                        <th scope="row">
                          {x.name} ({x.code})
                        </th>
                        <td>
                          {x.take === 'all'
                            ? 'Everyone'
                            : x.take === 'group'
                              ? (counts.groups.find((g) => g.id === x.groupId)?.name ?? '')
                              : 'Elective'}
                        </td>
                        {counts.sections.map((s) => (
                          <td key={s.id} className="ep-num">
                            {s.counts[x.id] ?? 0}
                          </td>
                        ))}
                        <td className="ep-num">
                          <strong>{counts.total.counts[x.id] ?? 0}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row" colSpan={2}>
                        Students
                      </th>
                      {counts.sections.map((s) => (
                        <td key={s.id} className="ep-num">
                          {s.students}
                        </td>
                      ))}
                      <td className="ep-num">{counts.total.students}</td>
                    </tr>
                    <tr>
                      <th scope="row" colSpan={2}>
                        No choices yet (take every subject)
                      </th>
                      {counts.sections.map((s) => (
                        <td key={s.id} className="ep-num">
                          {s.notSet}
                        </td>
                      ))}
                      <td className="ep-num">{counts.total.notSet}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          ) : null}
        </>
      )}
    </>
  );
}
