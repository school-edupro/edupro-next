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
import { assignRouteStudents, unassignRouteStudent } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import { sectionOptions } from '@/lib/sections';
import type { Page, RouteStudent, Student, TransportRoute } from '@/lib/types';

export default async function RoutePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; classSectionId?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [t, tr, me, routes, riders, sections] = await Promise.all([
    getTranslations('pages.transport_routes'),
    getTranslations('transport'),
    getMe(),
    apiFetch<{ data: TransportRoute[] }>('/transport/routes').then((r) => r.data),
    apiFetch<{ data: RouteStudent[] }>(`/transport/routes/${id}/students`).then((r) => r.data),
    sectionOptions(),
  ]);
  const route = routes.find((r) => r.id === id);
  const canManage = me.permissions.includes('transport.route.manage');
  const students = sp.classSectionId
    ? await apiFetch<Page<Student>>(
        `/people/students?classSectionId=${sp.classSectionId}&size=200`,
      ).then((r) => r.data)
    : [];
  const onRoute = new Set(riders.map((r) => r.studentId));
  return (
    <>
      <Breadcrumbs
        items={[
          { label: t('kicker'), href: '/transport/routes' },
          { label: t('title'), href: '/transport/routes' },
          { label: route?.code ?? id },
        ]}
      />
      <PageHeader
        kicker={t('kicker')}
        title={route ? `${route.code} · ${route.name}` : id}
        description={
          route
            ? `${route.vehicleNo ?? ''} · ${route.driverName ?? ''} ${route.driverMobile ?? ''}`
            : ''
        }
      />
      <Notice params={sp} />
      <div
        style={{
          display: 'grid',
          gap: 'var(--sp-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
        }}
      >
        <Card title={`${tr('riders')} · ${riders.length}`}>
          <DataTable<RouteStudent>
            caption={tr('riders')}
            density="dense"
            columns={[
              {
                key: 'name',
                header: tr('students'),
                render: (r) => <a href={`/people/students/${r.studentId}`}>{r.name}</a>,
              },
              { key: 'section', header: tr('section'), render: (r) => r.section ?? '' },
              { key: 'stop', header: tr('stop'), render: (r) => r.stopName ?? '' },
              { key: 'pickup', header: tr('pickup'), render: (r) => r.pickupTime ?? '' },
              { key: 'drop', header: tr('drop'), render: (r) => r.dropTime ?? '' },
              {
                key: 'mobile',
                header: tr('guardianMobile'),
                render: (r) => r.guardianMobile ?? '',
              },
              ...(canManage
                ? [
                    {
                      key: 'remove',
                      header: '',
                      render: (r: RouteStudent) => (
                        <form action={unassignRouteStudent}>
                          <input type="hidden" name="id" value={id} />
                          <input type="hidden" name="studentId" value={r.studentId} />
                          <Button type="submit" variant="ghost" size="sm">
                            {tr('remove')}
                          </Button>
                        </form>
                      ),
                    },
                  ]
                : []),
            ]}
            rows={riders}
            rowKey={(r) => r.studentId}
            emptyTitle={tr('noRiders')}
          />
        </Card>
        {canManage ? (
          <Card title={tr('assign')}>
            <p className="ep-field__help">{tr('assignHelp')}</p>
            <form
              method="get"
              style={{
                display: 'flex',
                gap: 'var(--sp-3)',
                alignItems: 'flex-end',
                marginBottom: 'var(--sp-3)',
              }}
            >
              <SelectField
                id="classSectionId"
                name="classSectionId"
                label={tr('section')}
                defaultValue={sp.classSectionId ?? ''}
                options={[{ value: '', label: '—' }, ...sections]}
              />
              <Button type="submit" variant="secondary">
                {tr('section')}
              </Button>
            </form>
            {students.length ? (
              <form action={assignRouteStudents}>
                <input type="hidden" name="id" value={id} />
                <label className="ep-field" htmlFor="studentId">
                  <span className="ep-field__label">{tr('students')}</span>
                  <select id="studentId" name="studentId" className="ep-input" multiple size={8}>
                    {students.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.displayName} · {s.admissionNo}
                        {onRoute.has(s.id) ? ' ✓' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <FormRow columns={3}>
                  <InputField id="stopName" name="stopName" label={tr('stop')} maxLength={80} />
                  <InputField id="pickupTime" name="pickupTime" label={tr('pickup')} type="time" />
                  <InputField id="dropTime" name="dropTime" label={tr('drop')} type="time" />
                </FormRow>
                <FormActions>
                  <Button type="submit">{tr('assign')}</Button>
                </FormActions>
              </form>
            ) : null}
          </Card>
        ) : null}
      </div>
    </>
  );
}
