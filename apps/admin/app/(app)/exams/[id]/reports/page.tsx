import { Breadcrumbs, Button, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { type ExamReport, ReportTables } from '@/components/exams/ReportTables';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { Exam } from '@/lib/types';

const KINDS: Array<{ value: string; label: string; help: string }> = [
  {
    value: 'subjects',
    label: 'Section-wise subject analysis',
    help: 'Each subject by section: appeared, absent, mean, highest, lowest, pass %; the class line under its sections.',
  },
  {
    value: 'ranges',
    label: 'Mark ranges',
    help: "How many students' subject % fall in each band: the class's grade scale (choose the class), or your own ranges.",
  },
  {
    value: 'toppers',
    label: 'Toppers',
    help: 'The top N of each class (or section), those at or above a %, below a %, or the toppers of a subject. Needs the results worked out.',
  },
  {
    value: 'teachers',
    label: 'Subject teachers',
    help: "Each subject teacher's sections: appeared, mean %, pass %, the highest %.",
  },
  {
    value: 'status',
    label: 'Upload status',
    help: 'Every section and subject: students who take it, marks entered, still to enter, submitted and verified by.',
  },
  {
    value: 'missing',
    label: 'Missing marks',
    help: 'The students without a mark or a code, by section and subject.',
  },
];
const FILTERS = [
  'classId',
  'classSectionId',
  'subjectId',
  'top',
  'minPct',
  'belowPct',
  'by',
  'ranges',
];

/**
 * An exam's analyses and exports (docs/design/65, part 6): choose the report and its filters; each is
 * shown here and comes as Excel and PDF.
 */
export default async function ExamReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
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
  const kind = KINDS.find((k) => k.value === sp.kind) ?? KINDS[0]!;
  const sections = await apiFetch<{ data: Array<{ classSectionId: string; section: string }> }>(
    `/exams/${id}/entry-status`,
  )
    .then((r) => [...new Map(r.data.map((x) => [x.classSectionId, x.section])).entries()])
    .catch(() => [] as Array<[string, string]>);
  const subjects = [
    ...new Map((exam.subjects ?? []).map((x) => [x.subjectId, x.subjectName])).entries(),
  ];
  const q = new URLSearchParams();
  for (const k of FILTERS) {
    const v = k === 'ranges' ? sp[k]?.replace(/\s+/g, '') : sp[k]?.trim();
    if (v) q.set(k, v);
  }
  // only the filters that report reads
  if (kind.value !== 'toppers')
    for (const k of ['subjectId', 'top', 'minPct', 'belowPct', 'by']) q.delete(k);
  if (kind.value !== 'ranges') q.delete('ranges');
  let report: ExamReport | null = null;
  let error: string | null = null;
  try {
    report = await apiFetch<ExamReport>(`/exams/${id}/reports/${kind.value}?${q.toString()}`);
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    error =
      (typeof e.problem.detail === 'string' && e.problem.detail) ||
      ((e.problem.errors as Array<{ message?: string }> | undefined)?.[0]?.message ??
        e.problem.type);
  }
  const field = (name: string, label: string, props: Record<string, unknown> = {}) => (
    <label className="ep-field" style={{ minWidth: 120 }}>
      <span className="ep-field__label">{label}</span>
      <input className="ep-input" name={name} defaultValue={sp[name] ?? ''} {...props} />
    </label>
  );
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Exams', href: '/exams' },
          { label: exam.name, href: `/exams/${exam.id}` },
          { label: 'Reports' },
        ]}
      />
      <PageHeader
        kicker={`Exams · ${exam.code}`}
        title={`Reports · ${exam.name}`}
        description={kind.help}
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/exams/${exam.id}/analysis`}>
              Result analysis
            </a>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/exams/${exam.id}`}>
              The exam
            </a>
          </span>
        }
      />
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <form
          method="get"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <label className="ep-field" style={{ minWidth: 240 }}>
            <span className="ep-field__label">Report</span>
            <select className="ep-select" name="kind" defaultValue={kind.value}>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" style={{ minWidth: 140 }}>
            <span className="ep-field__label">Class</span>
            <select className="ep-select" name="classId" defaultValue={sp.classId ?? ''}>
              <option value="">Every class</option>
              {exam.classes.map((k) => (
                <option key={k.classId} value={k.classId}>
                  {k.classCode}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field" style={{ minWidth: 140 }}>
            <span className="ep-field__label">Section</span>
            <select
              className="ep-select"
              name="classSectionId"
              defaultValue={sp.classSectionId ?? ''}
            >
              <option value="">Every section</option>
              {sections.map(([sid, code]) => (
                <option key={sid} value={sid}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          {kind.value === 'toppers' ? (
            <>
              {field('top', 'Top', { type: 'number', min: 1, max: 100, placeholder: '10' })}
              <label className="ep-field" style={{ minWidth: 140 }}>
                <span className="ep-field__label">Rank in</span>
                <select className="ep-select" name="by" defaultValue={sp.by ?? 'class'}>
                  <option value="class">The class</option>
                  <option value="section">The section</option>
                </select>
              </label>
              {field('minPct', 'At or above %', { type: 'number', min: 0, max: 100, step: '0.01' })}
              {field('belowPct', 'Below %', { type: 'number', min: 0, max: 100, step: '0.01' })}
              <label className="ep-field" style={{ minWidth: 180 }}>
                <span className="ep-field__label">Subject (optional)</span>
                <select className="ep-select" name="subjectId" defaultValue={sp.subjectId ?? ''}>
                  <option value="">The overall result</option>
                  {subjects.map(([sid, name]) => (
                    <option key={sid} value={sid}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
          {kind.value === 'ranges'
            ? field('ranges', 'Your ranges: lower ends (optional)', {
                placeholder: '90, 75, 60, 45, 33, 0',
                pattern: '[0-9., ]{1,80}',
              })
            : null}
          <Button type="submit" variant="secondary">
            Show
          </Button>
        </form>
      </Card>
      <Card elevated title={report?.title ?? kind.label}>
        {report ? (
          <>
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              {report.subtitle.join(' · ')}
            </p>
            <ReportTables
              report={report}
              files={{
                base: `/api/exam-report/${exam.id}/${kind.value}`,
                q: q.toString() ? encodeURIComponent(q.toString()) : '-',
              }}
            />
          </>
        ) : (
          <div className="ep-alert ep-alert--danger" role="alert">
            {error}
          </div>
        )}
      </Card>
    </>
  );
}
