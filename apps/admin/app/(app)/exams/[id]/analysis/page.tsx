import { Breadcrumbs, Button, Card, DataTable, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { computeExamResults } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { Exam, ExamAnalysis } from '@/lib/types';

const Kpi = ({ label, value }: { label: string; value: string }) => (
  <Card elevated>
    <div className="ep-kicker">{label}</div>
    <div style={{ fontFamily: 'var(--font-heading)', fontSize: 'var(--fs-h2)', fontWeight: 600 }}>
      {value}
    </div>
  </Card>
);

/** Sprint 16: result analysis of an exam. */
export default async function AnalysisPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ classId?: string; ok?: string; error?: string; detail?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [t, r, me, exam, a] = await Promise.all([
    getTranslations('pages.exams_analysis'),
    getTranslations('results'),
    getMe(),
    apiFetch<Exam>(`/exams/${id}`),
    apiFetch<ExamAnalysis>(`/exams/${id}/analysis${sp.classId ? `?classId=${sp.classId}` : ''}`),
  ]);
  const canManage = me.permissions.includes('exams.master.manage');
  const pct = (v: number | null) => (v === null ? '—' : `${v}%`);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: t('kicker'), href: '/exams' },
          { label: exam.name, href: `/exams/${id}` },
          { label: t('title') },
        ]}
      />
      <PageHeader
        kicker={t('kicker')}
        title={`${t('title')} · ${exam.name}`}
        description={
          a.exam.computedAt
            ? r('computedAt', { at: a.exam.computedAt.slice(0, 16).replace('T', ' ') })
            : r('notComputed')
        }
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/exams/${id}/register`}>
              {r('register')}
            </a>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/exams/${id}/promotion`}>
              {r('promotion')}
            </a>
            {canManage ? (
              <form action={computeExamResults}>
                <input type="hidden" name="examId" value={id} />
                <input type="hidden" name="back" value={`/exams/${id}/analysis`} />
                <Button type="submit" size="sm">
                  {r('compute')}
                </Button>
              </form>
            ) : null}
          </span>
        }
      />
      <Notice params={sp} />
      <form
        method="get"
        style={{
          display: 'flex',
          gap: 'var(--sp-2)',
          alignItems: 'flex-end',
          marginBottom: 'var(--sp-4)',
        }}
      >
        <SelectField
          id="classId"
          name="classId"
          label={r('class')}
          defaultValue={sp.classId ?? ''}
          options={[
            { value: '', label: r('allClasses') },
            ...exam.classes.map((c) => ({ value: c.classId, label: c.classCode })),
          ]}
        />
        <Button type="submit" variant="secondary" size="sm">
          {r('open')}
        </Button>
      </form>
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-4)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          marginBottom: 'var(--sp-5)',
        }}
      >
        <Kpi label={r('pupils')} value={String(a.totals.pupils)} />
        <Kpi label={r('complete')} value={String(a.totals.complete)} />
        <Kpi label={r('passRate')} value={pct(a.totals.passPct)} />
        <Kpi label={r('meanPct')} value={pct(a.totals.meanPct)} />
        <Kpi label={r('fail')} value={String(a.totals.fail)} />
        <Kpi label={r('incomplete')} value={String(a.totals.incomplete)} />
      </div>
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
        }}
      >
        <Card title={r('subjects')}>
          <DataTable<ExamAnalysis['subjects'][number]>
            caption={r('subjects')}
            density="dense"
            columns={[
              { key: 'c', header: r('class'), render: (x) => x.classCode },
              {
                key: 's',
                header: r('subject'),
                render: (x) => (
                  <>
                    <strong>{x.code}</strong>
                    <div className="ep-kicker">
                      {x.name} / {x.maxMarks}
                    </div>
                  </>
                ),
              },
              { key: 'p', header: r('pupils'), numeric: true, render: (x) => x.pupils },
              { key: 'e', header: r('entered'), numeric: true, render: (x) => x.entered },
              { key: 'a', header: r('absent'), numeric: true, render: (x) => x.absent },
              { key: 'm', header: r('mean'), numeric: true, render: (x) => x.mean ?? '—' },
              { key: 'h', header: r('highest'), numeric: true, render: (x) => x.highest ?? '—' },
              { key: 'l', header: r('lowest'), numeric: true, render: (x) => x.lowest ?? '—' },
              { key: 'pr', header: r('passRate'), numeric: true, render: (x) => pct(x.passPct) },
            ]}
            rows={a.subjects}
            rowKey={(x) => `${x.classCode}-${x.code}`}
            emptyTitle={r('notComputed')}
          />
        </Card>
        <Card title={r('sections')}>
          <DataTable<ExamAnalysis['sections'][number]>
            caption={r('sections')}
            density="dense"
            columns={[
              { key: 's', header: r('section'), render: (x) => <strong>{x.section}</strong> },
              { key: 'p', header: r('pupils'), numeric: true, render: (x) => x.pupils },
              { key: 'c', header: r('complete'), numeric: true, render: (x) => x.complete },
              { key: 'm', header: r('meanPct'), numeric: true, render: (x) => pct(x.meanPct) },
              { key: 'pr', header: r('passRate'), numeric: true, render: (x) => pct(x.passPct) },
            ]}
            rows={a.sections}
            rowKey={(x) => x.section}
            emptyTitle={r('notComputed')}
          />
          <div className="ep-kicker" style={{ marginTop: 'var(--sp-3)' }}>
            {r('grades')}
          </div>
          <div
            style={{
              display: 'flex',
              gap: 'var(--sp-2)',
              flexWrap: 'wrap',
              marginTop: 'var(--sp-1)',
            }}
          >
            {a.grades.map((g) => (
              <span key={g.grade} className="ep-badge ep-badge--neutral">
                {g.grade} · {g.pupils}
              </span>
            ))}
          </div>
        </Card>
        <Card title={r('toppers')}>
          <DataTable<ExamAnalysis['toppers'][number]>
            caption={r('toppers')}
            density="dense"
            columns={[
              { key: 'r', header: r('rank'), numeric: true, render: (x) => x.rankInClass ?? '' },
              {
                key: 'n',
                header: r('pupil'),
                render: (x) => (
                  <>
                    {x.name}
                    <div className="ep-kicker">
                      {x.admissionNo} · {x.section}
                    </div>
                  </>
                ),
              },
              { key: 'p', header: r('pct'), numeric: true, render: (x) => x.pct },
              { key: 'g', header: r('grade'), render: (x) => x.grade ?? '' },
            ]}
            rows={a.toppers}
            rowKey={(x) => x.admissionNo}
            emptyTitle={r('notComputed')}
          />
        </Card>
      </div>
    </>
  );
}
