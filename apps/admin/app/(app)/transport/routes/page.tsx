import {
  Badge,
  Button,
  Card,
  DataTable,
  FormActions,
  FormRow,
  InputField,
  PageHeader,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { createRoute } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { TransportRoute } from '@/lib/types';

export default async function RoutesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [t, tr, me, routes] = await Promise.all([
    getTranslations('pages.transport_routes'),
    getTranslations('transport'),
    getMe(),
    apiFetch<{ data: TransportRoute[] }>('/transport/routes').then((r) => r.data),
  ]);
  const canManage = me.permissions.includes('transport.route.manage');
  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      <Notice params={sp} />
      <Card>
        <DataTable<TransportRoute>
          caption={t('title')}
          density="dense"
          columns={[
            {
              key: 'code',
              header: tr('code'),
              render: (r) => (
                <a href={`/transport/routes/${r.id}`}>
                  <strong>{r.code}</strong>
                </a>
              ),
            },
            {
              key: 'name',
              header: tr('name'),
              render: (r) => <a href={`/transport/routes/${r.id}`}>{r.name}</a>,
            },
            { key: 'vehicle', header: tr('vehicle'), render: (r) => r.vehicleNo ?? '' },
            {
              key: 'driver',
              header: tr('driver'),
              render: (r) => `${r.driverName ?? ''} ${r.driverMobile ?? ''}`.trim(),
            },
            { key: 'students', header: tr('students'), numeric: true, render: (r) => r.students },
            {
              key: 'status',
              header: tr('status'),
              render: (r) => (
                <Badge tone={r.status === 'active' ? 'success' : 'neutral'}>{r.status}</Badge>
              ),
            },
          ]}
          rows={routes}
          rowKey={(r) => r.id}
          emptyTitle={tr('noRoutes')}
        />
        {canManage ? (
          <form action={createRoute} style={{ marginTop: 'var(--sp-4)' }}>
            <FormRow columns={4}>
              <InputField id="code" name="code" label={tr('code')} required maxLength={20} />
              <InputField id="name" name="name" label={tr('name')} required maxLength={120} />
              <InputField id="vehicleNo" name="vehicleNo" label={tr('vehicle')} maxLength={20} />
              <InputField id="driverName" name="driverName" label={tr('driver')} maxLength={80} />
            </FormRow>
            <FormRow columns={4}>
              <InputField
                id="driverMobile"
                name="driverMobile"
                label={tr('driverMobile')}
                pattern="[6-9][0-9]{9}"
              />
            </FormRow>
            <FormActions>
              <Button type="submit">{tr('addRoute')}</Button>
            </FormActions>
          </form>
        ) : null}
      </Card>
    </>
  );
}
