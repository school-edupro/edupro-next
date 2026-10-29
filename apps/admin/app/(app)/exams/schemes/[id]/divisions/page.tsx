import { Breadcrumbs, Button, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { type ExamReport, ReportTables } from '@/components/exams/ReportTables';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { MarkScheme } from '@/lib/mark-schemes';

/**
 * The merit list by division of a locked result scheme (docs/design/65, part 6): the students by
 * division and rank, and how many of each section are in each division; as Excel and PDF.
 */
export default async function DivisionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ classId?: string; classSectionId?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const me = await getMe();
  if (!me.permissions.includes('exams.marks.view')) notFound();
  const s = await apiFetch<MarkScheme>(`/exams/schemes/${id}`).catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  });
  const q = new URLSearchParams();
  if (sp.classId && /^\d{1,18}$/.test(sp.classId)) q.set('classId', sp.classId);
  let report: ExamReport | null = null;
  let error: string | null = null;
  try {
    report = await apiFetch<ExamReport>(`/exams/schemes/${id}/divisions?${q.toString()}`);
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    error = typeof e.problem.detail === 'string' ? e.problem.detail : e.problem.type;
  }
  return (
    <>
      <Breadcrumbs
        items={[
          { label: 'Exams', href: '/exams' },
          { label: 'Mark schemes and registers', href: '/exams/schemes' },
          { label: s.name, href: `/exams/schemes/${s.id}` },
          { label: 'Merit by division' },
        ]}
      />
      <PageHeader
        kicker={`Mark scheme · ${s.termCode ?? ''}`}
        title={`Merit by division · ${s.name}`}
        description="The students by division and rank in the class, and the count of each division per section. Work out the term results on the scheme's page first."
      />
      {s.classes.length > 1 ? (
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
            <label className="ep-field" style={{ minWidth: 160 }}>
              <span className="ep-field__label">Class</span>
              <select className="ep-select" name="classId" defaultValue={sp.classId ?? ''}>
                <option value="">Every class</option>
                {s.classes.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.code}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="secondary">
              Show
            </Button>
          </form>
        </Card>
      ) : null}
      <Card elevated title={report?.title ?? 'Merit by division'}>
        {report ? (
          <>
            <p className="ep-field__help" style={{ marginTop: 0 }}>
              {report.subtitle.join(' · ')}
            </p>
            <ReportTables
              report={report}
              files={{
                base: `/api/exam-report/${s.id}/divisions`,
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
