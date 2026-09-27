import { Badge, Button, Card, DataTable, InputField, KpiTile, PageHeader } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api';
import type { RfidDashboard } from '@/lib/types';

const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const healthTone = (h: string) =>
  h === 'online' ? 'success' : h === 'idle' ? 'warning' : h === 'silent' ? 'danger' : 'neutral';

export default async function RfidDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today();
  const [t, a, d] = await Promise.all([
    getTranslations('pages.attendance_rfid_dashboard'),
    getTranslations('attendance'),
    apiFetch<RfidDashboard>(`/attendance/rfid/dashboard?date=${date}`),
  ]);
  const gateIn = d.devices.reduce((s, x) => s + x.gateIn, 0);
  const gateOut = d.devices.reduce((s, x) => s + x.gateOut, 0);
  const boarded = d.devices.reduce((s, x) => s + x.boarded, 0);
  const notIn = d.sections.reduce((s, x) => s + x.notIn, 0);
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
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          marginBottom: 'var(--sp-5)',
        }}
      >
        <KpiTile label={a('gateIn')} value={gateIn} />
        <KpiTile label={a('gateOut')} value={gateOut} />
        <KpiTile label={a('boarded')} value={boarded} />
        <KpiTile label={a('notIn')} value={notIn} hint={a('notInList')} />
        <KpiTile
          label={a('devices')}
          value={`${d.devices.filter((x) => x.health === 'online').length} / ${d.devices.length}`}
          hint={a('healths.online')}
        />
      </div>
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
        }}
      >
        <Card title={a('devices')}>
          <DataTable<RfidDashboard['devices'][number]>
            caption={a('devices')}
            density="dense"
            columns={[
              {
                key: 'code',
                header: a('deviceCode'),
                render: (x) => (
                  <>
                    <code>{x.code}</code> <span className="ep-kicker">{x.name}</span>
                  </>
                ),
              },
              {
                key: 'kind',
                header: a('kind'),
                render: (x) => `${a(`kinds.${x.kind}`)}${x.route ? ` · ${x.route}` : ''}`,
              },
              {
                key: 'health',
                header: a('health'),
                render: (x) => (
                  <Badge tone={healthTone(x.health)}>{a(`healths.${x.health}`)}</Badge>
                ),
              },
              {
                key: 'seen',
                header: a('lastSeen'),
                render: (x) =>
                  x.lastSeenAt ? new Date(x.lastSeenAt).toLocaleString('en-IN') : '—',
              },
              {
                key: 'counts',
                header: a('gateIn'),
                numeric: true,
                render: (x) =>
                  x.kind === 'gate'
                    ? `${x.gateIn} / ${x.gateOut}`
                    : x.kind === 'bus'
                      ? `${x.boarded} / ${x.alighted}`
                      : x.punches,
              },
              { key: 'rej', header: a('rejected'), numeric: true, render: (x) => x.gateRejected },
            ]}
            rows={d.devices}
            rowKey={(x) => x.id}
            emptyTitle={a('noDevices')}
          />
        </Card>
        <Card title={a('sections')}>
          <DataTable<RfidDashboard['sections'][number]>
            caption={a('sections')}
            density="dense"
            columns={[
              {
                key: 'section',
                header: a('section'),
                render: (x) => (
                  <a href={`/attendance/register?classSectionId=${x.classSectionId}&date=${date}`}>
                    {x.section}
                  </a>
                ),
              },
              { key: 'strength', header: a('strength'), numeric: true, render: (x) => x.strength },
              { key: 'tagged', header: a('tagged'), numeric: true, render: (x) => x.tagged },
              { key: 'in', header: a('inToday'), numeric: true, render: (x) => x.inToday },
              { key: 'late', header: a('late'), numeric: true, render: (x) => x.late },
              {
                key: 'notIn',
                header: a('notIn'),
                numeric: true,
                render: (x) => (x.notIn ? <Badge tone="warning">{x.notIn}</Badge> : 0),
              },
            ]}
            rows={d.sections.filter((x) => x.tagged > 0)}
            rowKey={(x) => x.classSectionId}
            emptyTitle={a('tagged')}
          />
        </Card>
        <Card title={a('notInList')}>
          <DataTable<RfidDashboard['notIn'][number]>
            caption={a('notInList')}
            density="dense"
            columns={[
              {
                key: 'name',
                header: a('student'),
                render: (x) => <a href={`/people/students/${x.id}`}>{x.name}</a>,
              },
              { key: 'section', header: a('section'), render: (x) => x.section },
              { key: 'tag', header: a('tag'), render: (x) => <code>{x.tag}</code> },
            ]}
            rows={d.notIn}
            rowKey={(x) => x.id}
            emptyTitle={a('inToday')}
          />
        </Card>
      </div>
    </>
  );
}
