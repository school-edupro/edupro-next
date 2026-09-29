import {
  Badge,
  Button,
  Card,
  DataTable,
  FormActions,
  FormRow,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { createRfidDevice } from '@/lib/actions';
import { apiFetch } from '@/lib/api';
import type { RfidDevice, RfidEvent, TransportRoute } from '@/lib/types';

const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const outcomeTone = (o: string) =>
  o.startsWith('marked') || o === 'out_recorded'
    ? 'success'
    : o === 'unknown_tag'
      ? 'danger'
      : o === 'duplicate' || o === 'holiday'
        ? 'neutral'
        : 'warning';

/** S9-07: gate readers and the tap log. */
export default async function RfidPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    key?: string;
    date?: string;
  }>;
}) {
  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today();
  const [t, a, devices, routes, log] = await Promise.all([
    getTranslations('pages.attendance_rfid'),
    getTranslations('attendance'),
    apiFetch<{ data: RfidDevice[] }>('/attendance/rfid/devices').then((r) => r.data),
    apiFetch<{ data: TransportRoute[] }>('/transport/routes')
      .then((r) => r.data)
      .catch(() => [] as TransportRoute[]),
    apiFetch<{ data: RfidEvent[] }>(`/attendance/rfid/log?date=${date}&limit=200`).then(
      (r) => r.data,
    ),
  ]);
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      {sp.key ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {a('keyShown')} <code>{sp.key}</code>
        </div>
      ) : null}
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 560px), 1fr))',
        }}
      >
        <Card title={a('devices')}>
          <DataTable<RfidDevice>
            caption={a('devices')}
            density="dense"
            columns={[
              { key: 'code', header: a('deviceCode'), render: (d) => <code>{d.code}</code> },
              { key: 'name', header: a('deviceName'), render: (d) => d.name },
              {
                key: 'kind',
                header: a('kind'),
                render: (d) => `${a(`kinds.${d.kind}`)}${d.route ? ` · ${d.route}` : ''}`,
              },
              {
                key: 'dir',
                header: a('direction'),
                render: (d) => a(`directions.${d.direction ?? ''}`),
              },
              {
                key: 'seen',
                header: a('lastSeen'),
                render: (d) =>
                  d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString('en-IN') : '—',
              },
              { key: 'events', header: a('eventsToday'), numeric: true, render: (d) => d.events },
              {
                key: 'status',
                header: '',
                render: (d) => (
                  <Badge tone={d.status === 'active' ? 'success' : 'neutral'}>{d.status}</Badge>
                ),
              },
            ]}
            rows={devices}
            rowKey={(d) => d.id}
            emptyTitle={a('noDevices')}
          />
          <form action={createRfidDevice} style={{ marginTop: 'var(--sp-4)' }}>
            <FormRow columns={3}>
              <InputField
                id="code"
                name="code"
                label={a('deviceCode')}
                required
                maxLength={20}
                pattern="[A-Za-z0-9_-]+"
              />
              <InputField id="name" name="name" label={a('deviceName')} required maxLength={80} />
              <SelectField
                id="direction"
                name="direction"
                label={a('direction')}
                options={['', 'in', 'out'].map((d) => ({ value: d, label: a(`directions.${d}`) }))}
              />
            </FormRow>
            <FormRow columns={3}>
              <SelectField
                id="kind"
                name="kind"
                label={a('kind')}
                options={(['gate', 'bus', 'biometric'] as const).map((k) => ({
                  value: k,
                  label: a(`kinds.${k}`),
                }))}
              />
              <SelectField
                id="routeId"
                name="routeId"
                label={a('route')}
                options={[
                  { value: '', label: '—' },
                  ...routes.map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` })),
                ]}
              />
            </FormRow>
            <FormActions>
              <Button type="submit">{a('addDevice')}</Button>
            </FormActions>
          </form>
          <p className="ep-field__help">{a('ingest')}</p>
        </Card>
        <Card title={a('log')}>
          <form
            method="get"
            style={{
              display: 'flex',
              gap: 'var(--sp-3)',
              alignItems: 'flex-end',
              marginBottom: 'var(--sp-3)',
            }}
          >
            <InputField id="date" name="date" label={a('date')} type="date" defaultValue={date} />
            <Button type="submit" variant="secondary">
              {a('show')}
            </Button>
          </form>
          <DataTable<RfidEvent>
            caption={a('log')}
            density="dense"
            columns={[
              {
                key: 'at',
                header: a('occurredAt'),
                render: (e) =>
                  new Date(e.occurredAt).toLocaleTimeString('en-IN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  }),
              },
              { key: 'device', header: a('deviceCode'), render: (e) => e.device },
              { key: 'tag', header: a('tag'), render: (e) => <code>{e.tag}</code> },
              { key: 'student', header: a('student'), render: (e) => e.student ?? '—' },
              { key: 'dir', header: a('direction'), render: (e) => e.direction },
              {
                key: 'outcome',
                header: a('outcome'),
                render: (e) => <Badge tone={outcomeTone(e.outcome)}>{e.outcome}</Badge>,
              },
            ]}
            rows={log}
            rowKey={(e) => e.id}
            emptyTitle={a('noEvents')}
          />
        </Card>
      </div>
    </>
  );
}
