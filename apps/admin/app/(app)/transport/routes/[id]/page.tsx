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
import {
  assignRouteStudents,
  setRouteFleet,
  setRouteStops,
  unassignRouteStudent,
  updateRouteRules,
} from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import { sectionOptions } from '@/lib/sections';
import type {
  Page,
  RouteStudent,
  Student,
  TransportDriver,
  TransportRoute,
  TransportSlab,
  TransportStop,
  TransportVehicle,
} from '@/lib/types';

export default async function RoutePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string; classSectionId?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const [t, tr, a, me, routes, riders, sections] = await Promise.all([
    getTranslations('pages.transport_routes'),
    getTranslations('transport'),
    getTranslations('attendance'),
    getMe(),
    apiFetch<{ data: TransportRoute[] }>('/transport/routes').then((r) => r.data),
    apiFetch<{ data: RouteStudent[] }>(`/transport/routes/${id}/students`).then((r) => r.data),
    sectionOptions(),
  ]);
  const route = routes.find((r) => r.id === id);
  const canManage = me.permissions.includes('transport.route.manage');
  const canFleet = me.permissions.includes('transport.fleet.view');
  const canFleetManage = me.permissions.includes('transport.fleet.manage');
  const [stops, vehicles, drivers, slabs] = await Promise.all([
    canFleet
      ? apiFetch<{ data: TransportStop[] }>(`/transport/routes/${id}/stops`).then((r) => r.data)
      : Promise.resolve<TransportStop[]>([]),
    canFleetManage
      ? apiFetch<{ data: TransportVehicle[] }>('/transport/vehicles').then((r) => r.data)
      : Promise.resolve<TransportVehicle[]>([]),
    canFleetManage
      ? apiFetch<{ data: TransportDriver[] }>('/transport/drivers').then((r) => r.data)
      : Promise.resolve<TransportDriver[]>([]),
    canFleetManage
      ? apiFetch<{ data: TransportSlab[] }>('/fees/slabs')
          .then((r) => r.data)
          .catch(() => [] as TransportSlab[])
      : Promise.resolve<TransportSlab[]>([]),
  ]);
  const stopRows = [...stops, ...Array.from({ length: canFleetManage ? 3 : 0 }, () => null)];
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
        {canFleet ? (
          <Card title={`${tr('stops')} · ${stops.length}`}>
            <p className="ep-field__help">{tr('stopsHelp')}</p>
            {canFleetManage ? (
              <form action={setRouteStops}>
                <input type="hidden" name="id" value={id} />
                <table className="ep-table ep-table--dense">
                  <thead>
                    <tr>
                      <th>{tr('sequence')}</th>
                      <th>{tr('stop')}</th>
                      <th>{tr('lat')}</th>
                      <th>{tr('lng')}</th>
                      <th>{tr('pickup')}</th>
                      <th>{tr('drop')}</th>
                      <th>{tr('slab')}</th>
                      <th>{tr('students')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stopRows.map((st, idx) => (
                      <tr key={st ? st.id : `new-${idx}`}>
                        <td>{idx + 1}</td>
                        <td>
                          <input type="hidden" name="stopId" value={st?.id ?? ''} />
                          <input
                            className="ep-input"
                            name="stopName"
                            defaultValue={st?.name ?? ''}
                            maxLength={80}
                            aria-label={`${tr('stop')} ${idx + 1}`}
                          />
                        </td>
                        <td>
                          <input
                            className="ep-input"
                            name="lat"
                            type="number"
                            step="0.000001"
                            defaultValue={st?.lat ?? ''}
                            aria-label={`${tr('lat')} ${idx + 1}`}
                          />
                        </td>
                        <td>
                          <input
                            className="ep-input"
                            name="lng"
                            type="number"
                            step="0.000001"
                            defaultValue={st?.lng ?? ''}
                            aria-label={`${tr('lng')} ${idx + 1}`}
                          />
                        </td>
                        <td>
                          <input
                            className="ep-input"
                            name="pickupTime"
                            type="time"
                            defaultValue={st?.pickupTime ?? ''}
                            aria-label={`${tr('pickup')} ${idx + 1}`}
                          />
                        </td>
                        <td>
                          <input
                            className="ep-input"
                            name="dropTime"
                            type="time"
                            defaultValue={st?.dropTime ?? ''}
                            aria-label={`${tr('drop')} ${idx + 1}`}
                          />
                        </td>
                        <td>
                          <select
                            className="ep-select"
                            name="slabId"
                            defaultValue={st?.slabId ?? ''}
                            aria-label={`${tr('slab')} ${idx + 1}`}
                          >
                            <option value="">—</option>
                            {slabs.map((sl) => (
                              <option key={sl.id} value={sl.id}>
                                {sl.code}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>{st?.students ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <FormActions>
                  <Button type="submit" variant="secondary">
                    {tr('saveStops')}
                  </Button>
                </FormActions>
              </form>
            ) : (
              <DataTable<TransportStop>
                caption={tr('stops')}
                density="dense"
                columns={[
                  {
                    key: 'seq',
                    header: tr('sequence'),
                    numeric: true,
                    render: (st) => st.sequence,
                  },
                  { key: 'name', header: tr('stop'), render: (st) => st.name },
                  {
                    key: 'geo',
                    header: `${tr('lat')} / ${tr('lng')}`,
                    render: (st) => (st.lat ? `${st.lat}, ${st.lng}` : ''),
                  },
                  { key: 'pickup', header: tr('pickup'), render: (st) => st.pickupTime ?? '' },
                  { key: 'drop', header: tr('drop'), render: (st) => st.dropTime ?? '' },
                  { key: 'slab', header: tr('slab'), render: (st) => st.slabCode ?? '' },
                  { key: 'n', header: tr('students'), numeric: true, render: (st) => st.students },
                ]}
                rows={stops}
                rowKey={(st) => st.id}
                emptyTitle={tr('noStops')}
              />
            )}
          </Card>
        ) : null}
        {canFleetManage && route ? (
          <Card title={tr('fleet')}>
            <form action={setRouteFleet}>
              <input type="hidden" name="id" value={route.id} />
              <FormRow columns={2}>
                <SelectField
                  id="vehicleId"
                  name="vehicleId"
                  label={tr('vehicle')}
                  defaultValue={route.vehicleId ?? ''}
                  options={[
                    { value: '', label: tr('chooseVehicle') },
                    ...vehicles
                      .filter((v) => v.status === 'active' || v.id === route.vehicleId)
                      .map((v) => ({
                        value: v.id,
                        label: `${v.regNo}${v.make ? ` · ${v.make}` : ''}`,
                      })),
                  ]}
                />
                <SelectField
                  id="driverId"
                  name="driverId"
                  label={tr('driver')}
                  defaultValue={route.driverId ?? ''}
                  options={[
                    { value: '', label: tr('chooseDriver') },
                    ...drivers
                      .filter((d) => d.status === 'active' || d.id === route.driverId)
                      .map((d) => ({
                        value: d.id,
                        label: `${d.name}${d.mobile ? ` · ${d.mobile}` : ''}`,
                      })),
                  ]}
                />
                <InputField
                  id="conductorName"
                  name="conductorName"
                  label={tr('conductor')}
                  defaultValue={route.conductorName ?? ''}
                  maxLength={80}
                />
                <InputField
                  id="conductorMobile"
                  name="conductorMobile"
                  label={tr('conductorMobile')}
                  defaultValue={route.conductorMobile ?? ''}
                  pattern="[6-9][0-9]{9}"
                  maxLength={10}
                />
              </FormRow>
              <FormActions>
                <Button type="submit" variant="secondary">
                  {tr('saveFleet')}
                </Button>
              </FormActions>
            </form>
          </Card>
        ) : null}
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
        {canManage && route ? (
          <Card title={a('routeRules')}>
            <form action={updateRouteRules}>
              <input type="hidden" name="id" value={route.id} />
              <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                <input type="checkbox" name="alertBoarding" defaultChecked={route.alertBoarding} />{' '}
                {a('alertBoarding')}
              </label>
              <label
                style={{
                  display: 'flex',
                  gap: 'var(--sp-2)',
                  alignItems: 'center',
                  marginTop: 'var(--sp-2)',
                }}
              >
                <input
                  type="checkbox"
                  name="alertAlighting"
                  defaultChecked={route.alertAlighting}
                />{' '}
                {a('alertAlighting')}
              </label>
              <FormRow columns={2}>
                <InputField
                  id="lateAfter"
                  name="lateAfter"
                  label={a('routeLateAfter')}
                  type="time"
                  defaultValue={route.lateAfter ?? ''}
                />
              </FormRow>
              <FormActions>
                <Button type="submit" variant="secondary">
                  {a('saveRules')}
                </Button>
              </FormActions>
            </form>
          </Card>
        ) : null}
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
                <FormRow columns={4}>
                  {stops.length ? (
                    <SelectField
                      id="stopId"
                      name="stopId"
                      label={tr('stopOnRoute')}
                      options={[
                        { value: '', label: tr('chooseStop') },
                        ...stops.map((st) => ({
                          value: st.id,
                          label: `${st.sequence}. ${st.name}${st.pickupTime ? ` · ${st.pickupTime}` : ''}`,
                        })),
                      ]}
                    />
                  ) : null}
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
