import { Badge, Card, DataTable, PageHeader, SelectField, Button } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import type { AdmissionCycle, AdmissionsDashboard } from '@/lib/types';

/** S8-05: admissions dashboard. */
export default async function AdmissionsDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ cycleId?: string }>;
}) {
  const sp = await searchParams;
  const [t, a] = await Promise.all([
    getTranslations('pages.admissions_dashboard'),
    getTranslations('admissions'),
  ]);
  const [cycles, dash] = await Promise.all([
    apiFetch<{ data: AdmissionCycle[] }>('/admissions/cycles').then((r) => r.data),
    apiFetch<AdmissionsDashboard>(
      `/admissions/dashboard${sp.cycleId ? `?cycleId=${sp.cycleId}` : ''}`,
    ),
  ]);
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <form
        method="get"
        style={{
          display: 'flex',
          gap: 'var(--sp-3)',
          alignItems: 'flex-end',
          marginBottom: 'var(--sp-4)',
        }}
      >
        <SelectField
          id="cycleId"
          name="cycleId"
          label={a('cycle')}
          defaultValue={sp.cycleId ?? ''}
          options={[
            { value: '', label: a('allCycles') },
            ...cycles.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` })),
          ]}
        />
        <Button type="submit" variant="secondary">
          {a('cycle')}
        </Button>
      </form>
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-3)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          marginBottom: 'var(--sp-4)',
        }}
      >
        {dash.byStatus.map((s) => (
          <Card key={s.status} elevated>
            <div className="ep-kicker">{a(`statusLabels.${s.status}`)}</div>
            <div
              style={{
                fontFamily: 'var(--font-heading)',
                fontSize: 'var(--fs-h2)',
                fontWeight: 600,
              }}
            >
              {s.count}
            </div>
          </Card>
        ))}
        <Card elevated>
          <div className="ep-kicker">{a('possibleDuplicates')}</div>
          <div
            style={{ fontFamily: 'var(--font-heading)', fontSize: 'var(--fs-h2)', fontWeight: 600 }}
          >
            <Badge tone={dash.possibleDuplicates > 0 ? 'warning' : 'neutral'}>
              {dash.possibleDuplicates}
            </Badge>
          </div>
        </Card>
      </div>
      <Card title={a('byClass')}>
        <DataTable<AdmissionsDashboard['byClass'][number]>
          caption={a('byClass')}
          density="dense"
          columns={[
            { key: 'cycle', header: a('cycle'), render: (r) => r.cycle },
            { key: 'class', header: a('class'), render: (r) => <strong>{r.classCode}</strong> },
            { key: 'seats', header: a('seats'), numeric: true, render: (r) => r.seats },
            {
              key: 'apps',
              header: a('applications'),
              numeric: true,
              render: (r) => r.applications,
            },
            { key: 'short', header: a('shortlisted'), numeric: true, render: (r) => r.shortlisted },
            { key: 'sel', header: a('selected'), numeric: true, render: (r) => r.selected },
          ]}
          rows={dash.byClass}
          rowKey={(r) => `${r.cycle}-${r.classCode}`}
          emptyTitle={a('noCycles')}
        />
      </Card>
    </>
  );
}
