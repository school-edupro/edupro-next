import { Badge, Button, Card, DataTable, InputField, KpiTile, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import type { PunchSummary } from '@/lib/types';

const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';

export default async function PunchesPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today();
  const [t, a, s] = await Promise.all([
    getTranslations('pages.attendance_punches'),
    getTranslations('attendance'),
    apiFetch<PunchSummary>(`/attendance/punch/summary?date=${date}`),
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
        <InputField id="date" name="date" label={a('date')} type="date" defaultValue={date} />
        <Button type="submit" variant="secondary">
          {a('show')}
        </Button>
      </form>
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-4)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          marginBottom: 'var(--sp-5)',
        }}
      >
        <KpiTile label={a('presentStaff')} value={s.present} />
        <KpiTile label={a('absentStaff')} value={s.absent} />
      </div>
      <Card>
        <DataTable<PunchSummary['rows'][number]>
          caption={`${a('punches')} · ${date}`}
          density="dense"
          columns={[
            {
              key: 'name',
              header: a('employee'),
              render: (r) => <a href={`/people/employees/${r.employeeId}`}>{r.name}</a>,
            },
            { key: 'code', header: '#', render: (r) => r.code },
            {
              key: 'dept',
              header: a('section'),
              render: (r) => `${r.designation ?? ''}${r.department ? ` · ${r.department}` : ''}`,
            },
            { key: 'in', header: a('firstIn'), render: (r) => time(r.firstIn) },
            { key: 'out', header: a('lastOut'), render: (r) => time(r.lastOut) },
            {
              key: 'hours',
              header: a('hours'),
              numeric: true,
              render: (r) => (r.hours === null ? '' : r.hours.toFixed(2)),
            },
            {
              key: 'status',
              header: a('status'),
              render: (r) => (
                <Badge tone={r.firstIn ? 'success' : 'neutral'}>
                  {r.firstIn ? a('present') : a('absentStaff')}
                </Badge>
              ),
            },
          ]}
          rows={s.rows}
          rowKey={(r) => r.employeeId}
          emptyTitle={a('noPunches')}
        />
      </Card>
    </>
  );
}
