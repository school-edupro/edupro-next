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
  classBulkChoices,
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
    subjects: Array<{ subjectId: string; kind: string; additional: boolean }>;
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
    missing: number;
    counts: Record<string, number>;
  }>;
  total: { students: number; notSet: number; missing: number; counts: Record<string, number> };
}
interface Found {
  studentId: string;
  name: string;
  admissionNo: string;
  sectionId: string;
  section: string;
}
interface History {
  student: { id: string; name: string };
  data: Array<{ at: string; by: string | null; subject: string; what: string }>;
}
type Tab = 'students' | 'class' | 'setup';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Each student's subjects for the year and the class's subject order (docs/design/65, 67; the legacy
 * Student / Master Subject Mapping). Students: a section's grid (a column per choice group, the stream,
 * other electives, the student's own additional "Opt"), find a student by admission no, each row's
 * history, Excel and PDF. Whole class: every section's "taking / students" per subject and one column
 * set for the whole class. Class set-up: the order printed, who takes each subject, groups and streams.
 */
export default async function SubjectChoicesPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    sectionId?: string;
    classId?: string;
    find?: string;
    q?: string;
    history?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me.permissions.includes('exams.marks.view')) notFound();
  // the old Counts tab is the Whole class tab now
  const tab: Tab =
    sp.tab === 'setup' ? 'setup' : sp.tab === 'class' || sp.tab === 'counts' ? 'class' : 'students';
  const sections = await apiFetch<{ data: Section[] }>('/exams/subject-choices/sections')
    .then((r) => r.data)
    .catch(() => [] as Section[]);
  const classes = [
    ...new Map(sections.map((s) => [s.classId, { id: s.classId, name: s.className }])).values(),
  ];
  // a student looked up by admission no or name: one found opens their section
  const find = tab === 'students' && sp.find?.trim() ? sp.find.trim() : '';
  const found = find
    ? await apiFetch<{ data: Found[] }>(
        `/exams/subject-choices/find?q=${encodeURIComponent(find)}`,
      ).then((r) => r.data)
    : [];
  const one = found.length === 1 ? found[0]! : null;
  const section = sections.find((s) => s.id === (one?.sectionId ?? sp.sectionId)) ?? sections[0];
  const classId =
    classes.find((k) => k.id === sp.classId)?.id ?? section?.classId ?? classes[0]?.id ?? '';
  const base = (t: Tab) =>
    `/exams/subject-choices?tab=${t}${t === 'students' ? (section ? `&sectionId=${section.id}` : '') : classId ? `&classId=${classId}` : ''}`;
  const choices =
    tab === 'students' && section
      ? await apiFetch<Choices>(`/exams/subject-choices?classSectionId=${section.id}`)
      : null;
  const history =
    choices && sp.history && /^\d{1,18}$/.test(sp.history)
      ? await apiFetch<History>(`/exams/subject-choices/history?studentId=${sp.history}`).catch(
          () => null,
        )
      : null;
  const setup =
    tab === 'setup' && classId
      ? await apiFetch<Setup>(`/exams/subject-choices/setup?classId=${classId}`)
      : null;
  const counts =
    tab === 'class' && classId
      ? await apiFetch<Counts>(`/exams/subject-choices/counts?classId=${classId}`)
      : null;
  // the whole class tab needs the class's streams and groups for its "set for every section"
  const classSetup =
    tab === 'class' && classId
      ? await apiFetch<Setup>(`/exams/subject-choices/setup?classId=${classId}`)
      : null;
  const canSetUp = me.permissions.includes('exams.master.manage');
  const canClass = sections.some((s) => s.classId === classId && s.canEdit);
  const initialQuery = one?.admissionNo ?? sp.q ?? '';
  const nameOf = (list: ChoiceSubject[], id: string) => {
    const x = list.find((s) => s.id === id);
    return x ? `${x.name} (${x.code})` : '';
  };

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
              ['students', 'Students (section-wise)'],
              ['class', 'Whole class'],
              ['setup', 'Class set-up (order, groups, streams)'],
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
            <div
              style={{
                display: 'flex',
                gap: 'var(--sp-5)',
                alignItems: 'flex-end',
                flexWrap: 'wrap',
              }}
            >
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
              {tab === 'students' ? (
                <form
                  method="get"
                  role="search"
                  style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}
                >
                  <input type="hidden" name="tab" value="students" />
                  <label className="ep-field" style={{ minWidth: '15rem' }}>
                    <span className="ep-field__label">Find a student in any section</span>
                    <input
                      className="ep-input"
                      type="search"
                      name="find"
                      defaultValue={find}
                      placeholder="Admission no or name"
                      maxLength={60}
                    />
                  </label>
                  <Button type="submit" variant="secondary">
                    Find
                  </Button>
                </form>
              ) : null}
            </div>
            {find && !found.length ? (
              <p className="ep-field__help" role="status">
                No student of the working year matches &ldquo;{find}&rdquo;.
              </p>
            ) : null}
            {found.length > 1 ? (
              <div role="status">
                <p className="ep-field__help">{found.length} students match; open one:</p>
                <ul>
                  {found.map((x) => (
                    <li key={x.studentId}>
                      <a
                        href={`/exams/subject-choices?tab=students&sectionId=${x.sectionId}&q=${encodeURIComponent(x.admissionNo)}`}
                      >
                        {x.name} ({x.admissionNo}) · {x.section}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>

          {history ? (
            <Card
              elevated
              title={`History · ${history.student.name}`}
              style={{ marginBottom: 'var(--sp-4)' }}
              actions={
                <a
                  className="ep-btn ep-btn--ghost ep-btn--sm"
                  href={
                    base('students') +
                    (initialQuery ? `&q=${encodeURIComponent(initialQuery)}` : '')
                  }
                >
                  Close
                </a>
              }
            >
              {history.data.length ? (
                <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="History">
                  <table className="ep-table ep-table--dense">
                    <caption className="ep-sr-only">
                      Changes to {history.student.name}&rsquo;s subjects this year
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">When</th>
                        <th scope="col">Subject</th>
                        <th scope="col">What</th>
                        <th scope="col">By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.data.map((x, i) => (
                        <tr key={i}>
                          <td>{when(x.at)}</td>
                          <td>{x.subject}</td>
                          <td>{x.what}</td>
                          <td>{x.by ?? 'System'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ margin: 0 }}>No change to this student&rsquo;s subjects this year.</p>
              )}
            </Card>
          ) : null}

          {choices ? (
            <div className="ep-rp">
              <Card
                elevated
                title={`${choices.section.code} · ${String(choices.withChoices)} of ${String(choices.rows.length)} with choices`}
              >
                {choices.fromExams ? (
                  <Alert tone="info">
                    {choices.section.className} has no subjects mapped this year: its exams&rsquo;
                    subjects are shown; tick each student&rsquo;s. Map the class&rsquo;s subjects
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
                    key={`${choices.section.id}-${initialQuery}`}
                    classSectionId={choices.section.id}
                    subjects={choices.subjects}
                    groups={choices.groups}
                    streams={choices.streams}
                    canEdit={choices.canEdit}
                    initialQuery={initialQuery}
                    historyBase={`/exams/subject-choices?tab=students&sectionId=${choices.section.id}${initialQuery ? `&q=${encodeURIComponent(initialQuery)}` : ''}&history=`}
                    rows={choices.rows.map((r) => ({
                      studentId: r.studentId,
                      name: r.name,
                      admissionNo: r.admissionNo,
                      rollNo: r.rollNo,
                      stream: r.stream,
                      subjectIds: r.subjects.map((x) => x.subjectId),
                      additionalIds: r.subjects.filter((x) => x.additional).map((x) => x.subjectId),
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
                <h3 className="ep-field__label">The section&rsquo;s list</h3>
                <p style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
                  <span>
                    PDF, landscape{' '}
                    <FileLinks
                      href={`/api/subject-choices/list?classSectionId=${choices.section.id}&format=pdf`}
                      label={`Subject choices of ${choices.section.code} (PDF, landscape)`}
                    />
                  </span>
                  <span>
                    PDF, upright{' '}
                    <FileLinks
                      href={`/api/subject-choices/list?classSectionId=${choices.section.id}&format=pdf&portrait=true`}
                      label={`Subject choices of ${choices.section.code} (PDF, upright)`}
                    />
                  </span>
                </p>
                <h3 className="ep-field__label">Excel to fill and upload</h3>
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

          {counts && classSetup ? (
            <>
              <Card
                elevated
                title={`${counts.class.name} · taking / students in each section`}
                style={{ marginBottom: 'var(--sp-4)' }}
                actions={
                  <span
                    style={{ display: 'inline-flex', gap: 'var(--sp-3)', alignItems: 'center' }}
                  >
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
                <p className="ep-field__help" style={{ marginTop: 0 }}>
                  Each subject shows the students taking it out of the section&rsquo;s students. A
                  student with no choices yet takes every subject; &ldquo;Missing a choice&rdquo;
                  counts those short of a group&rsquo;s subject.
                </p>
                <div
                  className="ep-table-wrap"
                  tabIndex={0}
                  role="region"
                  aria-label="Taking / students by section"
                >
                  <table className="ep-table ep-table--dense">
                    <caption className="ep-sr-only">
                      Students taking each subject out of the section&rsquo;s students
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Section</th>
                        <th scope="col" className="ep-num">
                          Students
                        </th>
                        <th scope="col" className="ep-num">
                          Not set
                        </th>
                        <th scope="col" className="ep-num">
                          Missing a choice
                        </th>
                        {counts.subjects.map((x) => (
                          <th key={x.id} scope="col" className="ep-num" title={x.name}>
                            {x.code}
                            <span className="ep-kicker" style={{ display: 'block' }}>
                              {x.take === 'all'
                                ? 'everyone'
                                : x.take === 'group'
                                  ? (counts.groups.find((g) => g.id === x.groupId)?.name ?? '')
                                  : 'elective'}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {counts.sections.map((s) => (
                        <tr key={s.id}>
                          <th scope="row">
                            <a href={`/exams/subject-choices?tab=students&sectionId=${s.id}`}>
                              {s.code}
                            </a>
                          </th>
                          <td className="ep-num">{s.students}</td>
                          <td className="ep-num">{s.notSet}</td>
                          <td className="ep-num">{s.missing}</td>
                          {counts.subjects.map((x) => (
                            <td key={x.id} className="ep-num">
                              {s.counts[x.id] ?? 0} / {s.students}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th scope="row">Class</th>
                        <td className="ep-num">{counts.total.students}</td>
                        <td className="ep-num">{counts.total.notSet}</td>
                        <td className="ep-num">{counts.total.missing}</td>
                        {counts.subjects.map((x) => (
                          <td key={x.id} className="ep-num">
                            <strong>{counts.total.counts[x.id] ?? 0}</strong> /{' '}
                            {counts.total.students}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </Card>
              <div className="ep-rp">
                <Card elevated title="Set for the whole class">
                  {!canClass ? (
                    <p style={{ margin: 0 }}>The office sets choices for a whole class.</p>
                  ) : classSetup.fromExams ? (
                    <p style={{ margin: 0 }}>
                      Map the class&rsquo;s subjects first (Masters → Class and subject mapping).
                    </p>
                  ) : (
                    <form action={classBulkChoices}>
                      <input type="hidden" name="classId" value={classId} />
                      <p style={{ marginTop: 0 }}>
                        One column for every section of {counts.class.name}, saved at once; each
                        student stays in their own section. A student with marks in a subject the
                        change would take off is left as they are.
                      </p>
                      <div
                        style={{
                          display: 'flex',
                          gap: 'var(--sp-3)',
                          flexWrap: 'wrap',
                          alignItems: 'flex-end',
                        }}
                      >
                        <label className="ep-field" style={{ minWidth: '18rem' }}>
                          <span className="ep-field__label">Set</span>
                          <select className="ep-select" name="set" required>
                            {classSetup.streams.map((x) => (
                              <option key={x.id} value={`stream:${x.name}`}>
                                Stream → {x.name}
                              </option>
                            ))}
                            {classSetup.groups
                              .filter((g) => g.max === 1)
                              .flatMap((g) =>
                                g.subjectIds.map((id) => (
                                  <option key={`${g.id}-${id}`} value={`group:${g.id}:${id}`}>
                                    {g.name} → {nameOf(classSetup.subjects, id)}
                                  </option>
                                )),
                              )}
                            {classSetup.subjects
                              .filter((x) => x.take === 'free')
                              .flatMap((x) => [
                                <option key={`t${x.id}`} value={`take:${x.id}`}>
                                  {x.name} ({x.code}) → takes it
                                </option>,
                                <option key={`d${x.id}`} value={`drop:${x.id}`}>
                                  {x.name} ({x.code}) → does not take it
                                </option>,
                              ])}
                          </select>
                        </label>
                        <label className="ep-field">
                          <span className="ep-field__label">For</span>
                          <select className="ep-select" name="scope" defaultValue="empty">
                            <option value="empty">Only students without one</option>
                            <option value="all">Every student</option>
                          </select>
                        </label>
                      </div>
                      <label
                        style={{
                          display: 'flex',
                          gap: 'var(--sp-2)',
                          alignItems: 'center',
                          margin: 'var(--sp-3) 0',
                        }}
                      >
                        <input type="checkbox" name="sure" required />
                        Save this for every section of {counts.class.name} now
                      </label>
                      <Button type="submit">Apply to the whole class</Button>
                    </form>
                  )}
                </Card>
                <Card elevated title="Every student of the class">
                  <p style={{ marginTop: 0 }}>Each student&rsquo;s subjects, section by section.</p>
                  <p style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
                    <span>
                      PDF, landscape{' '}
                      <FileLinks
                        href={`/api/subject-choices/list?classId=${classId}&format=pdf`}
                        label={`Subject choices of ${counts.class.name} (PDF, landscape)`}
                      />
                    </span>
                    <span>
                      PDF, upright{' '}
                      <FileLinks
                        href={`/api/subject-choices/list?classId=${classId}&format=pdf&portrait=true`}
                        label={`Subject choices of ${counts.class.name} (PDF, upright)`}
                      />
                    </span>
                  </p>
                  <p>
                    <a
                      className="ep-btn ep-btn--secondary ep-btn--sm"
                      href={`/api/subject-choices/list?classId=${classId}&format=xlsx`}
                    >
                      Excel
                    </a>
                  </p>
                </Card>
              </div>
            </>
          ) : null}

          {setup ? (
            <Card elevated>
              {setup.fromExams ? (
                <p style={{ margin: 0 }}>
                  The class has no subjects mapped this year. Map them under{' '}
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
        </>
      )}
    </>
  );
}
