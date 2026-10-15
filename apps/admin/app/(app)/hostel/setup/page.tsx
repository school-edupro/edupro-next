import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { HostelNav } from '@/components/hostel/HostelNav';
import { Notice } from '@/components/Notice';
import { apiFetch, getMe } from '@/lib/api';
import {
  addBed,
  createRoom,
  deleteBlock,
  saveBlock,
  saveHostel,
  saveHostelRules,
  saveRoomType,
  saveSession,
  saveVisitHours,
  saveWardens,
  setBed,
  updateRoom,
} from '@/lib/hostel-actions';

interface Hostel {
  id: string;
  name: string;
  code: string;
  gender: 'boys' | 'girls' | 'mixed';
  address: string | null;
  phone: string | null;
  status: 'active' | 'closed';
  rooms: number;
  beds: number;
  taken: number;
  wardens: Array<{ employeeId: string; name: string; mobile: string | null; isHead: boolean }>;
  blocks: Array<{ id: string; name: string; floors: number }>;
}
interface RoomType {
  id: string;
  name: string;
  seater: number;
  ac: boolean;
  feeGroup: string | null;
  status: 'active' | 'inactive';
  rooms: number;
}
interface Room {
  id: string;
  hostelId: string;
  hostel: string;
  blockId: string | null;
  block: string | null;
  floor: number;
  roomNo: string;
  roomTypeId: string;
  roomType: string;
  status: 'active' | 'maintenance' | 'closed';
  remarks: string | null;
  beds: Array<{ id: string; label: string; status: 'active' | 'blocked'; used: boolean }>;
}
interface Rules {
  lateGraceMinutes: number;
  escalateAfterHours: number;
  outingReturnBy: string;
  alertParentAbsent: boolean;
}
interface Session {
  id: string;
  hostelId: string;
  hostel: string;
  name: string;
  atTime: string;
  active: boolean;
}
interface Employee {
  id: string;
  displayName: string;
  designation: string | null;
}

const TABS = [
  { id: 'hostels', label: 'Hostels and wardens' },
  { id: 'types', label: 'Room types and fee' },
  { id: 'rooms', label: 'Rooms and beds' },
  { id: 'rules', label: 'Roll-call and leave rules' },
] as const;
const GENDER = { boys: 'Boys', girls: 'Girls', mixed: 'Boys and girls' } as const;

/** Hostel set-up: hostels with blocks and wardens, room types (seater, AC, fee group), rooms and beds. */
export default async function HostelSetupPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    hostel?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const tab = TABS.some((t) => t.id === sp.tab) ? sp.tab! : 'hostels';
  const me = await getMe();
  const [hostels, types] = await Promise.all([
    apiFetch<{ data: Hostel[] }>('/hostel/hostels').then((r) => r.data),
    apiFetch<{ data: RoomType[] }>('/hostel/room-types').then((r) => r.data),
  ]);
  const hostel = hostels.find((h) => h.id === sp.hostel) ?? hostels[0];
  const hours: Record<string, Array<{ weekday: number; from: string; to: string }>> = tab ===
  'rules'
    ? Object.fromEntries(
        await Promise.all(
          hostels.map(async (h) => [
            h.id,
            await apiFetch<{ data: Array<{ weekday: number; from: string; to: string }> }>(
              `/hostel/hostels/${h.id}/visit-hours`,
            ).then((r) => r.data),
          ]),
        ),
      )
    : {};
  const [rules, sessions] = await Promise.all([
    tab === 'rules' ? apiFetch<Rules>('/hostel/settings') : Promise.resolve<Rules | null>(null),
    tab === 'rules'
      ? apiFetch<{ data: Session[] }>('/hostel/sessions').then((r) => r.data)
      : Promise.resolve([] as Session[]),
  ]);
  const [rooms, employees] = await Promise.all([
    tab === 'rooms' && hostel
      ? apiFetch<{ data: Room[] }>(`/hostel/rooms?hostelId=${hostel.id}`).then((r) => r.data)
      : Promise.resolve([] as Room[]),
    tab === 'hostels'
      ? apiFetch<{ data: Employee[] }>('/people/employees?status=active&size=200')
          .then((r) => r.data)
          .catch(() => [] as Employee[])
      : Promise.resolve([] as Employee[]),
  ]);
  const back = (extra = '') =>
    `/hostel/setup?tab=${tab}${hostel ? `&hostel=${hostel.id}` : ''}${extra}`;
  return (
    <>
      <PageHeader
        kicker="Hostel"
        title="Set-up"
        description="Hostels with their blocks and wardens, the room types (seater, AC and the hostel fee group they pay by), and the rooms and beds."
      />
      <HostelNav current="/hostel/setup" permissions={me.permissions} />
      <Notice params={sp} />
      <nav className="ep-tabs-links" aria-label="Set-up" style={{ marginBottom: 'var(--sp-4)' }}>
        {TABS.map((t) => (
          <a
            key={t.id}
            href={`/hostel/setup?tab=${t.id}${hostel ? `&hostel=${hostel.id}` : ''}`}
            aria-current={t.id === tab ? 'page' : undefined}
          >
            {t.label}
          </a>
        ))}
      </nav>

      {tab === 'hostels' ? (
        <>
          {hostels.map((h) => (
            <Card
              key={h.id}
              title={`${h.name} (${h.code})`}
              actions={
                <Badge tone={h.status === 'active' ? 'success' : 'neutral'}>
                  {GENDER[h.gender]} · {h.rooms} rooms · {h.taken}/{h.beds} beds taken
                </Badge>
              }
              style={{ marginBottom: 'var(--sp-4)' }}
            >
              <div className="hs-two">
                <form action={saveHostel} className="hs-form">
                  <h3 className="hs-h">Details</h3>
                  <input type="hidden" name="id" value={h.id} />
                  <input type="hidden" name="returnTo" value={back()} />
                  <HostelFields h={h} prefix={`h${h.id}`} />
                  <Button type="submit" variant="secondary">
                    Save
                  </Button>
                </form>
                <div className="hs-form">
                  <h3 className="hs-h">Wardens</h3>
                  <form action={saveWardens} style={{ display: 'grid', gap: 'var(--sp-2)' }}>
                    <input type="hidden" name="hostelId" value={h.id} />
                    <input type="hidden" name="returnTo" value={back()} />
                    {h.wardens.length === 0 ? (
                      <p className="ep-field__help">No warden yet.</p>
                    ) : null}
                    {h.wardens.map((w) => (
                      <div
                        key={w.employeeId}
                        style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}
                      >
                        <label>
                          <input
                            type="checkbox"
                            name="employeeId"
                            value={w.employeeId}
                            defaultChecked
                          />{' '}
                          {w.name}
                          {w.mobile ? (
                            <small className="ep-field__help"> · {w.mobile}</small>
                          ) : null}
                        </label>
                        <label>
                          <input
                            type="radio"
                            name="head"
                            value={w.employeeId}
                            defaultChecked={w.isHead}
                          />{' '}
                          Head warden
                        </label>
                      </div>
                    ))}
                    <label className="ep-field" htmlFor={`w-add-${h.id}`}>
                      <span className="ep-field__label">Add a warden</span>
                      <select
                        id={`w-add-${h.id}`}
                        name="employeeId"
                        className="ep-select"
                        defaultValue=""
                      >
                        <option value="">—</option>
                        {employees
                          .filter((e) => !h.wardens.some((w) => w.employeeId === e.id))
                          .map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.displayName}
                              {e.designation ? ` · ${e.designation}` : ''}
                            </option>
                          ))}
                      </select>
                      <span className="ep-field__help">
                        Untick a warden to remove them. Give each warden the Warden role (Access →
                        Users) so they see this hostel in the staff app.
                      </span>
                    </label>
                    <Button type="submit" variant="secondary">
                      Save wardens
                    </Button>
                  </form>
                  <h3 className="hs-h" style={{ marginTop: 'var(--sp-3)' }}>
                    Blocks
                  </h3>
                  {h.blocks.map((b) => (
                    <div
                      key={b.id}
                      style={{
                        display: 'flex',
                        gap: 'var(--sp-2)',
                        alignItems: 'end',
                        flexWrap: 'wrap',
                      }}
                    >
                      <form
                        action={saveBlock}
                        style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'end' }}
                      >
                        <input type="hidden" name="id" value={b.id} />
                        <input type="hidden" name="hostelId" value={h.id} />
                        <input type="hidden" name="returnTo" value={back()} />
                        <label className="ep-field" htmlFor={`b-n-${b.id}`}>
                          <span className="ep-field__label">Block</span>
                          <input
                            id={`b-n-${b.id}`}
                            name="name"
                            className="ep-input"
                            defaultValue={b.name}
                            required
                            maxLength={40}
                          />
                        </label>
                        <label className="ep-field" htmlFor={`b-f-${b.id}`}>
                          <span className="ep-field__label">Floors</span>
                          <input
                            id={`b-f-${b.id}`}
                            name="floors"
                            type="number"
                            min={1}
                            max={40}
                            className="ep-input"
                            defaultValue={b.floors}
                          />
                        </label>
                        <Button type="submit" variant="ghost" size="sm">
                          Save
                        </Button>
                      </form>
                      <form action={deleteBlock}>
                        <input type="hidden" name="id" value={b.id} />
                        <input type="hidden" name="returnTo" value={back()} />
                        <Button type="submit" variant="ghost" size="sm">
                          Remove
                        </Button>
                      </form>
                    </div>
                  ))}
                  <form
                    action={saveBlock}
                    style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'end' }}
                  >
                    <input type="hidden" name="hostelId" value={h.id} />
                    <input type="hidden" name="returnTo" value={back()} />
                    <label className="ep-field" htmlFor={`b-new-${h.id}`}>
                      <span className="ep-field__label">New block</span>
                      <input
                        id={`b-new-${h.id}`}
                        name="name"
                        className="ep-input"
                        required
                        maxLength={40}
                      />
                    </label>
                    <label className="ep-field" htmlFor={`b-newf-${h.id}`}>
                      <span className="ep-field__label">Floors</span>
                      <input
                        id={`b-newf-${h.id}`}
                        name="floors"
                        type="number"
                        min={1}
                        max={40}
                        className="ep-input"
                        defaultValue={1}
                      />
                    </label>
                    <Button type="submit" variant="secondary" size="sm">
                      Add
                    </Button>
                  </form>
                </div>
              </div>
            </Card>
          ))}
          <Card title="Add a hostel">
            <form action={saveHostel} className="hs-form" style={{ maxWidth: '40rem' }}>
              <input type="hidden" name="returnTo" value="/hostel/setup" />
              <HostelFields prefix="hnew" />
              <Button type="submit">Add the hostel</Button>
            </form>
          </Card>
        </>
      ) : null}

      {tab === 'types' ? (
        <>
          <Card title="Room types" style={{ marginBottom: 'var(--sp-4)' }}>
            <p className="ep-field__help">
              The fee group is a fee group of Fee setup → Fee structures holding the hostel heads
              for this kind of room (for example <code>ac_double</code>). A pupil pays the hostel
              fee of each month by the room type of the bed held that month. Leave it empty to
              charge by the pupil&apos;s own fee group.
            </p>
            {types.map((t) => (
              <form
                key={t.id}
                action={saveRoomType}
                className="ep-hd__row"
                style={{ marginBottom: 'var(--sp-3)' }}
              >
                <input type="hidden" name="id" value={t.id} />
                <TypeFields t={t} prefix={`t${t.id}`} />
                <Button type="submit" variant="secondary">
                  Save ({t.rooms} rooms)
                </Button>
              </form>
            ))}
          </Card>
          <Card title="Add a room type">
            <form action={saveRoomType} className="ep-hd__row">
              <TypeFields prefix="tnew" />
              <Button type="submit">Add</Button>
            </form>
          </Card>
        </>
      ) : null}

      {tab === 'rooms' ? (
        !hostel ? (
          <Card>Add a hostel first.</Card>
        ) : (
          <>
            <form method="get" className="ep-hd__row" style={{ marginBottom: 'var(--sp-4)' }}>
              <input type="hidden" name="tab" value="rooms" />
              <label className="ep-field" htmlFor="rs-hostel">
                <span className="ep-field__label">Hostel</span>
                <select id="rs-hostel" name="hostel" className="ep-select" defaultValue={hostel.id}>
                  {hostels.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" variant="secondary">
                Show
              </Button>
            </form>
            <Card
              title={`Rooms of ${hostel.name} (${String(rooms.length)})`}
              style={{ marginBottom: 'var(--sp-4)' }}
            >
              {rooms.length === 0 ? <p className="ep-field__help">No rooms yet.</p> : null}
              <div className="hs-rooms">
                {rooms.map((r) => (
                  <section
                    key={r.id}
                    className={`hs-room${r.status !== 'active' ? ' hs-room--off' : ''}`}
                    aria-label={`Room ${r.roomNo}`}
                  >
                    <form action={updateRoom} style={{ display: 'grid', gap: 'var(--sp-2)' }}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="returnTo" value={back()} />
                      <div className="hs-room__head">
                        <strong>Room {r.roomNo}</strong>
                        <span className="ep-field__help">
                          {r.block ? `Block ${r.block} · ` : ''}
                          {r.floor === 0 ? 'Ground' : `Floor ${String(r.floor)}`}
                        </span>
                      </div>
                      <label className="ep-field" htmlFor={`r-t-${r.id}`}>
                        <span className="ep-field__label">Room type</span>
                        <select
                          id={`r-t-${r.id}`}
                          name="roomTypeId"
                          className="ep-select"
                          defaultValue={r.roomTypeId}
                        >
                          {types.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="ep-field" htmlFor={`r-s-${r.id}`}>
                        <span className="ep-field__label">Status</span>
                        <select
                          id={`r-s-${r.id}`}
                          name="status"
                          className="ep-select"
                          defaultValue={r.status}
                        >
                          <option value="active">In use</option>
                          <option value="maintenance">Under maintenance</option>
                          <option value="closed">Closed</option>
                        </select>
                      </label>
                      <Button type="submit" variant="secondary" size="sm">
                        Save room
                      </Button>
                    </form>
                    <ul className="hs-beds" style={{ marginTop: 'var(--sp-2)' }}>
                      {r.beds.map((b) => (
                        <li
                          key={b.id}
                          className={`hs-bed${b.status === 'active' ? '' : ' hs-bed--blocked'}`}
                        >
                          <span className="hs-bed__label">{b.label}</span>
                          <form
                            action={setBed}
                            style={{ display: 'flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}
                          >
                            <input type="hidden" name="id" value={b.id} />
                            <input type="hidden" name="label" value={b.label} />
                            <input type="hidden" name="returnTo" value={back()} />
                            <Button
                              type="submit"
                              name="status"
                              value={b.status === 'active' ? 'blocked' : 'active'}
                              variant="ghost"
                              size="sm"
                            >
                              {b.status === 'active' ? 'Block' : 'Unblock'}
                            </Button>
                            {b.used ? null : (
                              <Button
                                type="submit"
                                name="do"
                                value="delete"
                                variant="ghost"
                                size="sm"
                              >
                                Remove
                              </Button>
                            )}
                          </form>
                        </li>
                      ))}
                    </ul>
                    <form
                      action={addBed}
                      style={{
                        display: 'flex',
                        gap: 'var(--sp-2)',
                        alignItems: 'end',
                        marginTop: 'var(--sp-2)',
                      }}
                    >
                      <input type="hidden" name="roomId" value={r.id} />
                      <input type="hidden" name="returnTo" value={back()} />
                      <label className="ep-field" htmlFor={`bed-${r.id}`}>
                        <span className="ep-field__label">New bed</span>
                        <input
                          id={`bed-${r.id}`}
                          name="label"
                          className="ep-input"
                          required
                          maxLength={10}
                          size={4}
                        />
                      </label>
                      <Button type="submit" variant="ghost" size="sm">
                        Add
                      </Button>
                    </form>
                  </section>
                ))}
              </div>
            </Card>
            <Card title={`Add a room to ${hostel.name}`}>
              {types.length === 0 ? (
                <p>
                  Add a{' '}
                  <a href="/hostel/setup?tab=types" style={{ textDecoration: 'underline' }}>
                    room type
                  </a>{' '}
                  first.
                </p>
              ) : (
                <form action={createRoom} className="ep-hd__row">
                  <input type="hidden" name="hostelId" value={hostel.id} />
                  <input type="hidden" name="returnTo" value={back()} />
                  <label className="ep-field" htmlFor="nr-no">
                    <span className="ep-field__label">Room no.</span>
                    <input id="nr-no" name="roomNo" className="ep-input" required maxLength={20} />
                  </label>
                  <label className="ep-field" htmlFor="nr-block">
                    <span className="ep-field__label">Block</span>
                    <select id="nr-block" name="blockId" className="ep-select" defaultValue="">
                      <option value="">—</option>
                      {hostel.blocks.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="ep-field" htmlFor="nr-floor">
                    <span className="ep-field__label">Floor (0 = ground)</span>
                    <input
                      id="nr-floor"
                      name="floor"
                      type="number"
                      min={0}
                      max={40}
                      className="ep-input"
                      defaultValue={0}
                    />
                  </label>
                  <label className="ep-field" htmlFor="nr-type">
                    <span className="ep-field__label">Room type</span>
                    <select
                      id="nr-type"
                      name="roomTypeId"
                      className="ep-select"
                      required
                      defaultValue=""
                    >
                      <option value="" disabled>
                        Choose
                      </option>
                      {types
                        .filter((t) => t.status === 'active')
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.seater} beds)
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="ep-field" htmlFor="nr-beds">
                    <span className="ep-field__label">Beds</span>
                    <input
                      id="nr-beds"
                      name="beds"
                      type="number"
                      min={0}
                      max={40}
                      className="ep-input"
                      placeholder="as the seater"
                    />
                  </label>
                  <Button type="submit">Add the room</Button>
                </form>
              )}
            </Card>
          </>
        )
      ) : null}
      {tab === 'rules' && rules ? (
        <>
          <Card title="Leave and roll-call rules" style={{ marginBottom: 'var(--sp-4)' }}>
            <form action={saveHostelRules} className="ep-hd__row">
              <label className="ep-field" htmlFor="hr-grace">
                <span className="ep-field__label">Late after (minutes past the return time)</span>
                <input
                  id="hr-grace"
                  name="lateGraceMinutes"
                  type="number"
                  min={0}
                  max={1440}
                  className="ep-input"
                  defaultValue={rules.lateGraceMinutes}
                />
              </label>
              <label className="ep-field" htmlFor="hr-esc">
                <span className="ep-field__label">
                  Tell the principal / admin after (hours late)
                </span>
                <input
                  id="hr-esc"
                  name="escalateAfterHours"
                  type="number"
                  min={1}
                  max={168}
                  className="ep-input"
                  defaultValue={rules.escalateAfterHours}
                />
              </label>
              <label className="ep-field" htmlFor="hr-out">
                <span className="ep-field__label">Outing: back by (latest)</span>
                <input
                  id="hr-out"
                  name="outingReturnBy"
                  type="time"
                  className="ep-input"
                  defaultValue={rules.outingReturnBy}
                />
              </label>
              <label className="ep-field" htmlFor="hr-alert" style={{ alignSelf: 'center' }}>
                <span>
                  <input
                    id="hr-alert"
                    name="alertParentAbsent"
                    type="checkbox"
                    defaultChecked={rules.alertParentAbsent}
                  />{' '}
                  Tell the parent when absent at roll-call
                </span>
              </label>
              <Button type="submit">Save rules</Button>
            </form>
            <p className="ep-field__help">
              A pupil late back from leave: the parent and the head warden are told once, the
              principal and school admins after the hours set. Messages go on SMS and WhatsApp when
              their templates are ready (Communication → Templates, codes starting hostel_).
            </p>
          </Card>
          {hostels.map((h) => (
            <Card
              key={h.id}
              title={`Roll-call sessions · ${h.name}`}
              style={{ marginBottom: 'var(--sp-4)' }}
            >
              {sessions
                .filter((x) => x.hostelId === h.id)
                .map((x) => (
                  <form
                    key={x.id}
                    action={saveSession}
                    className="ep-hd__row"
                    style={{ marginBottom: 'var(--sp-2)' }}
                  >
                    <input type="hidden" name="id" value={x.id} />
                    <input type="hidden" name="hostelId" value={h.id} />
                    <label className="ep-field" htmlFor={`s-n-${x.id}`}>
                      <span className="ep-field__label">Session</span>
                      <input
                        id={`s-n-${x.id}`}
                        name="name"
                        className="ep-input"
                        required
                        maxLength={40}
                        defaultValue={x.name}
                      />
                    </label>
                    <label className="ep-field" htmlFor={`s-t-${x.id}`}>
                      <span className="ep-field__label">Time</span>
                      <input
                        id={`s-t-${x.id}`}
                        name="atTime"
                        type="time"
                        className="ep-input"
                        required
                        defaultValue={x.atTime}
                      />
                    </label>
                    <label
                      className="ep-field"
                      htmlFor={`s-a-${x.id}`}
                      style={{ alignSelf: 'center' }}
                    >
                      <span>
                        <input
                          id={`s-a-${x.id}`}
                          name="active"
                          type="checkbox"
                          defaultChecked={x.active}
                        />{' '}
                        In use
                      </span>
                    </label>
                    <Button type="submit" variant="secondary">
                      Save
                    </Button>
                  </form>
                ))}
              <h3 className="hs-h" style={{ margin: 'var(--sp-4) 0 var(--sp-2)' }}>
                Visiting hours
              </h3>
              <form
                action={saveVisitHours}
                style={{ display: 'grid', gap: 'var(--sp-2)', marginBottom: 'var(--sp-4)' }}
              >
                <input type="hidden" name="hostelId" value={h.id} />
                <p className="ep-field__help" style={{ margin: 0 }}>
                  One slot a day; leave a day empty for no visits that day. All empty = visits any
                  time. A visit outside these hours waits at the gate for the warden.
                </p>
                <div className="hs-hours">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, wd) => {
                    const slot = (hours[h.id] ?? []).find((x) => x.weekday === wd);
                    return (
                      <fieldset key={d} className="hs-hours__day">
                        <legend className="ep-field__label">{d}</legend>
                        <label className="ep-sr-only" htmlFor={`vh-f-${h.id}-${String(wd)}`}>
                          {d} from
                        </label>
                        <input
                          id={`vh-f-${h.id}-${String(wd)}`}
                          name={`from-${String(wd)}`}
                          type="time"
                          className="ep-input"
                          defaultValue={slot?.from ?? ''}
                        />
                        <label className="ep-sr-only" htmlFor={`vh-t-${h.id}-${String(wd)}`}>
                          {d} to
                        </label>
                        <input
                          id={`vh-t-${h.id}-${String(wd)}`}
                          name={`to-${String(wd)}`}
                          type="time"
                          className="ep-input"
                          defaultValue={slot?.to ?? ''}
                        />
                      </fieldset>
                    );
                  })}
                </div>
                <div>
                  <Button type="submit" variant="secondary">
                    Save visiting hours
                  </Button>
                </div>
              </form>
              <form action={saveSession} className="ep-hd__row">
                <input type="hidden" name="hostelId" value={h.id} />
                <label className="ep-field" htmlFor={`s-new-${h.id}`}>
                  <span className="ep-field__label">New session</span>
                  <input
                    id={`s-new-${h.id}`}
                    name="name"
                    className="ep-input"
                    required
                    maxLength={40}
                    placeholder="e.g. Night"
                  />
                </label>
                <label className="ep-field" htmlFor={`s-newt-${h.id}`}>
                  <span className="ep-field__label">Time</span>
                  <input
                    id={`s-newt-${h.id}`}
                    name="atTime"
                    type="time"
                    className="ep-input"
                    required
                    defaultValue="21:30"
                  />
                </label>
                <Button type="submit">Add</Button>
              </form>
            </Card>
          ))}
        </>
      ) : null}
    </>
  );
}

function HostelFields({ h, prefix }: { h?: Hostel; prefix: string }) {
  return (
    <>
      <label className="ep-field" htmlFor={`${prefix}-name`}>
        <span className="ep-field__label">Name</span>
        <input
          id={`${prefix}-name`}
          name="name"
          className="ep-input"
          required
          maxLength={80}
          defaultValue={h?.name}
        />
      </label>
      <label className="ep-field" htmlFor={`${prefix}-code`}>
        <span className="ep-field__label">Code</span>
        <input
          id={`${prefix}-code`}
          name="code"
          className="ep-input"
          required
          maxLength={12}
          defaultValue={h?.code}
        />
      </label>
      <label className="ep-field" htmlFor={`${prefix}-gender`}>
        <span className="ep-field__label">For</span>
        <select
          id={`${prefix}-gender`}
          name="gender"
          className="ep-select"
          defaultValue={h?.gender ?? 'boys'}
        >
          <option value="boys">Boys</option>
          <option value="girls">Girls</option>
          <option value="mixed">Boys and girls</option>
        </select>
      </label>
      <label className="ep-field" htmlFor={`${prefix}-phone`}>
        <span className="ep-field__label">Phone</span>
        <input
          id={`${prefix}-phone`}
          name="phone"
          className="ep-input"
          maxLength={30}
          defaultValue={h?.phone ?? ''}
        />
      </label>
      <label className="ep-field" htmlFor={`${prefix}-address`}>
        <span className="ep-field__label">Address</span>
        <input
          id={`${prefix}-address`}
          name="address"
          className="ep-input"
          maxLength={300}
          defaultValue={h?.address ?? ''}
        />
      </label>
      {h ? (
        <label className="ep-field" htmlFor={`${prefix}-status`}>
          <span className="ep-field__label">Status</span>
          <select
            id={`${prefix}-status`}
            name="status"
            className="ep-select"
            defaultValue={h.status}
          >
            <option value="active">Open</option>
            <option value="closed">Closed</option>
          </select>
        </label>
      ) : null}
    </>
  );
}

function TypeFields({ t, prefix }: { t?: RoomType; prefix: string }) {
  return (
    <>
      <label className="ep-field" htmlFor={`${prefix}-name`}>
        <span className="ep-field__label">Name</span>
        <input
          id={`${prefix}-name`}
          name="name"
          className="ep-input"
          required
          maxLength={60}
          defaultValue={t?.name}
        />
      </label>
      <label className="ep-field" htmlFor={`${prefix}-seater`}>
        <span className="ep-field__label">Beds (seater)</span>
        <input
          id={`${prefix}-seater`}
          name="seater"
          type="number"
          min={1}
          max={40}
          className="ep-input"
          required
          defaultValue={t?.seater ?? 2}
        />
      </label>
      <label className="ep-field" htmlFor={`${prefix}-fg`}>
        <span className="ep-field__label">Hostel fee group</span>
        <input
          id={`${prefix}-fg`}
          name="feeGroup"
          className="ep-input"
          pattern="[a-z_]{0,30}"
          maxLength={30}
          defaultValue={t?.feeGroup ?? ''}
          placeholder="e.g. ac_double"
        />
      </label>
      <label className="ep-field" htmlFor={`${prefix}-ac`} style={{ alignSelf: 'center' }}>
        <span>
          <input id={`${prefix}-ac`} name="ac" type="checkbox" defaultChecked={t?.ac} /> AC
        </span>
      </label>
      {t ? (
        <label className="ep-field" htmlFor={`${prefix}-status`}>
          <span className="ep-field__label">Status</span>
          <select
            id={`${prefix}-status`}
            name="status"
            className="ep-select"
            defaultValue={t.status}
          >
            <option value="active">In use</option>
            <option value="inactive">Not in use</option>
          </select>
        </label>
      ) : null}
    </>
  );
}
