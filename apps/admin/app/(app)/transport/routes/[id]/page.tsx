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
  TransportRoute,
  TransportStop,
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
  const [stops, stoppages, mapping] = await Promise.all([
    canFleet
      ? apiFetch<{ data: TransportStop[] }>(`/transport/routes/${id}/stops`).then((r) => r.data)
      : Promise.resolve<TransportStop[]>([]),
    // a stop is picked from the stoppage master, which owns its name, slab and place
    canFleetManage
      ? apiFetch<{ data: Array<Record<string, string | null>> }>(
          '/masters/transport_stoppages/rows?size=200&page=1&status=active',
        )
          .then((r) => r.data)
          .catch(() => [])
      : Promise.resolve([] as Array<Record<string, string | null>>),
    // which vehicle and crew run the route: the Route and vehicle mapping master
    canFleet && route
      ? apiFetch<{ data: Array<Record<string, string | null>> }>(
          `/masters/transport_route_vehicles/rows?size=50&page=1&q=${encodeURIComponent(route.code)}`,
        )
          .then((r) => r.data.filter((x) => x.route_id === route.code))
          .catch(() => [])
      : Promise.resolve([] as Array<Record<string, string | null>>),
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
          { label: t('kicker'), href: '/transport' },
          { label: t('title'), href: '/masters/transport?tab=transport_routes' },
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
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 560px), 1fr))',
        }}
      >
        {canFleet ? (
          <Card title={`${tr('stops')} · ${stops.length}`}>
            <p className="ep-field__help">
              Pick each stop from the stoppage master, in the order the bus calls, with its pick and
              drop time. The name, the slab and the map position come from the stoppage.{' '}
              <a
                href="/masters/transport?tab=transport_stoppages"
                style={{ textDecoration: 'underline' }}
              >
                Stoppage master
              </a>
            </p>
            {canFleetManage ? (
              <form action={setRouteStops}>
                <input type="hidden" name="id" value={id} />
                <table className="ep-table ep-table--dense">
                  <thead>
                    <tr>
                      <th>{tr('sequence')}</th>
                      <th>{tr('stop')}</th>
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
                          <select
                            className="ep-select"
                            name="stopName"
                            defaultValue={st?.name ?? ''}
                            aria-label={`${tr('stop')} ${idx + 1}`}
                          >
                            <option value="">
                              {st ? 'Remove this stop' : 'Choose the stoppage'}
                            </option>
                            {st && !stoppages.some((g) => g.name === st.name) ? (
                              <option value={st.name}>{st.name}</option>
                            ) : null}
                            {stoppages.map((g) => (
                              <option key={g.id} value={g.name ?? ''}>
                                {g.name}
                                {g.area ? ` · ${g.area}` : ''}
                                {g.slab_id ? ` · ${g.slab_id}` : ''}
                              </option>
                            ))}
                          </select>
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
                        <td>{st?.slabCode ?? '—'}</td>
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
        {canFleet && route ? (
          <Card
            title="Vehicle and crew"
            actions={
              canFleetManage ? (
                <a
                  className="ep-btn ep-btn--secondary ep-btn--sm"
                  href={`/masters/transport?tab=transport_route_vehicles&q=${encodeURIComponent(route.code)}`}
                >
                  Change the mapping
                </a>
              ) : null
            }
          >
            {mapping.length === 0 ? (
              <p className="ep-field__help" style={{ margin: 0 }}>
                No vehicle is mapped to this route yet. Add it under Transport setup → Route and
                vehicle mapping, with the driver, conductor and attendant.
              </p>
            ) : (
              <div
                className="ep-table-wrap"
                tabIndex={0}
                role="region"
                aria-label="Vehicle and crew"
              >
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">Vehicle and crew of {route.code}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Trip</th>
                      <th scope="col">Vehicle</th>
                      <th scope="col">Driver</th>
                      <th scope="col">Conductor</th>
                      <th scope="col">Attendant</th>
                      <th scope="col">From – to</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mapping.map((m) => (
                      <tr key={m.id}>
                        <td>
                          {m.shift === 'both'
                            ? 'Pick and drop'
                            : m.shift === 'pick'
                              ? 'Pick'
                              : 'Drop'}
                        </td>
                        <td>{m.vehicle_id}</td>
                        <td>{m.driver_id ?? '—'}</td>
                        <td>{m.conductor_id ?? '—'}</td>
                        <td>{m.attendant_id ?? '—'}</td>
                        <td>
                          {m.from_date || m.to_date
                            ? `${m.from_date ?? '…'} – ${m.to_date ?? '…'}`
                            : 'Always'}
                        </td>
                        <td>{m.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
