import { Badge, Button, Card, DataTable, PageHeader, SelectField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';

interface Analytics {
  exams: Array<{
    id: string;
    code: string;
    name: string;
    pupils: number;
    complete: number;
    passPct: number | null;
    meanPct: number | null;
  }>;
  byClass: Array<{
    examCode: string;
    classCode: string;
    section: string | null;
    pupils: number;
    complete: number;
    pass: number;
    fail: number;
    passPct: number | null;
    meanPct: number | null;
  }>;
  weakestSubjects: Array<{
    examCode: string;
    classCode: string;
    subject: string;
    entered: number;
    passPct: number | null;
    mean: number | null;
  }>;
}

const pct = (v: number | null) => (v === null ? '—' : `${v}%`);

/** Sprint 18 (AI track): results analytics for the principal. */
export default async function ResultsAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ examId?: string }>;
}) {
  const sp = await searchParams;
  const [t, r, a] = await Promise.all([
    getTranslations('pages.insights_results'),
    getTranslations('resultsAnalytics'),
    apiFetch<Analytics>(`/insights/results${sp.examId ? `?examId=${sp.examId}` : ''}`),
  ]);
  return (
    <>
      <PageHeader
        kicker={t('kicker')}
        title={t('title')}
        description={t('description')}
        actions={
          <form
            method="get"
            style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}
          >
            <SelectField
              id="examId"
              name="examId"
              label={r('exam')}
              defaultValue={sp.examId ?? ''}
              options={[
                { value: '', label: r('all') },
                ...a.exams.map((e) => ({ value: e.id, label: e.code })),
              ]}
            />
            <Button type="submit" variant="secondary" size="sm">
              {r('show')}
            </Button>
          </form>
        }
      />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-4)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          marginBottom: 'var(--sp-5)',
        }}
      >
        {a.exams.map((e) => (
          <Card key={e.id} elevated>
            <div className="ep-kicker">{e.code}</div>
            <div
              style={{
                fontFamily: 'var(--font-heading)',
                fontSize: 'var(--fs-h2)',
                fontWeight: 600,
              }}
            >
              {pct(e.passPct)}
            </div>
            <div className="ep-field__help">
              {r('meanPct')} {pct(e.meanPct)} · {e.complete}/{e.pupils}{' '}
              {r('complete').toLowerCase()}
            </div>
          </Card>
        ))}
      </div>
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))',
        }}
      >
        <Card title={r('byClass')}>
          <DataTable<Analytics['byClass'][number]>
            caption={r('byClass')}
            density="dense"
            columns={[
              { key: 'e', header: r('exam'), render: (x) => x.examCode },
              {
                key: 'c',
                header: r('class'),
                render: (x) => (
                  <strong>
                    {x.classCode}
                    {x.section ? `-${x.section}` : ''}
                  </strong>
                ),
              },
              { key: 'p', header: r('pupils'), numeric: true, render: (x) => x.pupils },
              { key: 'k', header: r('complete'), numeric: true, render: (x) => x.complete },
              { key: 'pa', header: r('pass'), numeric: true, render: (x) => x.pass },
              {
                key: 'f',
                header: r('fail'),
                numeric: true,
                render: (x) => (x.fail ? <Badge tone="danger">{x.fail}</Badge> : 0),
              },
              { key: 'pp', header: r('passPct'), numeric: true, render: (x) => pct(x.passPct) },
              { key: 'mp', header: r('meanPct'), numeric: true, render: (x) => pct(x.meanPct) },
            ]}
            rows={a.byClass}
            rowKey={(x) => `${x.examCode}-${x.classCode}-${x.section ?? ''}`}
            emptyTitle={r('noData')}
          />
        </Card>
        <Card title={r('weakest')}>
          <DataTable<Analytics['weakestSubjects'][number]>
            caption={r('weakest')}
            density="dense"
            columns={[
              { key: 'e', header: r('exam'), render: (x) => x.examCode },
              { key: 'c', header: r('class'), render: (x) => x.classCode },
              { key: 's', header: r('subject'), render: (x) => <strong>{x.subject}</strong> },
              { key: 'n', header: r('entered'), numeric: true, render: (x) => x.entered },
              {
                key: 'p',
                header: r('passPct'),
                numeric: true,
                render: (x) => (
                  <Badge
                    tone={
                      x.passPct !== null && x.passPct < 60
                        ? 'danger'
                        : x.passPct !== null && x.passPct < 80
                          ? 'warning'
                          : 'success'
                    }
                  >
                    {pct(x.passPct)}
                  </Badge>
                ),
              },
              { key: 'm', header: r('mean'), numeric: true, render: (x) => pct(x.mean) },
            ]}
            rows={a.weakestSubjects}
            rowKey={(x) => `${x.examCode}-${x.classCode}-${x.subject}`}
            emptyTitle={r('noData')}
          />
        </Card>
      </div>
    </>
  );
}
