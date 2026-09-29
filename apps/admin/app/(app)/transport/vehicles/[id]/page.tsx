import {
  Breadcrumbs,
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
import { addVehicleLog } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { TransportDriver, TransportRoute, TransportVehicle, VehicleLog } from '@/lib/types';

/** Sprint 13: the daily log of one vehicle. */
export default async function VehicleLogPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const q = new URLSearchParams();
  if (sp.from) q.set('from', sp.from);
  if (sp.to) q.set('to', sp.to);
  const [t, tr, me, vehicles, logs, routes, drivers] = await Promise.all([
    getTranslations('pages.transport_vehicle_logs'),
    getTranslations('transport'),
    getMe(),
    apiFetch<{ data: TransportVehicle[] }>('/transport/vehicles').then((r) => r.data),
    apiFetch<{ data: VehicleLog[] }>(`/transport/vehicles/${id}/logs?${q.toString()}`).then(
      (r) => r.data,
    ),
    apiFetch<{ data: TransportRoute[] }>('/transport/routes').then((r) => r.data),
    apiFetch<{ data: TransportDriver[] }>('/transport/drivers').then((r) => r.data),
  ]);
  const vehicle = vehicles.find((v) => v.id === id);
  const canManage = me.permissions.includes('transport.log.manage');
  const today = new Date().toISOString().slice(0, 10);
  const km = logs.reduce((s, l) => s + (l.km ?? 0), 0);
  const fuel = logs.reduce((s, l) => s + Number(l.fuelLitres ?? 0), 0);
  const cost = logs.reduce((s, l) => s + Number(l.fuelCost ?? 0), 0);
  return (
    <>
      <Breadcrumbs
        items={[
          { label: tr('vehicle'), href: '/transport/vehicles' },
          { label: vehicle?.regNo ?? id },
        ]}
      />
      <PageHeader
        kicker={t('kicker')}
        title={`${t('title')} · ${vehicle?.regNo ?? id}`}
        description={t('description')}
        actions={
          <form
            method="get"
            style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}
          >
            <InputField
              id="from"
              name="from"
              label={tr('from')}
              type="date"
              defaultValue={sp.from ?? ''}
            />
            <InputField id="to" name="to" label={tr('to')} type="date" defaultValue={sp.to ?? ''} />
            <Button type="submit" variant="secondary">
              {tr('openLog')}
            </Button>
          </form>
        }
      />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-3)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          marginBottom: 'var(--sp-4)',
        }}
      >
        {(
          [
            [tr('km'), String(km)],
            [tr('fuelLitres'), fuel.toFixed(2)],
            [tr('fuelCost'), `₹${cost.toFixed(2)}`],
            [tr('logs'), String(logs.length)],
          ] as const
        ).map(([label, value]) => (
          <Card key={label} elevated>
            <div className="ep-kicker">{label}</div>
            <div
              style={{
                fontFamily: 'var(--font-heading)',
                fontSize: 'var(--fs-h3)',
                fontWeight: 600,
              }}
            >
              {value}
            </div>
          </Card>
        ))}
      </div>
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 560px), 1fr))',
        }}
      >
        <Card title={tr('logs')}>
          <DataTable<VehicleLog>
            caption={tr('logs')}
            density="dense"
            columns={[
              { key: 'date', header: tr('logDate'), render: (l) => <strong>{l.logDate}</strong> },
              { key: 'route', header: tr('name'), render: (l) => l.routeCode ?? '—' },
              { key: 'driver', header: tr('driver'), render: (l) => l.driverName ?? '—' },
              {
                key: 'start',
                header: tr('odometerStart'),
                numeric: true,
                render: (l) => l.odometerStart ?? '—',
              },
              {
                key: 'end',
                header: tr('odometerEnd'),
                numeric: true,
                render: (l) => l.odometerEnd ?? '—',
              },
              { key: 'km', header: tr('km'), numeric: true, render: (l) => l.km ?? '—' },
              {
                key: 'fuel',
                header: tr('fuelLitres'),
                numeric: true,
                render: (l) => l.fuelLitres ?? '—',
              },
              {
                key: 'cost',
                header: tr('fuelCost'),
                numeric: true,
                render: (l) => l.fuelCost ?? '—',
              },
              { key: 'trips', header: tr('trips'), numeric: true, render: (l) => l.trips ?? '—' },
              { key: 'incident', header: tr('incident'), render: (l) => l.incident ?? '' },
            ]}
            rows={logs}
            rowKey={(l) => l.id}
            emptyTitle={tr('noLogs')}
          />
        </Card>
        {canManage ? (
          <Card title={tr('addLog')}>
            <p className="ep-field__help">{tr('logHelp')}</p>
            <form action={addVehicleLog}>
              <input type="hidden" name="vehicleId" value={id} />
              <FormRow columns={3}>
                <InputField
                  id="logDate"
                  name="logDate"
                  label={tr('logDate')}
                  type="date"
                  required
                  defaultValue={today}
                />
                <SelectField
                  id="routeId"
                  name="routeId"
                  label={tr('name')}
                  options={[
                    { value: '', label: '—' },
                    ...routes.map((r) => ({ value: r.id, label: `${r.code} ${r.name}` })),
                  ]}
                />
                <SelectField
                  id="driverId"
                  name="driverId"
                  label={tr('driver')}
                  options={[
                    { value: '', label: '—' },
                    ...drivers.map((d) => ({ value: d.id, label: d.name })),
                  ]}
                />
              </FormRow>
              <FormRow columns={3}>
                <InputField
                  id="odometerStart"
                  name="odometerStart"
                  label={tr('odometerStart')}
                  type="number"
                  min={0}
                />
                <InputField
                  id="odometerEnd"
                  name="odometerEnd"
                  label={tr('odometerEnd')}
                  type="number"
                  min={0}
                />
                <InputField
                  id="trips"
                  name="trips"
                  label={tr('trips')}
                  type="number"
                  min={0}
                  max={50}
                />
              </FormRow>
              <FormRow columns={2}>
                <InputField
                  id="fuelLitres"
                  name="fuelLitres"
                  label={tr('fuelLitres')}
                  type="number"
                  min={0}
                  step="0.01"
                />
                <InputField
                  id="fuelCost"
                  name="fuelCost"
                  label={tr('fuelCost')}
                  type="number"
                  min={0}
                  step="0.01"
                />
              </FormRow>
              <FormRow columns={1}>
                <InputField id="incident" name="incident" label={tr('incident')} maxLength={500} />
              </FormRow>
              <FormRow columns={1}>
                <InputField id="remarks" name="remarks" label={tr('remarks')} maxLength={500} />
              </FormRow>
              <FormActions>
                <Button type="submit">{tr('addLog')}</Button>
              </FormActions>
            </form>
          </Card>
        ) : null}
      </div>
    </>
  );
}
