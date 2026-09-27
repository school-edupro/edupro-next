import {
  Badge,
  Button,
  Card,
  DataTable,
  FormActions,
  FormRow,
  InputField,
  PageHeader,
  toneForStatus,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { createVehicle, setVehicleStatus } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { TransportVehicle } from '@/lib/types';

const soon = (iso: string | null) => {
  if (!iso) return 'none';
  const days = (new Date(iso).getTime() - Date.now()) / 86_400_000;
  return days < 0 ? 'expired' : days < 30 ? 'soon' : 'ok';
};

/** Sprint 12: the fleet. */
export default async function VehiclesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, tr, c, me, vehicles] = await Promise.all([
    getTranslations('pages.transport_vehicles'),
    getTranslations('transport'),
    getTranslations('common'),
    getMe(),
    apiFetch<{ data: TransportVehicle[] }>('/transport/vehicles').then((r) => r.data),
  ]);
  const canManage = me.permissions.includes('transport.fleet.manage');
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <Card>
        <DataTable<TransportVehicle>
          caption={t('title')}
          density="dense"
          columns={[
            { key: 'reg', header: tr('regNo'), render: (v) => <strong>{v.regNo}</strong> },
            { key: 'make', header: tr('make'), render: (v) => v.make ?? '' },
            { key: 'cap', header: tr('capacity'), numeric: true, render: (v) => v.capacity ?? '' },
            { key: 'ins', header: tr('insurance'), render: (v) => v.insuranceExpiry ?? '' },
            { key: 'fit', header: tr('fitness'), render: (v) => v.fitnessExpiry ?? '' },
            { key: 'permit', header: tr('permit'), render: (v) => v.permitExpiry ?? '' },
            {
              key: 'next',
              header: tr('nextExpiry'),
              render: (v) => {
                const s = soon(v.nextExpiry);
                return s === 'none' ? (
                  ''
                ) : (
                  <Badge tone={s === 'expired' ? 'danger' : s === 'soon' ? 'warning' : 'success'}>
                    {v.nextExpiry}
                    {s === 'expired'
                      ? ` · ${tr('expired')}`
                      : s === 'soon'
                        ? ` · ${tr('expiringSoon')}`
                        : ''}
                  </Badge>
                );
              },
            },
            { key: 'routes', header: tr('routesUsing'), render: (v) => v.routes.join(', ') },
            {
              key: 'status',
              header: c('status'),
              render: (v) => <Badge tone={toneForStatus(v.status)}>{c(v.status)}</Badge>,
            },
            {
              key: 'actions',
              header: '',
              render: (v) =>
                canManage ? (
                  <form action={setVehicleStatus}>
                    <input type="hidden" name="id" value={v.id} />
                    <input
                      type="hidden"
                      name="status"
                      value={v.status === 'active' ? 'inactive' : 'active'}
                    />
                    <Button type="submit" variant="ghost" size="sm">
                      {v.status === 'active' ? c('inactive') : c('active')}
                    </Button>
                  </form>
                ) : null,
            },
          ]}
          rows={vehicles}
          rowKey={(v) => v.id}
          emptyTitle={tr('noVehicles')}
        />
        {canManage ? (
          <form action={createVehicle} style={{ marginTop: 'var(--sp-4)' }}>
            <FormRow columns={4}>
              <InputField
                id="regNo"
                name="regNo"
                label={tr('regNo')}
                required
                pattern="[A-Za-z0-9 -]{4,16}"
              />
              <InputField id="make" name="make" label={tr('make')} maxLength={60} />
              <InputField
                id="capacity"
                name="capacity"
                label={tr('capacity')}
                type="number"
                min={1}
                max={200}
              />
              <InputField id="gpsDeviceId" name="gpsDeviceId" label={tr('gps')} maxLength={60} />
              <InputField
                id="insuranceExpiry"
                name="insuranceExpiry"
                label={tr('insurance')}
                type="date"
              />
              <InputField
                id="fitnessExpiry"
                name="fitnessExpiry"
                label={tr('fitness')}
                type="date"
              />
              <InputField id="permitExpiry" name="permitExpiry" label={tr('permit')} type="date" />
            </FormRow>
            <FormActions>
              <Button type="submit" variant="secondary">
                {tr('addVehicle')}
              </Button>
            </FormActions>
          </form>
        ) : null}
      </Card>
    </>
  );
}
