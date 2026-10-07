import { Badge, Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { AcademicsNav } from '@/components/academics/AcademicsNav';
import { apiFetch, getMe } from '@/lib/api';
import { importSyllabus, removeSyllabusRow, saveChapter, saveTopic } from '@/lib/syllabus-actions';

interface IndexRow {
  classId: string;
  className: string;
  subjectId: string;
  subject: string;
  chapters: number;
  topics: number;
}
interface Tree {
  chapters: Array<{
    id: string;
    number: number;
    name: string;
    term: string | null;
    plannedMonth: number | null;
    topics: Array<{ id: string; number: number; name: string; plannedPeriods: number }>;
  }>;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_OPTIONS = [
  { value: '', label: 'Not planned' },
  ...MONTHS.map((m, i) => ({ value: String(i + 1), label: m })),
];

/**
 * The syllabus: for each class and subject of the session, the chapters and the topics of each chapter,
 * with the month a chapter is planned for. Teachers plan and mark against these; coverage follows.
 */
export default async function SyllabusPage({
  searchParams,
}: {
  searchParams: Promise<{
    classId?: string;
    subjectId?: string;
    ok?: string;
    error?: string;
    detail?: string;
    imported?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const canManage = me.permissions.includes('academics.syllabus.manage');
  const index = (await apiFetch<{ data: IndexRow[] }>('/academics/syllabus')).data;
  const open = index.find((r) => r.classId === sp.classId && r.subjectId === sp.subjectId);
  const tree = open
    ? await apiFetch<Tree>(
        `/academics/syllabus/tree?classId=${open.classId}&subjectId=${open.subjectId}`,
      )
    : null;
  const [ch, tp, bad] = (sp.imported ?? '').split('-');
  const hidden = open ? (
    <>
      <input type="hidden" name="classId" value={open.classId} />
      <input type="hidden" name="subjectId" value={open.subjectId} />
    </>
  ) : null;
  return (
    <>
      <PageHeader
        kicker="Academics · Lesson planner"
        title={open ? `Syllabus: ${open.className} · ${open.subject}` : 'Syllabus'}
        description="Chapters and topics of each class and subject. Teachers pick these in the weekly plan and mark them done; coverage is counted from here."
        actions={
          <>
            {open ? (
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/academics/syllabus">
                All classes
              </a>
            ) : null}
            <a className="ep-btn ep-btn--secondary ep-btn--sm" href="/academics/syllabus/coverage">
              Coverage dashboard
            </a>
          </>
        }
      />
      <AcademicsNav current="/academics/syllabus" permissions={me.permissions} />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.imported
            ? `Uploaded: ${ch ?? '0'} chapter(s), ${tp ?? '0'} topic(s); ${bad ?? '0'} row(s) left out.${sp.detail ? ` ${sp.detail}` : ''}`
            : 'Saved.'}
        </div>
      ) : null}
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || 'Could not save.'}
        </div>
      ) : null}

      {!open ? (
        <>
          {canManage ? (
            <Card title="Upload from Excel" style={{ marginBottom: 'var(--sp-4)' }}>
              <form
                action={importSyllabus}
                style={{
                  display: 'flex',
                  gap: 'var(--sp-3)',
                  flexWrap: 'wrap',
                  alignItems: 'flex-end',
                }}
              >
                <InputField
                  id="sy-file"
                  name="file"
                  label="Excel file (one row per topic)"
                  type="file"
                  accept=".xlsx"
                  required
                />
                <Button type="submit">Upload</Button>
                <a className="ep-btn ep-btn--ghost" href="/api/academics/syllabus-format">
                  Download the format
                </a>
              </form>
            </Card>
          ) : null}
          <Card title="Classes and subjects">
            {index.length === 0 ? (
              <p className="ep-field__help" style={{ margin: 0 }}>
                No class has subjects yet. Map subjects to classes in Academics → Setup → Class and
                subject mapping.
              </p>
            ) : (
              <div
                className="ep-table-wrap"
                tabIndex={0}
                role="region"
                aria-label="Classes and subjects"
              >
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">Syllabus entered, by class and subject</caption>
                  <thead>
                    <tr>
                      <th scope="col">Class</th>
                      <th scope="col">Subject</th>
                      <th scope="col" className="ep-num">
                        Chapters
                      </th>
                      <th scope="col" className="ep-num">
                        Topics
                      </th>
                      <th scope="col">Syllabus</th>
                    </tr>
                  </thead>
                  <tbody>
                    {index.map((r) => (
                      <tr key={`${r.classId}-${r.subjectId}`}>
                        <td>{r.className}</td>
                        <th scope="row">
                          <a
                            href={`/academics/syllabus?classId=${r.classId}&subjectId=${r.subjectId}`}
                            style={{ textDecoration: 'underline' }}
                          >
                            {r.subject}
                          </a>
                        </th>
                        <td className="ep-num">{r.chapters}</td>
                        <td className="ep-num">{r.topics}</td>
                        <td>
                          <Badge tone={r.topics ? 'success' : 'warning'}>
                            {r.topics ? 'Entered' : 'Not entered'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : (
        <>
          {tree!.chapters.length === 0 ? (
            <Card style={{ marginBottom: 'var(--sp-4)' }}>
              <p className="ep-field__help" style={{ margin: 0 }}>
                No chapter yet. Add the first one below, or upload the whole syllabus from Excel.
              </p>
            </Card>
          ) : null}
          {tree!.chapters.map((c) => (
            <Card
              key={c.id}
              title={`Chapter ${String(c.number)}: ${c.name}`}
              style={{ marginBottom: 'var(--sp-4)' }}
              actions={
                <span style={{ display: 'inline-flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                  {c.term ? <Badge tone="neutral">{c.term}</Badge> : null}
                  <Badge tone={c.plannedMonth ? 'info' : 'warning'}>
                    {c.plannedMonth
                      ? `Planned: ${MONTHS[c.plannedMonth - 1]!}`
                      : 'No month planned'}
                  </Badge>
                  {canManage ? (
                    <form action={removeSyllabusRow}>
                      {hidden}
                      <input type="hidden" name="kind" value="chapter" />
                      <input type="hidden" name="id" value={c.id} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove chapter ${String(c.number)}`}
                      >
                        Remove
                      </Button>
                    </form>
                  ) : null}
                </span>
              }
            >
              <div
                className="ep-table-wrap"
                tabIndex={0}
                role="region"
                aria-label={`Topics of chapter ${String(c.number)}`}
              >
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">Topics of chapter {c.number}</caption>
                  <thead>
                    <tr>
                      <th scope="col">No.</th>
                      <th scope="col">Topic</th>
                      <th scope="col" className="ep-num">
                        Periods
                      </th>
                      <th scope="col">
                        <span className="ep-sr-only">Remove</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.topics.map((t) => (
                      <tr key={t.id}>
                        <td>
                          {c.number}.{t.number}
                        </td>
                        <th scope="row">{t.name}</th>
                        <td className="ep-num">{t.plannedPeriods}</td>
                        <td>
                          {canManage ? (
                            <form action={removeSyllabusRow}>
                              {hidden}
                              <input type="hidden" name="kind" value="topic" />
                              <input type="hidden" name="id" value={t.id} />
                              <Button
                                type="submit"
                                variant="ghost"
                                size="sm"
                                aria-label={`Remove topic ${t.name}`}
                              >
                                Remove
                              </Button>
                            </form>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canManage ? (
                <form
                  action={saveTopic}
                  style={{
                    display: 'flex',
                    gap: 'var(--sp-3)',
                    flexWrap: 'wrap',
                    alignItems: 'flex-end',
                    marginTop: 'var(--sp-3)',
                  }}
                >
                  {hidden}
                  <input type="hidden" name="chapterId" value={c.id} />
                  <InputField
                    id={`tn-${c.id}`}
                    name="number"
                    label="Topic no."
                    type="number"
                    min={1}
                    max={500}
                    required
                    defaultValue={String(c.topics.length + 1)}
                  />
                  <InputField
                    id={`tt-${c.id}`}
                    name="name"
                    label="Topic"
                    required
                    maxLength={300}
                  />
                  <InputField
                    id={`tp-${c.id}`}
                    name="plannedPeriods"
                    label="Periods"
                    type="number"
                    min={1}
                    max={60}
                    defaultValue="1"
                  />
                  <Button type="submit" variant="secondary">
                    Add topic
                  </Button>
                </form>
              ) : null}
            </Card>
          ))}
          {canManage ? (
            <Card title="Add a chapter">
              <form
                action={saveChapter}
                style={{
                  display: 'flex',
                  gap: 'var(--sp-3)',
                  flexWrap: 'wrap',
                  alignItems: 'flex-end',
                }}
              >
                {hidden}
                <InputField
                  id="ch-no"
                  name="number"
                  label="Chapter no."
                  type="number"
                  min={1}
                  max={200}
                  required
                  defaultValue={String(tree!.chapters.length + 1)}
                />
                <InputField
                  id="ch-name"
                  name="name"
                  label="Chapter name"
                  required
                  maxLength={300}
                />
                <InputField id="ch-term" name="term" label="Term" maxLength={40} />
                <SelectField
                  id="ch-month"
                  name="plannedMonth"
                  label="Planned month"
                  options={MONTH_OPTIONS}
                />
                <Button type="submit">Add chapter</Button>
              </form>
            </Card>
          ) : null}
        </>
      )}
    </>
  );
}
