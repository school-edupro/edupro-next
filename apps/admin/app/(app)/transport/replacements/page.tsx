import { Alert, Badge, Button, Card, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { TransportNav } from '@/components/transport/TransportNav';
import { apiFetch, getMe } from '@/lib/api';
import { today, when } from '@/lib/appointments';
import { createReplacement, endReplacement } from '@/lib/transport-desk-actions';
import { dayLabel, type Replacement } from '@/lib/transport-desk';

interface Options {
  vehicles: Array<{
    id: string;
    regNo: string;
    name: string | null;
    seats: number | null;
    gps: boolean;
    routes: string;
  }>;
  crew: Array<{ id: string; name: string; mobile: string | null; role: string }>;
}
const TABS = ['now', 'upcoming', 'past', 'all'] as const;
type Tab = (typeof TABS)[number];
const PHASE: Record<string, [string, 'warning' | 'info' | 'neutral' | 'danger']> = {
  running: ['Running now', 'warning'],
  upcoming: ['To start', 'info'],
  over: ['Over', 'neutral'],
  cancelled: ['Called off', 'neutral'],
};

/**
 * Replacement buses: a vehicle that is off the road (breakdown, maintenance) gets another vehicle and
 * crew for some days. Every route the vehicle runs follows the replacement on those days, the parents'
 * live tracking too; the parents are told when it is saved and again when the regular bus is back.
 */
export default async function ReplacementsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    add?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const tab: Tab = TABS.includes(sp.tab as Tab) ? (sp.tab as Tab) : 'now';
  const me = await getMe();
  const manage = me.permissions.includes('transport.replacement.manage');
  const [list, options] = await Promise.all([
    apiFetch<{ data: Replacement[]; counts: { now: number; upcoming: number } }>(
      `/transport/replacements?tab=${tab}`,
    ),
    manage && sp.add ? apiFetch<Options>('/transport/replacements/options') : Promise.resolve(null),
  ]);
  const tabs: Array<[Tab, string, number | null]> = [
    ['now', 'Running now', list.counts.now],
    ['upcoming', 'To start', list.counts.upcoming],
    ['past', 'Over or called off', null],
    ['all', 'Everything', null],
  ];
  const crewOf = (role: string) => (options?.crew ?? []).filter((p) => p.role === role);
  return (
    <>
      <PageHeader
        kicker="Transport"
        title="Replacement bus"
        description="When a bus is off the road, map another bus and crew for those days. Parents of its routes are told at once, and their live tracking follows the replacement."
        actions={
          manage && !sp.add ? (
            <a className="ep-btn ep-btn--primary ep-btn--sm" href="/transport/replacements?add=1">
              Arrange a replacement
            </a>
          ) : null
        }
      />
      <TransportNav current="/transport/replacements" permissions={me.permissions} ok={sp.ok} />
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      {options ? (
        <Card title="Arrange a replacement" style={{ marginBottom: 'var(--sp-4)' }}>
          {options.vehicles.length < 2 ? (
            <Alert tone="warning">
              At least two vehicles are needed. Add vehicles under Transport setup first.
            </Alert>
          ) : (
            <form action={createReplacement} className="ep-hd__form">
              <div className="ep-hd__row">
                <label className="ep-field" htmlFor="rb-vehicle">
                  <span className="ep-field__label">Vehicle off the road</span>
                  <select
                    id="rb-vehicle"
                    name="vehicleId"
                    className="ep-select"
                    required
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Choose the vehicle
                    </option>
                    {options.vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.regNo}
                        {v.name ? ` · ${v.name}` : ''} ·{' '}
                        {v.routes ? `routes ${v.routes}` : 'no route'}
                      </option>
                    ))}
                  </select>
                  <span className="ep-field__help">
                    Every route this vehicle runs gets the replacement.
                  </span>
                </label>
                <label className="ep-field" htmlFor="rb-replacement">
                  <span className="ep-field__label">Replacement vehicle</span>
                  <select
                    id="rb-replacement"
                    name="replacementVehicleId"
                    className="ep-select"
                    required
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Choose the vehicle
                    </option>
                    {options.vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.regNo}
                        {v.name ? ` · ${v.name}` : ''}
                        {v.seats ? ` · ${String(v.seats)} seats` : ''} ·{' '}
                        {v.gps ? 'GPS' : 'no GPS device'}
                      </option>
                    ))}
                  </select>
                  <span className="ep-field__help">
                    Parents can track it only when it has a GPS device.
                  </span>
                </label>
              </div>
              <div className="ep-hd__row">
                {(
                  [
                    ['driverId', 'Driver', 'driver'],
                    ['conductorId', 'Conductor', 'conductor'],
                    ['attendantId', 'Attendant (support staff)', 'attendant'],
                  ] as const
                ).map(([name, label, role]) => (
                  <label key={name} className="ep-field" htmlFor={`rb-${name}`}>
                    <span className="ep-field__label">{label}</span>
                    <select id={`rb-${name}`} name={name} className="ep-select" defaultValue="">
                      <option value="">{role === 'driver' ? 'Choose the driver' : 'None'}</option>
                      {crewOf(role).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.mobile ? ` · ${p.mobile}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <div className="ep-hd__row">
                <label className="ep-field" htmlFor="rb-from">
                  <span className="ep-field__label">From (first day)</span>
                  <input
                    id="rb-from"
                    name="fromDate"
                    type="date"
                    className="ep-input"
                    required
                    defaultValue={today()}
                  />
                </label>
                <label className="ep-field" htmlFor="rb-to">
                  <span className="ep-field__label">To (last day)</span>
                  <input
                    id="rb-to"
                    name="toDate"
                    type="date"
                    className="ep-input"
                    required
                    defaultValue={today()}
                  />
                </label>
                <label className="ep-field" htmlFor="rb-reason">
                  <span className="ep-field__label">Reason</span>
                  <input
                    id="rb-reason"
                    name="reason"
                    className="ep-input"
                    required
                    minLength={3}
                    maxLength={300}
                    placeholder="Breakdown, maintenance, fitness test"
                  />
                </label>
              </div>
              <p className="ep-field__help" style={{ margin: 0 }}>
                Saving tells the parents of the vehicle’s routes by email, and by SMS and WhatsApp
                where the template is ready: the replacement bus, the driver’s name and phone, and
                the days.
              </p>
              <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                <Button type="submit">Save and tell the parents</Button>
                <a className="ep-btn ep-btn--secondary" href="/transport/replacements">
                  Cancel
                </a>
              </div>
            </form>
          )}
        </Card>
      ) : null}
      <nav className="ep-tabs-links" aria-label="Lists" style={{ marginBottom: 'var(--sp-3)' }}>
        {tabs.map(([value, label, n]) => (
          <a
            key={value}
            href={`/transport/replacements?tab=${value}`}
            aria-current={tab === value ? 'page' : undefined}
          >
            {label}
            {n === null ? '' : ` · ${String(n)}`}
          </a>
        ))}
      </nav>
      {list.data.length === 0 ? (
        <Card>
          <p className="ep-field__help" style={{ margin: 0 }}>
            {tab === 'now' ? 'Every bus is on its own route today.' : 'Nothing here.'}
          </p>
        </Card>
      ) : null}
      {list.data.map((x) => (
        <Card
          key={x.id}
          title={`${x.vehicle} → ${x.replacement}`}
          actions={<Badge tone={PHASE[x.phase]![1]}>{PHASE[x.phase]![0]}</Badge>}
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          <dl className="ep-sheet__grid">
            {(
              [
                ['Replacement no.', x.number],
                ['Routes', x.routes || 'The vehicle runs no route'],
                ['Days', `${dayLabel(x.fromDate)} – ${dayLabel(x.toDate)}`],
                ['Reason', x.reason],
                [
                  'Replacement bus',
                  `${x.replacement}${x.replacementName ? ` · ${x.replacementName}` : ''}${x.replacementSeats ? ` · ${String(x.replacementSeats)} seats` : ''}`,
                ],
                [
                  'Live tracking',
                  x.replacementGps
                    ? 'Follows the replacement bus'
                    : 'The replacement has no GPS device',
                ],
                [
                  'Driver',
                  x.driver ? `${x.driver}${x.driverMobile ? ` · ${x.driverMobile}` : ''}` : null,
                ],
                [
                  'Conductor',
                  x.conductor
                    ? `${x.conductor}${x.conductorMobile ? ` · ${x.conductorMobile}` : ''}`
                    : null,
                ],
                ['Attendant', x.attendant],
                [
                  'Parents told',
                  x.notifiedAt ? `${when(x.notifiedAt)} · ${String(x.notified)} message(s)` : null,
                ],
                ['Told the bus is back', x.backNotifiedAt ? when(x.backNotifiedAt) : null],
                ['Arranged by', x.createdBy ? `${x.createdBy} on ${when(x.createdAt)}` : null],
                ['Note', x.endedNote],
              ] as Array<[string, string | null]>
            )
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
          {x.seats && x.replacementSeats && x.replacementSeats < x.seats ? (
            <p className="ep-field__error" role="status">
              The replacement has {x.replacementSeats} seats; the regular bus has {x.seats}.
            </p>
          ) : null}
          {manage && (x.phase === 'running' || x.phase === 'upcoming') ? (
            <form
              action={endReplacement}
              className="ep-gate__act"
              style={{ marginTop: 'var(--sp-3)' }}
            >
              <input type="hidden" name="id" value={x.id} />
              <input
                name="note"
                className="ep-input"
                maxLength={300}
                placeholder="Note (optional)"
                aria-label={`Note for ending ${x.number}`}
              />
              <Button type="submit" size="sm" variant="secondary">
                {x.phase === 'running' ? 'Regular bus is back' : 'Call off'}
              </Button>
            </form>
          ) : null}
        </Card>
      ))}
    </>
  );
}
