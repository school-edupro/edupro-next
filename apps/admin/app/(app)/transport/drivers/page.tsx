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
import { createDriver, setDriverStatus } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { TransportDriver } from '@/lib/types';

/** Sprint 12: drivers of the fleet. */
export default async function DriversPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, tr, c, me, drivers] = await Promise.all([
    getTranslations('pages.transport_drivers'),
    getTranslations('transport'),
    getTranslations('common'),
    getMe(),
    apiFetch<{ data: TransportDriver[] }>('/transport/drivers').then((r) => r.data),
  ]);
  const canManage = me.permissions.includes('transport.fleet.manage');
  const expired = (iso: string | null) => !!iso && new Date(iso).getTime() < Date.now();
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <Card>
        <DataTable<TransportDriver>
          caption={t('title')}
          density="dense"
          columns={[
            { key: 'name', header: c('name'), render: (d) => <strong>{d.name}</strong> },
            { key: 'mobile', header: tr('mobile'), render: (d) => d.mobile ?? '' },
            { key: 'lic', header: tr('licenceNo'), render: (d) => d.licenceNo ?? '' },
            {
              key: 'exp',
              header: tr('licenceExpiry'),
              render: (d) =>
                d.licenceExpiry ? (
                  <Badge tone={expired(d.licenceExpiry) ? 'danger' : 'success'}>
                    {d.licenceExpiry}
                    {expired(d.licenceExpiry) ? ` · ${tr('expired')}` : ''}
                  </Badge>
                ) : (
                  ''
                ),
            },
            { key: 'routes', header: tr('routesUsing'), render: (d) => d.routes.join(', ') },
            {
              key: 'status',
              header: c('status'),
              render: (d) => <Badge tone={toneForStatus(d.status)}>{c(d.status)}</Badge>,
            },
            {
              key: 'actions',
              header: '',
              render: (d) =>
                canManage ? (
                  <form action={setDriverStatus}>
                    <input type="hidden" name="id" value={d.id} />
                    <input
                      type="hidden"
                      name="status"
                      value={d.status === 'active' ? 'inactive' : 'active'}
                    />
                    <Button type="submit" variant="ghost" size="sm">
                      {d.status === 'active' ? c('inactive') : c('active')}
                    </Button>
                  </form>
                ) : null,
            },
          ]}
          rows={drivers}
          rowKey={(d) => d.id}
          emptyTitle={tr('noDrivers')}
        />
        {canManage ? (
          <form action={createDriver} style={{ marginTop: 'var(--sp-4)' }}>
            <FormRow columns={4}>
              <InputField id="name" name="name" label={c('name')} required maxLength={80} />
              <InputField
                id="mobile"
                name="mobile"
                label={tr('mobile')}
                pattern="[6-9][0-9]{9}"
                maxLength={10}
              />
              <InputField id="licenceNo" name="licenceNo" label={tr('licenceNo')} maxLength={30} />
              <InputField
                id="licenceExpiry"
                name="licenceExpiry"
                label={tr('licenceExpiry')}
                type="date"
              />
            </FormRow>
            <FormActions>
              <Button type="submit" variant="secondary">
                {tr('addDriver')}
              </Button>
            </FormActions>
          </form>
        ) : null}
      </Card>
    </>
  );
}
